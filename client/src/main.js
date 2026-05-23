document.addEventListener('DOMContentLoaded', () => {
  const DEBUG = new URLSearchParams(window.location.search).has('debug');

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

  const PAWN_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'];
  let allPlayers = [];

  // ── Debug mode: auto-join immediately on page load ─────────────────────────
  if (DEBUG) {
    document.title += ' [DEBUG]';
    // Small delay so socket is ready
    setTimeout(() => client.joinGame('Debug Player', true), 100);
  }

  // ── Lobby ──────────────────────────────────────────────────────────────────
  joinBtn.addEventListener('click', () => {
    const name = nameInput.value.trim() || 'Explorer';
    lobbyStatus.textContent = 'Looking for a game...';
    client.joinGame(name, false);
  });

  client.onJoined = ({ roomId, debugMode }) => {
    if (debugMode) {
      lobbyStatus.textContent = `Debug room ${roomId} — starting solo...`;
    } else {
      lobbyStatus.textContent = `Joined room ${roomId}. Waiting for opponent…`;
    }
  };

  client.onPlayerJoined = ({ player }) => log(`${player.name} joined.`);

  // ── Game start ─────────────────────────────────────────────────────────────
  client.onGameStarted = ({ tiles, players, currentPlayerId, market, debugMode }) => {
    showScreen('game');
    allPlayers = players;

    renderer.render(tiles);

    players.forEach((p, i) => {
      if (p.currentTileId) renderer.setPawnPosition(p.id, p.currentTileId, PAWN_COLORS[i]);
    });

    cardUI.renderMarket(market);
    updateTurnLabel(currentPlayerId);

    if (debugMode) {
      log('🛠 Debug mode — solo game started');
    } else {
      log('Game started!');
    }
  };

  // ── Board ──────────────────────────────────────────────────────────────────
  renderer.onTileClick = (tileId) => client.movePawn(tileId);

  // ── Cards ──────────────────────────────────────────────────────────────────
  cardUI.onCardPlayed     = (instanceId) => client.playCard(instanceId);
  cardUI.onEndTurn        = ()            => client.endTurn();
  cardUI.onOpenMarket     = ()            => cardUI.showMarket(true);
  cardUI.onCancelPurchase = ()            => cardUI.showMarket(false);
  cardUI.onMarketCard     = (cardKey)     => client.purchaseCard(cardKey);

  // ── Server → UI events ─────────────────────────────────────────────────────
  client.onHandUpdated = ({ hand }) => cardUI.renderHand(hand);

  client.onCardPlayed = ({ validMoves }) => {
    renderer.setValidMoves(validMoves || []);
    log(`Card played — ${(validMoves || []).length} valid moves highlighted`);
  };

  client.onValidMoves = ({ validMoves }) => renderer.setValidMoves(validMoves || []);

  client.onPawnMoved = ({ playerId, tileId }) => {
    const idx = allPlayers.findIndex(p => p.id === playerId);
    renderer.setPawnPosition(playerId, tileId, PAWN_COLORS[idx] || '#aaa');
    renderer.clearHighlights();
    log(`Moved to ${tileId}`);
  };

  client.onCardDisposed = ({ hand }) => {
    // Card finished — update hand display
    cardUI.renderHand(hand);
    renderer.clearHighlights();
  };

  client.onTurnEnded = ({ nextPlayerId, nextPlayerName }) => {
    renderer.clearHighlights();
    updateTurnLabel(nextPlayerId);
    log(`${nextPlayerName}'s turn.`);
  };

  client.onMarketUpdated  = ({ market }) => { cardUI.renderMarket(market); cardUI.showMarket(false); };
  client.onPurchaseOpened = ({ totalPurchasePower }) => { cardUI.showMarket(true); cardUI.updatePurchaseTotal(totalPurchasePower); };
  client.onPurchaseClosed = ()                       => { cardUI.showMarket(false); cardUI.updatePurchaseTotal(0); };
  client.onPromptRemove   = ({ count })              => showModal(`Select ${count} card(s) to permanently remove from your deck.`);

  client.onGameWon = ({ playerId }) => {
    const msg = client.playerId === playerId ? '🏆 You reached El Dorado!' : 'Opponent reached El Dorado. Game over.';
    showModal(msg, false);
    log(msg);
  };

  // Show server-side errors in the log rather than silently swallowing them
  client.onActionError = ({ message }) => log(`⚠ ${message}`);

  // ── Helpers ────────────────────────────────────────────────────────────────
  function updateTurnLabel(currentPlayerId) {
    const isMe = client.isMyTurn(currentPlayerId);
    const p    = allPlayers.find(p => p.id === currentPlayerId);
    playerLabel.textContent = isMe ? '▶ Your turn' : `${p?.name || '?'}'s turn`;
    cardUI.setControlsEnabled(isMe);
  }

  function log(msg) {
    const p = document.createElement('p');
    p.textContent = msg;
    logEl.prepend(p);
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