document.addEventListener('DOMContentLoaded', () => {
  const DEBUG = new URLSearchParams(window.location.search).has('debug');

  const lobbyScreen = document.getElementById('lobby-screen');
  const gameScreen  = document.getElementById('game-screen');
  const joinBtn     = document.getElementById('join-btn');
  const nameInput   = document.getElementById('player-name-input');
  const lobbyStatus = document.getElementById('lobby-status');
  const playerLabel = document.getElementById('current-player-label');
  const logEl       = document.getElementById('game-log');
  const boardEl     = document.getElementById('hex-board');
  const zoomInBtn   = document.getElementById('zoom-in-btn');
  const zoomOutBtn  = document.getElementById('zoom-out-btn');

  let boardZoom = 1;
  const BOARD_ZOOM_STEP = 0.25;
  const BOARD_ZOOM_MIN = 0.5;
  const BOARD_ZOOM_MAX = 2.5;

  function updateBoardZoom() {
    boardEl.style.transform = `scale(${boardZoom})`;
  }

  function showScreen(name) {
    lobbyScreen.classList.toggle('active', name === 'lobby');
    gameScreen.classList.toggle('active',  name === 'game');
  }

  const socket   = io();
  const client   = new GameClient(socket);
  const renderer = new HexRenderer(document.getElementById('hex-board'));
  const cardUI   = new CardUI();
  const clientBoard = new ElDoradoHexBoard.HexBoard();

  const PAWN_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'];
  let allPlayers = [];
  let localHand = [];
  let selectedCard = null;
  let selectedValidMoves = [];
  let isMidMove = false;

  // ── Debug mode: auto-join immediately on page load ─────────────────────────
  if (DEBUG) {
    document.title += ' [DEBUG]';
    // Small delay so socket is ready
    setTimeout(() => client.joinGame('Debug Player'), 100);
  }

  // ── Lobby ──────────────────────────────────────────────────────────────────
  joinBtn.addEventListener('click', () => {
    const name = nameInput.value.trim() || 'Explorer';
    lobbyStatus.textContent = 'Looking for a game...';
    client.joinGame(name);
  });

  zoomInBtn?.addEventListener('click', () => {
    boardZoom = Math.min(BOARD_ZOOM_MAX, boardZoom + BOARD_ZOOM_STEP);
    updateBoardZoom();
  });

  zoomOutBtn?.addEventListener('click', () => {
    boardZoom = Math.max(BOARD_ZOOM_MIN, boardZoom - BOARD_ZOOM_STEP);
    updateBoardZoom();
  });

  client.onJoined = ({ roomId }) => {
    lobbyStatus.textContent = `Joined room ${roomId}. Waiting for opponent…`;

    if (DEBUG) {
      updateTurnLabel(client.playerId);
    }
  };

  client.onPlayerJoined = ({ player }) => log(`${player.name} joined.`);

  // ── Game start ─────────────────────────────────────────────────────────────
  client.onGameStarted = ({ tiles, players, currentPlayerId, market }) => {
    showScreen('game');
    allPlayers = players;
    clientBoard.loadMap({ tiles });

    renderer.render(tiles);

    players.forEach((p, i) => {
      if (p.currentTileId) renderer.setPawnPosition(p.id, p.currentTileId, PAWN_COLORS[i]);
    });

    cardUI.renderMarket(market);
    updateTurnLabel(currentPlayerId);

    selectedCard = null;
    selectedValidMoves = [];

    log('Game started!');
  };

  // ── Board ──────────────────────────────────────────────────────────────────
  renderer.onTileClick = (tileId) => {
    if (isMidMove && selectedValidMoves.includes(tileId)) {
      client.movePawn(tileId);
      return;
    }
    if (selectedCard && selectedValidMoves.includes(tileId)) {
      client.executeMove(selectedCard.instanceId, tileId);
      return;
    }
  };

  // ── Cards ──────────────────────────────────────────────────────────────────
  cardUI.onCardPlayed     = (instanceId)  => selectCardForMove(instanceId);
  cardUI.onEndTurn        = ()            => client.endTurn();
  cardUI.onOpenMarket     = ()            => cardUI.showMarket(true);
  cardUI.onCancelPurchase = ()            => cardUI.showMarket(false);
  cardUI.onMarketCard     = ({ cardKey, handCardsUsed }) => client.purchaseCard(cardKey, handCardsUsed);

  // ── Server → UI events ─────────────────────────────────────────────────────
  client.onHandUpdated = ({ hand }) => {
    localHand = hand;
    cardUI.renderHand(hand);
    if (!isMidMove) {
      selectedCard = null;
      selectedValidMoves = [];
    }
  };

  client.onCardPlayed = ({ validMoves }) => {
    renderer.setValidMoves(validMoves || []);
    log(`Card played — ${(validMoves || []).length} valid moves highlighted`);
  };

  client.onValidMoves = ({ validMoves }) => {
    isMidMove = true;
    selectedValidMoves = validMoves || [];
    renderer.setValidMoves(selectedValidMoves);
  };

  client.onPawnMoved = ({ playerId, tileId }) => {
    const idx = allPlayers.findIndex(p => p.id === playerId);
    const player = allPlayers.find(p => p.id === playerId);
    if (player) player.currentTileId = tileId;
    renderer.setPawnPosition(playerId, tileId, PAWN_COLORS[idx] || '#aaa');
    renderer.clearHighlights();
    log(`Moved to ${tileId}`);
    // Don't clear selectedCard/isMidMove — valid_moves_updated fires if more steps remain,
    // card_disposed fires when done
  };

  client.onCardDisposed = () => {
    isMidMove = false;
    selectedCard = null;
    selectedValidMoves = [];
    renderer.clearHighlights();
  };

  client.onTurnEnded = ({ nextPlayerId, nextPlayerName }) => {
    isMidMove = false;
    selectedCard = null;
    selectedValidMoves = [];
    renderer.clearHighlights();
    updateTurnLabel(nextPlayerId);
    log(`${nextPlayerName}'s turn.`);
  };

  client.onMarketUpdated  = ({ market }) => { cardUI.renderMarket(market); cardUI.showMarket(false); };
  client.onPurchaseOpened = ({ totalPurchasePower }) => cardUI.openMarketWithBonus(totalPurchasePower);
  client.onPurchaseClosed = () => cardUI.closeMarket();
  client.onPromptRemove   = ({ count })              => showModal(`Select ${count} card(s) to permanently remove from your deck.`);

  client.onGameWon = ({ playerId }) => {
    const msg = client.playerId === playerId ? '🏆 You reached El Dorado!' : 'Opponent reached El Dorado. Game over.';
    showModal(msg, false);
    log(msg);
  };

  client.onActionError = ({ message }) => {
    isMidMove = false;
    selectedCard = null;
    selectedValidMoves = [];
    renderer.clearHighlights();
    log(`⚠ ${message}`);
  };

  function selectCardForMove(instanceId) {
    const card = localHand.find(c => c.instanceId === instanceId);
    if (!card) return;

    // Toggle deselect — clicking the selected card again clears it
    if (selectedCard && selectedCard.instanceId === instanceId) {
      selectedCard = null;
      selectedValidMoves = [];
      renderer.clearHighlights();
      return;
    }

    const player = allPlayers.find(p => p.id === client.playerId);
    if (!player) {
      log('Unable to select card: player state is not ready.');
      return;
    }

    if (card.movementTotal > 0 || card.specialEffect === ElDoradoConstants.CardEffect.NATIVE) {
      const moves = clientBoard.getValidMoves({
        currentTileId: player.currentTileId,
        playedCard: card,
        movesRemaining: card.movementTotal,
        wildCardTerrain: null,
        players: allPlayers,
        handSize: localHand.length,
      });

      selectedCard = card;
      selectedValidMoves = moves;
      renderer.setValidMoves(moves);

      if (moves.length === 0) {
        log('No valid moves available for that card.');
      } else {
        log(`Selected ${card.cardName || card.key}: ${moves.length} target(s) available.`);
      }
      return;
    }

    client.playCard(instanceId);
  }

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