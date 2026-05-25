// server/game/GameManager.js
const { v4: uuidv4 } = require('uuid');
const { GameStateManager } = require('./GameState');
const { CardMarket } = require('./CardMarket');
const { HexBoard } = require('./HexBoard');
const { Player } = require('./Player');
const { MARKET_CARD_POOL } = require('../../shared/cardData');
const MAP_DATA = require('../../shared/mapData.json');

class GameRoom {
  constructor(roomId, io, { debugMode = false } = {}) {
    this.roomId     = roomId;
    this.io         = io;
    this.players    = [];
    this.maxPlayers = debugMode ? 1 : 2;
    this.debugMode  = debugMode;
    this.started    = false;

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
      this._broadcast(event, data);
    };
  }

  addPlayer(socket, playerName) {
    if (this.players.length >= this.maxPlayers) return null;

    const player = new Player({
      id: socket.id,
      playerNumber: this.players.length + 1,
      socketId: socket.id,
      name: playerName || `Player ${this.players.length + 1}`,
    });

    this.players.push(player);
    socket.join(this.roomId);
    this._broadcast('player_joined', { player: player.toPublicData(), roomId: this.roomId });

    if (this.players.length === this.maxPlayers) this._startGame();
    return player;
  }

  removePlayer(socketId) {
    this.players = this.players.filter(p => p.socketId !== socketId);
    this._broadcast('player_left', { socketId });
  }

  _startGame() {
    this.started = true;
    this.board.loadMap(MAP_DATA);
    this.market.init(MARKET_CARD_POOL);
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

  handlePlayCard(socketId, instanceId) {
    const result = this.gameState.playCard(socketId, instanceId);
    if (!result.ok) this.io.to(socketId).emit('action_error', { message: result.error });
  }

  handleExecuteMove(socketId, instanceId, tileId) {
    const result = this.gameState.playCardAndMove(socketId, instanceId, tileId);
    if (!result.ok) this.io.to(socketId).emit('action_error', { message: result.error });
  }

  handleMovePawn(socketId, tileId) {
    const result = this.gameState.movePawn(socketId, tileId);
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

  createRoom(opts = {}) {
    const roomId = uuidv4().slice(0, 6).toUpperCase();
    const room = new GameRoom(roomId, this.io, opts);
    this.rooms.set(roomId, room);
    return room;
  }

  joinOrCreateRoom(socket, playerName, { debugMode = false } = {}) {
    let room;
    if (debugMode) {
      room = this.createRoom({ debugMode: true });
    } else {
      room = [...this.rooms.values()].find(r => !r.started && r.players.length < r.maxPlayers);
      if (!room) room = this.createRoom();
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
