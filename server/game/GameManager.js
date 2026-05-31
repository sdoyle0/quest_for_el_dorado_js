// server/game/GameManager.js
const { v4: uuidv4 } = require('uuid');
const { GameStateManager } = require('./GameState');
const { CardMarket } = require('./CardMarket');
const { HexBoard } = require('./HexBoard');
const { Player } = require('./Player');
const MAP_DATA = require('../../shared/mapData.json');

class GameRoom {
  constructor(roomId, io, { debugMode = false, maxPlayers = 2 } = {}) {
    this.roomId     = roomId;
    this.io         = io;
    this.players    = [];
    this.maxPlayers = Math.min(4, Math.max(debugMode ? 1 : 2, maxPlayers));
    this.debugMode  = debugMode;
    this.started    = false;
    this.hostId     = null; // socketId of the room creator

    this.board     = new HexBoard();
    this.market    = new CardMarket();
    this.gameState = new GameStateManager(this.board);

    // Wire game events → socket broadcasts
    // hand_updated carries private card data — route to owning player only
    this.gameState.onEvent = (event, data) => {
      if (event === 'hand_updated' && data.playerId) {
        const owner = this.players.find(p => p.id === data.playerId);
        if (owner) {
          this.io.to(owner.socketId).emit('hand_updated', { hand: data.hand });
          return;
        }
      }
      // prompt_reserve_choice is private — route only to the buying player
      if (event === 'prompt_reserve_choice' && data.playerId) {
        const owner = this.players.find(p => p.id === data.playerId);
        if (owner) {
          this.io.to(owner.socketId).emit('prompt_reserve_choice', data);
          return;
        }
      }
      this._broadcast(event, data);
    };
  }

  addPlayer(socket, playerName) {
    if (this.players.length >= this.maxPlayers) return null;
    if (this.started) return null;

    const player = new Player({
      id: socket.id,
      playerNumber: this.players.length + 1,
      socketId: socket.id,
      name: playerName || `Player ${this.players.length + 1}`,
    });

    this.players.push(player);
    if (!this.hostId) this.hostId = socket.id;
    socket.join(this.roomId);

    // Tell everyone in the room about the new arrival
    this._broadcast('player_joined', {
      player: player.toPublicData(),
      roomId: this.roomId,
      players: this.players.map(p => p.toPublicData()),
      hostId: this.hostId,
      maxPlayers: this.maxPlayers,
    });

    return player;
  }

  removePlayer(socketId) {
    this.players = this.players.filter(p => p.socketId !== socketId);
    // Re-assign host if the host left
    if (this.hostId === socketId && this.players.length > 0) {
      this.hostId = this.players[0].socketId;
    }
    this._broadcast('player_left', {
      socketId,
      players: this.players.map(p => p.toPublicData()),
      hostId: this.hostId,
    });
  }

  // Called by the host via the 'start_game' socket event.
  // Requires at least 2 players.
  tryStartGame(socketId) {
    if (socketId !== this.hostId) return { ok: false, error: 'only the host can start the game' };
    if (this.started)             return { ok: false, error: 'game already started' };
    const minPlayers = this.debugMode ? 1 : 2;
    if (this.players.length < minPlayers) return { ok: false, error: 'need at least 2 players' };
    this._startGame();
    return { ok: true };
  }

  getRoomInfo() {
    return {
      roomId:     this.roomId,
      maxPlayers: this.maxPlayers,
      started:    this.started,
      hostId:     this.hostId,
      players:    this.players.map(p => p.toPublicData()),
    };
  }

  _startGame() {
    this.started = true;
    this.board.loadMap(MAP_DATA);
    this.market.init();
    this.gameState.players = this.players;

    for (const player of this.players) {
      const startTile = this.board.getPlayerStartTile(player.playerNumber);
      if (!startTile) {
        console.error(`No start tile for player ${player.playerNumber}`);
        continue;
      }
      player.init(startTile.id);
    }

    this._broadcast('game_started', {
      tiles:           [...this.board.tiles.values()].map(t => ({ ...t })),
      players:         this.players.map(p => p.toPublicData()),
      currentPlayerId: this.gameState.currentPlayer?.id,
      market:          this.market.getShopState()
    });

    // Send each player their private hand
    for (const player of this.players) {
      this.io.to(player.socketId).emit('hand_updated', { hand: player.hand });
    }
  }

  handlePlayCard(socketId, instanceId, isDiscardingFromHand) {
    const result = this.gameState.playCard(socketId, instanceId, isDiscardingFromHand);
    if (!result.ok) this.io.to(socketId).emit('action_error', { message: result.error });
  }

  handleMovePawn(socketId, tileId) {
    const result = this.gameState.movePawn(socketId, tileId);
    if (!result.ok) this.io.to(socketId).emit('action_error', { message: result.error });
  }

  handleMoveToRubble(socketId, tileId, extraCardIds) {
    const result = this.gameState.movePawnToRubble(socketId, tileId, extraCardIds);
    if (!result.ok) this.io.to(socketId).emit('action_error', { message: result.error });
  }

  handleCancelCard(socketId) {
    const result = this.gameState.cancelCard(socketId);
    if (!result.ok) this.io.to(socketId).emit('action_error', { message: result.error });
  }

  handleEndTurn(socketId) {
    const result = this.gameState.endTurn(socketId);
    if (!result.ok) this.io.to(socketId).emit('action_error', { message: result.error });
  }

  handlePurchaseCard(socketId, cardKey, handCardsUsed = []) {
    const result = this.gameState.purchaseCard(socketId, cardKey, handCardsUsed, this.market);
    if (!result.ok) this.io.to(socketId).emit('action_error', { message: result.error });
  }

  handleChooseReserveCard(socketId, soldOutKey, chosenKey) {
    const result = this.gameState.chooseReserveCard(socketId, soldOutKey, chosenKey, this.market);
    if (!result.ok) this.io.to(socketId).emit('action_error', { message: result.error });
  }

  _broadcast(event, data) {
    this.io.to(this.roomId).emit(event, data);
  }
}

class GameManager {
  constructor(io) {
    this.io = io;
    this.rooms       = new Map(); // roomId → GameRoom
    this.playerRooms = new Map(); // socketId → roomId
  }

  createRoom(socket, playerName, { debugMode = false, maxPlayers = 2 } = {}) {
    const roomId = uuidv4().slice(0, 6).toUpperCase();
    const room   = new GameRoom(roomId, this.io, { debugMode, maxPlayers });
    this.rooms.set(roomId, room);
    const player = room.addPlayer(socket, playerName);
    if (player) this.playerRooms.set(socket.id, roomId);
    return { room, player };
  }

  joinRoom(socket, playerName, roomId) {
    const room = this.rooms.get(roomId.toUpperCase());
    if (!room)           return { ok: false, error: 'Room not found' };
    if (room.started)    return { ok: false, error: 'Game already in progress' };
    if (room.players.length >= room.maxPlayers) return { ok: false, error: 'Room is full' };

    const player = room.addPlayer(socket, playerName);
    if (!player) return { ok: false, error: 'Could not join room' };
    this.playerRooms.set(socket.id, room.roomId);
    return { ok: true, room, player };
  }

  // Legacy: auto-join or create — kept for debug mode
  joinOrCreateRoom(socket, playerName, { debugMode = false } = {}) {
    if (debugMode) {
      return this.createRoom(socket, playerName, { debugMode: true, maxPlayers: 2 });
    }
    // Fall back to old behaviour (find any open 2-player room)
    let room = [...this.rooms.values()].find(r => !r.started && r.players.length < r.maxPlayers && !r.debugMode);
    if (!room) {
      const result = this.createRoom(socket, playerName);
      return { room: result.room, player: result.player };
    }
    const player = room.addPlayer(socket, playerName);
    if (player) this.playerRooms.set(socket.id, room.roomId);
    return { room, player };
  }

  getRoomForSocket(socketId) {
    const roomId = this.playerRooms.get(socketId);
    return roomId ? this.rooms.get(roomId) : null;
  }

  handleDisconnect(socketId) {
    const room = this.getRoomForSocket(socketId);
    if (room) {
      room.removePlayer(socketId);
      this.playerRooms.delete(socketId);
      if (room.players.length === 0) this.rooms.delete(room.roomId);
    }
  }
}

module.exports = { GameManager };
