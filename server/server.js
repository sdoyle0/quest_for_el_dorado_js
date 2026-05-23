// server/server.js
// Entry point — Express serves the client, Socket.io handles game events.
// This replaces Godot's built-in ENet/WebSocket multiplayer layer.

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const { GameManager } = require('./game/GameManager');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' }, // tighten this for production
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
  socket.on('join_game', ({ playerName }) => {
    const { room, player } = gameManager.joinOrCreateRoom(socket, playerName);
    socket.emit('joined_room', {
      roomId: room.roomId,
      playerId: player.id,
      playerNumber: player.playerNumber,
    });
  });

  // --- Game actions ---
  // Mirrors: MultiplayerService.notify_server_user_played_card (movement variant)
  socket.on('play_card', ({ cardKey }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) room.handlePlayCard(socket.id, cardKey);
  });

  // Mirrors: MultiplayerService.update_player_tile
  socket.on('move_pawn', ({ tileId }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) room.handleMovePawn(socket.id, tileId);
  });

  // Mirrors: MultiplayerService.player_ended_turn
  socket.on('end_turn', () => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) room.handleEndTurn(socket.id);
  });

  // Mirrors: MultiplayerService.notify_server_user_purchased_card
  socket.on('purchase_card', ({ cardKey }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) room.handlePurchaseCard(socket.id, cardKey);
  });

  // Mirrors: MultiplayerService.notify_server_user_played_card (discard variant)
  socket.on('discard_card', ({ cardKey }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room) room.handlePlayCard(socket.id, cardKey); // discard is handled in play logic
  });

  // --- Disconnect ---
  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.id}`);
    gameManager.handleDisconnect(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`El Dorado server running at http://localhost:${PORT}`);
});
