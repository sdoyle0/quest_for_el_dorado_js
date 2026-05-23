// client/src/main.js

document.addEventListener('DOMContentLoaded', () => {
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

  const socket   = io();
  const client   = new GameClient(socket);
  const renderer = new HexRenderer(document.getElementById('hex-board'));
  const cardUI   = new CardUI();

  // Track all players for pawn colors
  const PAWN_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'];
  let allPlayers = [];

  // ── Lobby ──────────────────────────────────────────────────────────────────
  joinBtn.addEventListener('click', () => {
    const name = nameInput.value.trim() || 'Explorer';
    lobbyStatus.textContent = 'Looking for a game...';
    client.joinGame(name);
  });

  client.onJoined = ({ roomId }) => {
    lobbyStatus.textContent = `Joined room ${roomId}. Waiting for opponent…`;
  };

  client.onPlayerJoined = ({ player }) => {
    log(`${player.name} joined.`);
  };

  // ── Game start — THIS is where tiles render ───────────────────────────────
  client.onGameStarted = ({ tiles, players, currentPlayerId, market }) => {
    showScreen('game');
    allPlayers = players;

    // Render the board!
    renderer.render(tiles);

    // Place pawns on start tiles
    players.forEach((p, i) => {
      if (p.currentTileId) renderer.setPawnPosition(p.id, p.currentTileId, PAWN_COLORS[i]);
    });

    cardUI.renderMarket(market);
    updateTurnLabel(currentPlayerId);
    log('Game started!');
  };

  // ── Board interaction ──────────────────────────────────────────────────────
  renderer.onTileClick = (tileId) => {
    client.movePawn(tileId);
  };

  // ── Cards ──────────────────────────────────────────────────────────────────
  cardUI.onCardPlayed = (instanceId) => client.playCard(instanceId);
  cardUI.onEndTurn    = ()            => client.endTurn();
  cardUI.onOpenMarket = ()            => cardUI.showMarket(true);
  cardUI.onCancelPurchase = ()        => cardUI.showMarket(false);
  cardUI.onMarketCard = ({ cardKey, fromReserve }) => client.purchaseCard(cardKey, fromReserve);

  // ── Server events → UI ─────────────────────────────────────────────────────
  client.onHandUpdated = ({ hand }) => {
    cardUI.renderHand(hand);
  };

  client.onCardPlayed = ({ validMoves }) => {
    renderer.setValidMoves(validMoves || []);
  };

  client.onValidMoves = ({ validMoves }) => {
    renderer.setValidMoves(validMoves || []);
  };

  client.onPawnMoved = ({ playerId, tileId }) => {
    const playerIdx = allPlayers.findIndex(p => p.id === playerId);
    renderer.setPawnPosition(playerId, tileId, PAWN_COLORS[playerIdx] || '#aaa');
    renderer.clearHighlights();
  };

  client.onTurnEnded = ({ nextPlayerId, nextPlayerName }) => {
    renderer.clearHighlights();
    updateTurnLabel(nextPlayerId);
    log(`${nextPlayerName}'s turn.`);
  };

  client.onMarketUpdated = ({ market }) => {
    cardUI.renderMarket(market);
    cardUI.showMarket(false);
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
    showModal(`Select ${count} card(s) from your hand to permanently remove.`);
  };

  client.onLogUpdated = ({ text }) => log(text);

  client.onGameWon = ({ playerId }) => {
    const msg = client.playerId === playerId
      ? '🏆 You reached El Dorado! You win!'
      : 'Your opponent reached El Dorado. Game over.';
    showModal(msg, false);
    log(msg);
  };

  // ── Helpers ────────────────────────────────────────────────────────────────
  function updateTurnLabel(currentPlayerId) {
    const p = allPlayers.find(p => p.id === currentPlayerId);
    playerLabel.textContent = p ? `${p.name}'s turn` : 'Waiting…';
    cardUI.setControlsEnabled(client.isMyTurn(currentPlayerId));
  }

  function log(msg) {
    const p = document.createElement('p');
    p.textContent = msg;
    logEl.prepend(p); // newest at top
  }

  function showModal(message, showCancel = false) {
    const overlay = document.getElementById('modal-overlay');
    document.getElementById('modal-message').textContent = message;
    document.getElementById('modal-cancel-btn').style.display = showCancel ? '' : 'none';
    overlay.classList.remove('hidden');
    document.getElementById('modal-confirm-btn').onclick = () => overlay.classList.add('hidden');
    document.getElementById('modal-cancel-btn').onclick  = () => overlay.classList.add('hidden');
  }
});
