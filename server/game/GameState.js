// server/game/GameState.js
// This is the heart of the port — mirrors Main.gd's game logic,
// stripped of all Godot scene/UI concerns.
// The server owns all authoritative game state.

const { GameState: GS, CardEffect, TerrainType, TRANSMITTER_PURCHASE_POWER } = require('../../shared/constants');
const { HexBoard } = require('./HexBoard');
const { Player } = require('./Player');

class GameStateManager {
  constructor(board) {
    this.board = board;             // HexBoard instance

    // Mirrors: Main.gd state variables
    this.state = GS.AWAITING_CARD;
    this.players = [];              // Array of Player
    this.currentPlayerIndex = 0;

    this.playedCardData = null;
    this.wildCardTerrain = null;
    this.movesRemaining = 0;
    this.validMoves = [];           // Array of tile IDs

    this.selectingCardsToRemove = 0;
    this.selectingCardsForRubble = 0;
    this.purchaseInProgress = false;
    this.replacingEmptyFromReserve = false;
    this.cardsForPurchase = [];
    this.totalPurchasePower = 0;

    // Event callback — GameManager sets this to emit socket events
    this.onEvent = null;
  }

  emit(event, data) {
    if (this.onEvent) this.onEvent(event, data);
  }

  get currentPlayer() {
    return this.players[this.currentPlayerIndex];
  }

  // -------------------------------------------------------
  // Player actions (called by server when socket events arrive)
  // Each method mirrors an RPC handler in the Godot MultiplayerService
  // -------------------------------------------------------

  // Mirrors: _on_card_played()
  playCard(playerId, cardKey) {
    if (!this._isCurrentPlayer(playerId)) return { ok: false, error: 'not your turn' };
    if (this.state !== GS.AWAITING_CARD) return { ok: false, error: 'wrong state' };

    const player = this.currentPlayer;
    const card = player.hand.find(c => c.instanceId === cardKey || c.key === cardKey);
    if (!card) return { ok: false, error: 'card not in hand' };

    // Handle purchase pool mode
    if (this.purchaseInProgress) {
      return this._addCardToPurchasePool(player, card);
    }

    // Handle card removal selections (Scientist / Travel Log)
    if (this.selectingCardsToRemove > 0) {
      this.selectingCardsToRemove--;
      player.removeCardPermanently(cardKey);
      this.emit('card_removed', { playerId, cardKey });
      return { ok: true };
    }

    if (this.selectingCardsForRubble > 0) {
      this.selectingCardsForRubble--;
      player.discardCard(cardKey);
      this.emit('card_discarded_for_rubble', { playerId, cardKey });
      return { ok: true };
    }

    // Normal card play
    this.playedCardData = card;
    this.movesRemaining = card.movementTotal;
    this.state = GS.AWAITING_MOVE;

    this._handleSpecialCardPlayed(player, card);
    this._recalculateValidMoves();

    this.emit('card_played', { playerId, cardKey, validMoves: this.validMoves });
    return { ok: true };
  }

  // Mirrors: _on_tile_clicked()
  movePawn(playerId, tileId) {
    if (!this._isCurrentPlayer(playerId)) return { ok: false, error: 'not your turn' };
    if (this.state !== GS.AWAITING_MOVE) return { ok: false, error: 'wrong state' };
    if (!this.validMoves.includes(tileId)) return { ok: false, error: 'invalid move' };

    const player = this.currentPlayer;
    const tile = this.board.getTile(tileId);

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
      if (this.playedCardData.movementTerrain === TerrainType.WILD) {
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

  // Mirrors: _on_end_turn()
  endTurn(playerId) {
    if (!this._isCurrentPlayer(playerId)) return { ok: false, error: 'not your turn' };

    const player = this.currentPlayer;

    // Discard remaining hand, draw new hand
    // TODO: Check if player can keep cards (some variants allow it)
    while (player.hand.length > 0) {
      player.discardCard(player.hand[0].key);
    }
    player.drawCards(4); // adjust to your hand size rule

    this.state = GS.AWAITING_CARD;
    this.playedCardData = null;
    this.movesRemaining = 0;
    this.wildCardTerrain = null;
    this.validMoves = [];
    this.purchaseInProgress = false;
    this.cardsForPurchase = [];
    this.totalPurchasePower = 0;

    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
    const next = this.currentPlayer;

    this.emit('turn_ended', { nextPlayerId: next.id, nextPlayerName: next.name });
    this.emit('hand_updated', { playerId: next.id, hand: next.hand });

    return { ok: true };
  }

  // Mirrors: _on_card_in_market_clicked()
  purchaseCard(playerId, cardKey, cardMarket) {
    const player = this.currentPlayer;
    if (!this._isCurrentPlayer(playerId)) return { ok: false, error: 'not your turn' };

    const card = cardMarket.getCard(cardKey);
    if (!card) return { ok: false, error: 'card not in market' };

    if (this.replacingEmptyFromReserve) {
      cardMarket.placeReserveCard(cardKey);
      this.replacingEmptyFromReserve = false;
      this.emit('market_updated', { market: cardMarket.getShopState() });
      this._cleanUpPurchase(player);
      return { ok: true };
    }

    if (this.totalPurchasePower < card.cost) {
      return { ok: false, error: 'not enough purchase power' };
    }

    // Discard cards used for purchase
    for (const c of this.cardsForPurchase) {
      player.discardCard(c.key);
    }

    // Add purchased card to discard
    const purchased = cardMarket.buyCard(cardKey);
    player.discardPile.push(purchased);

    this.emit('card_purchased', { playerId, cardKey });
    this.emit('market_updated', { market: cardMarket.getShopState() });
    this._cleanUpPurchase(player);

    return { ok: true };
  }

  // -------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------

  // Mirrors: _handle_special_card_played()
  _handleSpecialCardPlayed(player, card) {
    switch (card.specialEffect) {
      case CardEffect.TRANSMITTER:
        this.purchaseInProgress = true;
        this.totalPurchasePower = TRANSMITTER_PURCHASE_POWER;
        this.emit('purchase_opened', { totalPurchasePower: this.totalPurchasePower });
        break;
      case CardEffect.CARTOGRAPHER:
        player.drawCards(2);
        this.emit('cards_drawn', { playerId: player.id, hand: player.hand });
        break;
      case CardEffect.COMPASS:
        player.drawCards(3);
        this.emit('cards_drawn', { playerId: player.id, hand: player.hand });
        break;
      case CardEffect.SCIENTIST:
        player.drawCards(1);
        this.selectingCardsToRemove = 1;
        this.emit('cards_drawn', { playerId: player.id, hand: player.hand });
        this.emit('prompt_remove_cards', { playerId: player.id, count: 1 });
        break;
      case CardEffect.TRAVEL_LOG:
        player.drawCards(2);
        this.selectingCardsToRemove = 2;
        this.emit('cards_drawn', { playerId: player.id, hand: player.hand });
        this.emit('prompt_remove_cards', { playerId: player.id, count: 2 });
        break;
      case CardEffect.NATIVE:
        break; // No extra effect — movement logic handles it
      default:
        break;
    }
  }

  // Mirrors: _calculate_valid_moves()
  _recalculateValidMoves() {
    const player = this.currentPlayer;
    const currentTile = this.board.getTile(player.currentTileId);
    const moves = this.board.getValidMoves({
      currentTile,
      playedCard: this.playedCardData,
      movesRemaining: this.movesRemaining,
      wildCardTerrain: this.wildCardTerrain,
      players: this.players,
      handSize: player.hand.length,
    });
    this.validMoves = moves.map(t => t.id);
  }

  // Mirrors: _dispose_of_finished_card()
  _disposeFinishedCard(player) {
    player.discardCard(this.playedCardData.instanceId);
    this.state = GS.AWAITING_CARD;
    this.wildCardTerrain = null;
    this.playedCardData = null;
    this.movesRemaining = 0;
    this.validMoves = [];
    this.emit('card_disposed', { playerId: player.id, hand: player.hand });
  }

  _addCardToPurchasePool(player, card) {
    this.cardsForPurchase.push(card);
    this.totalPurchasePower += card.purchasingPower || 0;
    player.hand = player.hand.filter(c => c.key !== card.key);
    this.emit('purchase_pool_updated', {
      playerId: player.id,
      totalPurchasePower: this.totalPurchasePower,
      hand: player.hand,
    });
    return { ok: true };
  }

  // Mirrors: _clean_up_purchase()
  _cleanUpPurchase(player) {
    this.purchaseInProgress = false;
    this.cardsForPurchase = [];
    this.totalPurchasePower = 0;
    this.emit('purchase_closed', { playerId: player.id });
  }

  _isCurrentPlayer(playerId) {
    return this.currentPlayer && this.currentPlayer.id === playerId;
  }
}

module.exports = { GameStateManager };
