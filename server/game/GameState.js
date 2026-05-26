const { GameState: GS, CardEffect, TerrainType, TRANSMITTER_PURCHASE_POWER } = require('../../shared/constants');

class GameStateManager {
  constructor(board) {
    this.board = board;
    this.state = GS.AWAITING_CARD;
    this.players = [];
    this.currentPlayerIndex = 0;
    this.playedCardData = null;
    this.wildCardTerrain = null;
    this.movesRemaining = 0;
    this.validMoves = [];
    this.selectingCardsToRemove = 0;
    this.selectingCardsForRubble = 0;
    this.transmitterActive = false;
    this.pendingReserveSlot = null; // soldOutKey awaiting the buyer's reserve pick
    this.onEvent = null;
  }

  emit(event, data) {
    if (this.onEvent) this.onEvent(event, data);
  }

  get currentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  // ── Play a card from hand ──────────────────────────────────────────────────
  playCard(playerId, instanceId, isDiscardingFromHand) {
    if (!this._isCurrentPlayer(playerId)) return { ok: false, error: 'not your turn' };

    const player = this.currentPlayer;

    // Handle pending removal prompts BEFORE state check — they run while state
    // is AWAITING_MOVE (movesRemaining=0) after Scientist / Travel Log
    if (this.selectingCardsToRemove > 0) {
      this.selectingCardsToRemove--;
      player.removeCardPermanently(instanceId);
      this.emit('hand_updated', { playerId, hand: player.hand });
      if (this.selectingCardsToRemove === 0 && this.playedCardData) {
        this._disposeFinishedCard(player);
      }
      return { ok: true };
    }

    if (this.selectingCardsForRubble > 0) {
      this.selectingCardsForRubble--;
      player.playCard(instanceId);
      this.emit('hand_updated', { playerId, hand: player.hand });
      return { ok: true };
    }

    // Allow reselection: cancel pending card, then fall through to pick new one
    if (this.state === GS.AWAITING_MOVE) {
      this._returnCardToHand();
    }

    if (this.state !== GS.AWAITING_CARD) return { ok: false, error: 'wrong state' };

    const card = player.hand.find(c => c.instanceId === instanceId || c.key === instanceId);
    if (!card) return { ok: false, error: 'card not in hand' };

    this.playedCardData = card;
    this.movesRemaining = card.movementTotal;
    this.state          = GS.AWAITING_MOVE;

    if (isDiscardingFromHand) {
      this._disposeFinishedCard(player);
      return { ok: true };
    }

    this._handleSpecialCardPlayed(player, card);

    // Transmitter resets state to AWAITING_CARD internally — return early
    if (this.state === GS.AWAITING_CARD) return { ok: true };

    this._recalculateValidMoves();

    // Zero-movement cards (Cartographer, Compass) — dispose immediately
    if (this.movesRemaining === 0 && this.selectingCardsToRemove === 0) {
      this._disposeFinishedCard(player);
      return { ok: true };
    }

    return { ok: true };
  }

  // ── Move pawn to a tile ────────────────────────────────────────────────────
  movePawn(playerId, tileId) {
    if (!this._isCurrentPlayer(playerId)) return { ok: false, error: 'not your turn' };
    if (this.state !== GS.AWAITING_MOVE)  return { ok: false, error: 'wrong state' };
    if (!this.validMoves.includes(tileId)) return { ok: false, error: 'invalid move' };

    const player = this.currentPlayer;
    const tile   = this.board.getTile(tileId);

    player.currentTileId = tileId;
    this.emit('pawn_moved', { playerId, tileId });

    // Win condition
    if (tile.terrainType === TerrainType.EL_DORADO) {
      this.state = GS.GAME_OVER;
      this.emit('game_won', { playerId });
      return { ok: true };
    }

    const terrain = tile.terrainType;
    const cost    = tile.movementCost;

    if (terrain === TerrainType.RUBBLE) {
      this.movesRemaining = 0;
      if (cost > 1) this.selectingCardsForRubble = cost - 1;
    } else if (terrain === TerrainType.CAMP) {
      this.movesRemaining = 0;
      this.playedCardData.oneTimeUse = true;
    } else {
      if (this.playedCardData.movementTerrain === TerrainType.WILD && !this.wildCardTerrain) {
        this.wildCardTerrain = terrain;
      }
      this.movesRemaining -= cost;
    }

    if (this.movesRemaining > 0) {
      this._recalculateValidMoves();
      this.emit('valid_moves_updated', { validMoves: this.validMoves });
      return { ok: true };
    }

    this._disposeFinishedCard(player);
    return { ok: true };
  }

  // ── End turn ──────────────────────────────────────────────────────────────
  endTurn(playerId) {
    if (!this._isCurrentPlayer(playerId)) return { ok: false, error: 'not your turn' };

    if (this.pendingReserveSlot) {
      return { ok: false, error: 'choose a reserve card for the empty market slot first' };
    }

    const player = this.currentPlayer;

    // Keep unplayed cards — just draw back up to 4
    player.drawUpToFour();

    // Reset state
    this.state             = GS.AWAITING_CARD;
    this.playedCardData    = null;
    this.movesRemaining    = 0;
    this.wildCardTerrain   = null;
    this.validMoves        = [];
    this.transmitterActive = false;

    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
    const next = this.currentPlayer;

    // Send updated hand to the player who drew, then announce next turn
    this.emit('hand_updated', { playerId: player.id, hand: player.hand });
    this.emit('turn_ended',   { nextPlayerId: next.id, nextPlayerName: next.name });
    return { ok: true };
  }

  // ── Purchase a card from the market ───────────────────────────────────────
  // handCardsUsed: array of instanceIds the client is spending from their hand
  purchaseCard(playerId, cardKey, handCardsUsed = [], cardMarket) {
    if (!this._isCurrentPlayer(playerId)) return { ok: false, error: 'not your turn' };

    const player = this.currentPlayer;

    // Validate all claimed hand cards actually exist in this player's hand
    const spentCards = handCardsUsed
      .map(id => player.hand.find(c => c.instanceId === id))
      .filter(Boolean);
    if (spentCards.length !== handCardsUsed.length) {
      return { ok: false, error: 'invalid hand cards' };
    }

    // Calculate purchasing power: hand cards + transmitter bonus if active
    let power = spentCards.reduce((sum, c) => sum + (c.purchasingPower ?? 0), 0);
    if (this.transmitterActive) power += TRANSMITTER_PURCHASE_POWER;

    const card = cardMarket.getCard(cardKey);
    if (!card) return { ok: false, error: 'card not in market' };
    if (power < card.cost) return { ok: false, error: `need ${card.cost} power, have ${power}` };

    // Spend the hand cards
    for (const c of spentCards) player.playCard(c.instanceId);

    const purchased = cardMarket.buyCard(cardKey);
    if (!purchased) return { ok: false, error: 'card sold out' };
    player.discardPile.push(purchased);

    this.transmitterActive = false;

    // If the slot just emptied and reserve cards are available, prompt the
    // buyer to pick which reserve card fills the gap before ending their turn.
    if (cardMarket.shopCardSoldOut(cardKey)) {
      const available = cardMarket.getAvailableReserve();
      if (available.length > 0) {
        this.pendingReserveSlot = cardKey;
        // Private event — GameManager routes this only to the buying player
        this.emit('prompt_reserve_choice', {
          playerId,
          soldOutKey: cardKey,
          reserveCards: available,
        });
      }
    }

    this.emit('card_purchased', { playerId, cardKey });
    this.emit('hand_updated',   { playerId, hand: player.hand });
    this.emit('market_updated', { market: cardMarket.getShopState() });
    this.emit('purchase_closed',{ playerId });
    return { ok: true };
  }

  // ── Buyer picks which reserve card fills the empty shop slot ──────────────
  chooseReserveCard(playerId, soldOutKey, chosenKey, cardMarket) {
    if (!this._isCurrentPlayer(playerId)) {
      return { ok: false, error: 'not your turn' };
    }
    if (this.pendingReserveSlot !== soldOutKey) {
      return { ok: false, error: 'no pending reserve choice for that slot' };
    }
    const result = cardMarket.replenishShop(soldOutKey, chosenKey);
    if (!result) {
      return { ok: false, error: 'invalid reserve card selection' };
    }
    this.pendingReserveSlot = null;
    this.emit('market_updated', { market: cardMarket.getShopState() });
    return { ok: true };
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  _handleSpecialCardPlayed(player, card) {
    switch (card.specialEffect) {
      case CardEffect.TRANSMITTER:
        this.transmitterActive = true;
        this.state = GS.AWAITING_CARD;
        this.playedCardData = null;
        this.emit('purchase_opened', { totalPurchasePower: TRANSMITTER_PURCHASE_POWER });
        break;
      case CardEffect.CARTOGRAPHER:
        player.drawCards(2);
        this.emit('hand_updated', { playerId: player.id, hand: player.hand });
        break;
      case CardEffect.COMPASS:
        player.drawCards(3);
        this.emit('hand_updated', { playerId: player.id, hand: player.hand });
        break;
      case CardEffect.SCIENTIST:
        player.drawCards(1);
        this.selectingCardsToRemove = 1;
        this.emit('hand_updated',      { playerId: player.id, hand: player.hand });
        this.emit('prompt_remove_cards',{ playerId: player.id, count: 1 });
        break;
      case CardEffect.TRAVEL_LOG:
        player.drawCards(2);
        this.selectingCardsToRemove = 2;
        this.emit('hand_updated',      { playerId: player.id, hand: player.hand });
        this.emit('prompt_remove_cards',{ playerId: player.id, count: 2 });
        break;
      default:
        break;
    }
  }

  _recalculateValidMoves() {
    const player = this.currentPlayer;
    // FIX: pass currentTileId (string), not the tile object
    this.validMoves = this.board.getValidMoves({
      currentTileId:  player.currentTileId,
      playedCard:     this.playedCardData,
      movesRemaining: this.movesRemaining,
      wildCardTerrain:this.wildCardTerrain,
      players:        this.players,
      handSize:       player.hand.length,
    });
    // getValidMoves already returns an array of ID strings — no .map() needed
  }

  _disposeFinishedCard(player) {
    player.playCard(this.playedCardData.instanceId);
    this.state           = GS.AWAITING_CARD;
    this.wildCardTerrain = null;
    this.playedCardData  = null;
    this.movesRemaining  = 0;
    this.validMoves      = [];
    this.emit('card_disposed', { playerId: player.id });
    this.emit('hand_updated',  { playerId: player.id, hand: player.hand });
  }

  cancelCard(playerId) {
    if (!this._isCurrentPlayer(playerId)) return { ok: false, error: 'not your turn' };
    if (this.state !== GS.AWAITING_MOVE)  return { ok: false, error: 'nothing to cancel' };
    const player = this.currentPlayer;
    this._returnCardToHand();
    this.emit('card_cancelled', { playerId });
    this.emit('hand_updated',   { playerId: player.id, hand: player.hand });
    return { ok: true };
  }

  _returnCardToHand() {
    this.playedCardData  = null;
    this.state           = GS.AWAITING_CARD;
    this.wildCardTerrain = null;
    this.movesRemaining  = 0;
    this.validMoves      = [];
  }

  _isCurrentPlayer(playerId) {
    return this.currentPlayer && this.currentPlayer.id === playerId;
  }
}

module.exports = { GameStateManager };
