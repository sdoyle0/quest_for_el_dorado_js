// server/server.js
// Entry point — Express serves the client, Socket.io handles game events.
// This replaces Godot's built-in ENet/WebSocket multiplayer layer.

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const { GameManager } = require('./game/GameManager');
const { CARD_DEFINITIONS, getPurchasingPower } = require('../shared/cardData');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' }, // tighten this for production
  pingTimeout: 600000,   // Time in ms before a client is considered disconnected (default: 20000)
  pingInterval: 25000   // Time in ms before sending a new ping (default: 25000)
});

const PORT = process.env.PORT || 3000;

app.use('/shared', express.static(path.join(__dirname, '../shared')));

// Serve the client from /client
app.use(express.static(path.join(__dirname, '..', 'client')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// -------------------------------------------------------
// Game manager
// -------------------------------------------------------
const gameManager = new GameManager(io);

// -------------------------------------------------------
// Socket.io events
// Each event here mirrors an RPC call in MultiplayerService.gd
// -------------------------------------------------------
io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  // --- Lobby ---
  socket.on('join_game', ({ playerName, debugMode = false }) => {
    const { room, player } = gameManager.joinOrCreateRoom(socket, playerName, { debugMode });
    socket.emit('joined_room', {
      roomId: room.roomId,
      playerId: player.id,
      playerNumber: player.playerNumber,
      debugMode,
    });
  });

  // --- Game actions ---
  socket.on('play_card', ({ instanceId }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) room.handlePlayCard(socket.id, instanceId);
  });

  socket.on('cancel_card', () => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) room.handleCancelCard(socket.id);
  });

  socket.on('move_pawn', ({ tileId }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) room.handleMovePawn(socket.id, tileId);
  });

  socket.on('move_to_rubble', ({ tileId, extraCardIds }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) room.handleMoveToRubble(socket.id, tileId, extraCardIds);
  });

  socket.on('end_turn', () => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) room.handleEndTurn(socket.id);
  });

  // Mirrors: MultiplayerService.notify_server_user_purchased_card
  socket.on('purchase_card', ({ cardKey, handCardsUsed = [] }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) room.handlePurchaseCard(socket.id, cardKey, handCardsUsed);
  });

  // Buyer chose which reserve card fills the empty market slot
  socket.on('choose_reserve_card', ({ soldOutKey, chosenKey }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) room.handleChooseReserveCard(socket.id, soldOutKey, chosenKey);
  });

  // Mirrors: MultiplayerService.notify_server_user_played_card (discard variant)
  socket.on('discard_card', ({ cardKey }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) room.handlePlayCard(socket.id, cardKey, true); // discard is handled in play logic
  });

  socket.on('debug_state', () => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) console.log(room.gameState);
  });

  // --- Disconnect ---
  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.id}`);
    gameManager.handleDisconnect(socket.id);
  });

  socket.on('debug_set_hand', ({ cardKeys }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;

    const cardMap = new Map(CARD_DEFINITIONS.map(c => [c.key, c]));

    const newHand = cardKeys
      .map((key, i) => {
        const def = cardMap.get(key);
        if (!def) { console.warn('debug_set_hand: unknown key', key); return null; }
        return {
          ...def,
          purchasingPower: getPurchasingPower(def),
          instanceId: `debug-${key}-${i}-${Date.now()}`,  // ← must be unique
        };
      })
      .filter(Boolean);

    player.hand = newHand;

    // Must emit to the socket directly, not broadcast
    socket.emit('hand_updated', { hand: newHand });
  });

  socket.on('debug_teleport', ({ tileId }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    player.currentTileId = tileId;
    room._broadcast('pawn_moved', { playerId: player.id, tileId });
  });
});

server.listen(PORT, () => {
  console.log(`El Dorado server running at http://localhost:${PORT}`);
});
