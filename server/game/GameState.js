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
    this.pendingReserveSlot = null;
    // ── Final-round tracking ──────────────────────────────────────────────────
    this.finalRoundTriggered = false;
    this.finalRoundTriggerPlayerIndex = -1;
    this.firstWinnerId = null;
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

    // Handle pending removal prompts BEFORE state check
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

    // BUG FIX 3: If the player already started moving with a card (isMidMove),
    // reselecting a different card should discard the original card, not return
    // it silently. We detect this by checking if we have a playedCardData with
    // movesRemaining < movementTotal (i.e. they've moved at least once).
    if (this.state === GS.AWAITING_MOVE) {
      const hadPartialMove = this.playedCardData &&
        this.movesRemaining < this.playedCardData.movementTotal;

      if (hadPartialMove) {
        // Discard the partially-used card before switching
        this._discardPartialCard(player);
      } else {
        // No moves taken yet — safe to return card to hand
        this._returnCardToHand();
      }
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

    // ── Finishing spaces ───────────────────────────────────────────────────
    if (tile.isFinishing) {
      if (!this.firstWinnerId) this.firstWinnerId = playerId;

      const isLastPlayerOfRound = this.currentPlayerIndex === this.players.length - 1;

      if (!this.finalRoundTriggered) {
        this.finalRoundTriggered = true;
        this.finalRoundTriggerPlayerIndex = this.currentPlayerIndex;

        if (isLastPlayerOfRound) {
          this.state = GS.GAME_OVER;
          this._disposeFinishedCard(player);
          this.emit('game_won', { playerId: this.firstWinnerId });
          return { ok: true };
        }

        this.emit('final_round_started', {
          triggeredByPlayerId: playerId,
          winnerId: this.firstWinnerId,
        });
      }

      this._disposeFinishedCard(player);
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

  movePawnToRubble(playerId, tileId, extraCardIds = []) {
    if (!this._isCurrentPlayer(playerId)) return { ok: false, error: 'not your turn' };
    if (this.state !== GS.AWAITING_MOVE)  return { ok: false, error: 'wrong state' };
    if (!this.validMoves.includes(tileId)) return { ok: false, error: 'invalid move' };

    const player = this.currentPlayer;
    const tile   = this.board.getTile(tileId);
    const needed = tile.movementCost - 1;

    const extraCards = extraCardIds
      .map(id => player.hand.find(c => c.instanceId === id))
      .filter(Boolean);
    if (extraCards.length !== needed) {
      return { ok: false, error: `rubble requires ${needed} extra card(s), got ${extraCards.length}` };
    }

    for (const card of extraCards) {
      player.playCard(card.instanceId);
    }

    player.currentTileId = tileId;
    this.emit('pawn_moved', { playerId, tileId });

    if (tile.terrainType === TerrainType.EL_DORADO) {
      this.state = GS.GAME_OVER;
      this.emit('game_won', { playerId });
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

    // BUG FIX 3 (end-turn variant): if the player ends their turn while mid-move
    // (card played, some moves taken but not exhausted), discard the played card.
    if (this.state === GS.AWAITING_MOVE && this.playedCardData) {
      player.playCard(this.playedCardData.instanceId);
      this.playedCardData  = null;
      this.movesRemaining  = 0;
      this.wildCardTerrain = null;
      this.validMoves      = [];
    }

    player.drawUpToFour();

    this.state             = GS.AWAITING_CARD;
    this.playedCardData    = null;
    this.movesRemaining    = 0;
    this.wildCardTerrain   = null;
    this.validMoves        = [];
    this.transmitterActive = false;

    if (this.finalRoundTriggered && this.currentPlayerIndex === this.players.length - 1) {
      this.state = GS.GAME_OVER;
      this.emit('hand_updated', { playerId: player.id, hand: player.hand });
      this.emit('game_won', { playerId: this.firstWinnerId });
      return { ok: true };
    }

    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
    const next = this.currentPlayer;

    this.emit('hand_updated', { playerId: player.id, hand: player.hand });
    this.emit('turn_ended',   { nextPlayerId: next.id, nextPlayerName: next.name });
    return { ok: true };
  }

  // ── Purchase a card from the market ───────────────────────────────────────
  // handCardsUsed: array of instanceIds the client is spending from their hand
  purchaseCard(playerId, cardKey, handCardsUsed = [], cardMarket) {
    if (!this._isCurrentPlayer(playerId)) return { ok: false, error: 'not your turn' };

    const player = this.currentPlayer;

    const spentCards = handCardsUsed
      .map(id => player.hand.find(c => c.instanceId === id))
      .filter(Boolean);
    if (spentCards.length !== handCardsUsed.length) {
      return { ok: false, error: 'invalid hand cards' };
    }

    let power = spentCards.reduce((sum, c) => sum + (c.purchasingPower ?? 0), 0);
    if (this.transmitterActive) power += TRANSMITTER_PURCHASE_POWER;

    // BUG FIX 2: Transmitter can buy from reserve as well as shop
    let card = cardMarket.getCard(cardKey, false);
    let fromReserve = false;
    if (!card && this.transmitterActive) {
      card = cardMarket.getCard(cardKey, true);
      fromReserve = true;
    }
    if (!card) return { ok: false, error: 'card not in market' };
    if (power < card.cost) return { ok: false, error: `need ${card.cost} power, have ${power}` };

    for (const c of spentCards) player.playCard(c.instanceId);

    const purchased = cardMarket.buyCard(cardKey, fromReserve);
    if (!purchased) return { ok: false, error: 'card sold out' };
    player.discardPile.push(purchased);

    this.transmitterActive = false;

    // Only prompt for reserve replenishment when buying from the main shop
    if (!fromReserve && cardMarket.shopCardSoldOut(cardKey)) {
      const available = cardMarket.getAvailableReserve();
      if (available.length > 0) {
        this.pendingReserveSlot = cardKey;
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
        // BUG FIX 1: Dispose the Transmitter card NOW (it's one-time-use).
        // Then open the market. Previously _disposeFinishedCard was never
        // called because the Transmitter path returned early.
        player.playCard(card.instanceId); // oneTimeUse=true → goes to removedCards
        this.transmitterActive = true;
        this.state = GS.AWAITING_CARD;
        this.playedCardData = null;
        this.emit('hand_updated', { playerId: player.id, hand: player.hand });
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
        this.emit('hand_updated',       { playerId: player.id, hand: player.hand });
        this.emit('prompt_remove_cards', { playerId: player.id, count: 1 });
        break;
      case CardEffect.TRAVEL_LOG:
        player.drawCards(2);
        this.selectingCardsToRemove = 2;
        this.emit('hand_updated',       { playerId: player.id, hand: player.hand });
        this.emit('prompt_remove_cards', { playerId: player.id, count: 2 });
        break;
      default:
        break;
    }
  }

  _recalculateValidMoves() {
    const player = this.currentPlayer;
    this.validMoves = this.board.getValidMoves({
      currentTileId:   player.currentTileId,
      playedCard:      this.playedCardData,
      movesRemaining:  this.movesRemaining,
      wildCardTerrain: this.wildCardTerrain,
      players:         this.players,
      handSize:        player.hand.length,
    });
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

  // BUG FIX 3: Discard a partially-used card (player moved at least once but
  // didn't exhaust all moves, then tried to select a different card).
  _discardPartialCard(player) {
    player.playCard(this.playedCardData.instanceId);
    this.state           = GS.AWAITING_CARD;
    this.wildCardTerrain = null;
    this.playedCardData  = null;
    this.movesRemaining  = 0;
    this.validMoves      = [];
    this.emit('hand_updated', { playerId: player.id, hand: player.hand });
  }

  cancelCard(playerId) {
    if (!this._isCurrentPlayer(playerId)) return { ok: false, error: 'not your turn' };
    if (this.state !== GS.AWAITING_MOVE)  return { ok: false, error: 'nothing to cancel' };

    const player = this.currentPlayer;
    const hadPartialMove = this.playedCardData &&
      this.movesRemaining < this.playedCardData.movementTotal;

    if (hadPartialMove) {
      // Can't cancel after moving — discard the card instead
      this._discardPartialCard(player);
      this.emit('card_disposed', { playerId: player.id });
    } else {
      this._returnCardToHand();
      this.emit('hand_updated',   { playerId: player.id, hand: player.hand });
    }
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