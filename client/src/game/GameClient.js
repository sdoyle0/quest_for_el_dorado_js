// client/src/game/GameClient.js
// Handles all socket.io communication.

class GameClient {
  constructor(socket) {
    this.socket = socket;
    this.playerId = null;
    this.playerNumber = null;
    this.roomId = null;

    // Callbacks — set by main.js
    this.onJoined            = null;
    this.onGameStarted       = null;
    this.onPawnMoved         = null;
    this.onHandUpdated       = null;
    this.onValidMoves        = null;
    this.onTurnEnded         = null;
    this.onMarketUpdated     = null;
    this.onPurchaseOpened    = null;
    this.onPurchaseClosed    = null;
    this.onPromptRemove      = null;
    this.onGameWon           = null;
    this.onFinalRoundStarted = null;
    this.onPlayerJoined      = null;
    this.onLog               = null;
    this.onCardDisposed      = null;
    this.onActionError       = null;

    this._bindEvents();
  }

  _bindEvents() {
    const s = this.socket;

    s.on('joined_room', (data) => {
      this.playerId     = data.playerId;
      this.playerNumber = data.playerNumber;
      this.roomId       = data.roomId;
      this.onJoined?.(data);
    });

    s.on('player_joined',       d => this.onPlayerJoined?.(d));
    s.on('game_started',        d => this.onGameStarted?.(d));
    s.on('pawn_moved',          d => this.onPawnMoved?.(d));
    s.on('hand_updated',        d => this.onHandUpdated?.(d));
    s.on('valid_moves_updated', d => this.onValidMoves?.(d));
    s.on('turn_ended',          d => this.onTurnEnded?.(d));
    s.on('market_updated',      d => this.onMarketUpdated?.(d));
    s.on('purchase_opened',     d => this.onPurchaseOpened?.(d));
    s.on('purchase_closed',     d => this.onPurchaseClosed?.(d));
    s.on('prompt_remove_cards', d => this.onPromptRemove?.(d));
    s.on('game_won',            d => this.onGameWon?.(d));
    s.on('final_round_started', d => this.onFinalRoundStarted?.(d));
    s.on('log',                 d => this.onLog?.(d));
    s.on('card_disposed',       d => this.onCardDisposed?.(d));
    s.on('action_error',        d => this.onActionError?.(d));
    s.on('prompt_reserve_choice', d => this.onPromptReserveChoice?.(d));

    s.on('error', ({ message }) => {
      console.warn('[server error]', message);
    });
  }

  // --- Actions ---

  joinGame(playerName, debugMode = false) {
    this.socket.emit('join_game', { playerName, debugMode });
  }

  playCard(instanceId) {
    this.socket.emit('play_card', { instanceId });
  }

  cancelCard(instanceId) {
    this.socket.emit('cancel_card', { instanceId });
  }

  movePawn(tileId) {
    this.socket.emit('move_pawn', { tileId });
  }

  moveToRubble(tileId, extraCardIds) {
    this.socket.emit('move_to_rubble', { tileId, extraCardIds });
  }

  endTurn() {
    this.socket.emit('end_turn');
  }

  purchaseCard(cardKey, handCardsUsed = []) {
    this.socket.emit('purchase_card', { cardKey, handCardsUsed });
  }

  discardCard(cardKey) {
    this.socket.emit('discard_card', { cardKey });
  }

  chooseReserveCard(soldOutKey, chosenKey) {
    this.socket.emit('choose_reserve_card', { soldOutKey, chosenKey });
  }

  debugState() {
    this.socket.emit('debug_state');
  }

  debugSetHand(cardKeys) {
    this.socket.emit('debug_set_hand', { cardKeys });
  }

  debugTeleport(tileId) {
    this.socket.emit('debug_teleport', { tileId });
  }

  isMyTurn(currentPlayerId) {
    return this.playerId === currentPlayerId;
  }
}
