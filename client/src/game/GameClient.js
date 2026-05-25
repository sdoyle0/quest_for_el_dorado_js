// client/src/game/GameClient.js
// Handles all socket.io communication.
// Mirrors: the CLIENT side of res://scripts/MultiplayerService.gd
// The server is authoritative; this just sends actions and receives state updates.

class GameClient {
  constructor(socket) {
    this.socket = socket;
    this.playerId = null;
    this.playerNumber = null;
    this.roomId = null;

    // Callbacks — set by main.js
    this.onJoined         = null;
    this.onGameStarted    = null;
    this.onCardPlayed     = null;
    this.onPawnMoved      = null;
    this.onHandUpdated    = null;
    this.onValidMoves     = null;
    this.onTurnEnded      = null;
    this.onMarketUpdated  = null;
    this.onPurchaseOpened = null;
    this.onPurchaseClosed = null;
    this.onPromptRemove   = null;
    this.onGameWon        = null;
    this.onPlayerJoined   = null;
    this.onLog            = null;
    this.onCardDisposed   = null;
    this.onActionError    = null;

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

    s.on('player_joined',      d => this.onPlayerJoined?.(d));
    s.on('game_started',       d => this.onGameStarted?.(d));
    s.on('card_played',        d => this.onCardPlayed?.(d));
    s.on('pawn_moved',         d => this.onPawnMoved?.(d));
    s.on('hand_updated',       d => this.onHandUpdated?.(d));
    s.on('valid_moves_updated',d => this.onValidMoves?.(d));
    s.on('turn_ended',         d => this.onTurnEnded?.(d));
    s.on('market_updated',     d => this.onMarketUpdated?.(d));
    s.on('purchase_opened',    d => this.onPurchaseOpened?.(d));
    s.on('purchase_closed',    d => this.onPurchaseClosed?.(d));
    s.on('prompt_remove_cards',d => this.onPromptRemove?.(d));
    s.on('game_won',           d => this.onGameWon?.(d));
    s.on('log',                d => this.onLog?.(d));
    s.on('card_disposed',      d => this.onCardDisposed?.(d));
    s.on('action_error',       d => this.onActionError?.(d));

    s.on('error', ({ message }) => {
      console.warn('[server error]', message);
      // TODO: surface to UI
    });
  }

  // --- Actions (mirrors RPC calls) ---

  joinGame(playerName) {
    this.socket.emit('join_game', { playerName });
  }

  playCard(instanceId) {
    this.socket.emit('play_card', { instanceId });
  }

  movePawn(tileId) {
    this.socket.emit('move_pawn', { tileId });
  }

  executeMove(instanceId, tileId) {
    this.socket.emit('execute_move', { instanceId, tileId });
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

  debugState() {
    this.socket.emit('debug_state');
  }

  isMyTurn(currentPlayerId) {
    return this.playerId === currentPlayerId;
  }
}
