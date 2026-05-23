// client/src/main.js
// Wires GameClient + HexRenderer + CardUI together.
// This is the browser-side equivalent of Main.gd _ready() and its signal connections.

document.addEventListener('DOMContentLoaded', () => {
  // --- Screens ---
  const lobbyScreen = document.getElementById('lobby-screen');
  const gameScreen  = document.getElementById('game-screen');
  const joinBtn     = document.getElementById('join-btn');
  const nameInput   = document.getElementById('player-name-input');
  const lobbyStatus = document.getElementById('lobby-status');
  const playerLabel = document.getElementById('current-player-label');
  const logEl       = document.getElementById('game-log');

  function showScreen(name) {
    lobbyScreen.classList.toggle('active', name === 'lobby');
    gameScreen.classList.toggle('active',  name === 'game');
  }

  // --- Init subsystems ---
  const socket   = io();
  const client   = new GameClient(socket);
  const renderer = new HexRenderer(document.getElementById('hex-board'));
  const cardUI   = new CardUI();

  // --- Lobby ---
  joinBtn.addEventListener('click', () => {
    const name = nameInput.value.trim() || 'Explorer';
    lobbyStatus.textContent = 'Looking for a game...';
    client.joinGame(name);
  });

  client.onJoined = ({ roomId }) => {
    lobbyStatus.textContent = `Joined room ${roomId}. Waiting for opponent...`;
  };

  client.onPlayerJoined = ({ player }) => {
    log(`${player.name} joined the game.`);
  };

  // --- Game start ---
  client.onGameStarted = ({ players, currentPlayerId, market }) => {
    showScreen('game');

    // Render pawns at start positions
    const colors = ['#e74c3c', '#3498db'];
    players.forEach((p, i) => {
      if (p.currentTileId) {
        renderer.setPawnPosition(p.id, p.currentTileId, colors[i]);
      }
    });

    cardUI.renderMarket(market.shopSlots);
    updateTurnLabel(currentPlayerId, players);
  };

  // --- Board interaction ---
  renderer.onTileClick = (tileId) => {
    client.movePawn(tileId);
  };

  // --- Cards ---
  cardUI.onCardPlayed = (cardKey) => {
    client.playCard(cardKey);
  };

  cardUI.onEndTurn = () => {
    client.endTurn();
  };

  cardUI.onOpenMarket = () => {
    cardUI.showMarket(true);
    // Server opens purchase mode when you play a non-transmitter card and click market
    // For regular purchasing, just show the market — no card needed first
  };

  cardUI.onMarketCard = (cardKey) => {
    client.purchaseCard(cardKey);
  };

  cardUI.onCancelPurchase = () => {
    // TODO: emit cancel to server if server tracks purchase state
    cardUI.showMarket(false);
  };

  cardUI.onDiscard = () => {
    // Discard the currently played card (if any)
    // TODO: track which card is "in play" on the client for the discard button
  };

  // --- Server events → UI updates ---

  client.onHandUpdated = ({ hand }) => {
    cardUI.renderHand(hand);
  };

  client.onCardPlayed = ({ validMoves }) => {
    renderer.setValidMoves(validMoves);
  };

  client.onValidMoves = ({ validMoves }) => {
    renderer.setValidMoves(validMoves);
  };

  client.onPawnMoved = ({ playerId, tileId }) => {
    renderer.setPawnPosition(playerId, tileId);
    renderer.clearHighlights();
    log(`Player moved to tile ${tileId}`);
  };

  client.onTurnEnded = ({ nextPlayerId, nextPlayerName }) => {
    playerLabel.textContent = `${nextPlayerName}'s turn`;
    renderer.clearHighlights();

    // Enable/disable controls based on whose turn it is
    const isMyTurn = client.isMyTurn(nextPlayerId);
    cardUI.setControlsEnabled(isMyTurn);
    log(`It's now ${nextPlayerName}'s turn.`);
  };

  client.onMarketUpdated = ({ market }) => {
    cardUI.renderMarket(market.shopSlots);
  };

  client.onPurchaseOpened = ({ totalPurchasePower }) => {
    cardUI.showMarket(true);
    cardUI.updatePurchaseTotal(totalPurchasePower);
  };

  client.onPurchaseClosed = () => {
    cardUI.showMarket(false);
    cardUI.updatePurchaseTotal(0);
  };

  client.onPromptRemove = ({ count }) => {
    showModal(`Choose ${count} card(s) from your hand to remove permanently.`, false);
  };

  client.onGameWon = ({ playerId }) => {
    const msg = client.isMyTurn(playerId) ? 'You reached El Dorado! You Win! 🏆' : 'Your opponent reached El Dorado. Game over.';
    showModal(msg, false);
    log(msg);
  };

  client.onLog = ({ message }) => log(message);

  // --- Helpers ---

  function log(msg) {
    const p = document.createElement('p');
    p.textContent = msg;
    logEl.appendChild(p);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function updateTurnLabel(currentPlayerId, players) {
    const current = players.find(p => p.id === currentPlayerId);
    if (current) playerLabel.textContent = `${current.name}'s turn`;
    cardUI.setControlsEnabled(client.isMyTurn(currentPlayerId));
  }

  function showModal(message, showCancel = true) {
    const overlay = document.getElementById('modal-overlay');
    document.getElementById('modal-message').textContent = message;
    document.getElementById('modal-cancel-btn').style.display = showCancel ? '' : 'none';
    overlay.classList.remove('hidden');

    document.getElementById('modal-confirm-btn').onclick = () => overlay.classList.add('hidden');
    document.getElementById('modal-cancel-btn').onclick  = () => overlay.classList.add('hidden');
  }
});
