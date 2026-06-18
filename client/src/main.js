document.addEventListener('DOMContentLoaded', () => {
  const DEBUG = new URLSearchParams(window.location.search).has('debug');

  // ── Screen refs ────────────────────────────────────────────────────────────
  const lobbyScreen   = document.getElementById('lobby-screen');
  const waitingScreen = document.getElementById('waiting-screen');
  const gameScreen    = document.getElementById('game-screen');

  function showScreen(name) {
    lobbyScreen.classList.toggle('active',   name === 'lobby');
    waitingScreen.classList.toggle('active', name === 'waiting');
    gameScreen.classList.toggle('active',    name === 'game');
  }

  // ── Lobby UI refs ──────────────────────────────────────────────────────────
  const nameInput      = document.getElementById('player-name-input');
  const lobbyStatus    = document.getElementById('lobby-status');
  const createRoomBtn  = document.getElementById('create-room-btn');
  const joinRoomBtn    = document.getElementById('join-room-btn');
  const roomCodeInput  = document.getElementById('room-code-input');
  const countBtns      = document.querySelectorAll('.count-btn');

  let selectedPlayerCount = 2;
  countBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      countBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedPlayerCount = Number(btn.dataset.count);
    });
  });

  // ── Waiting-room UI refs ───────────────────────────────────────────────────
  const roomCodeValue  = document.getElementById('room-code-value');
  const copyCodeBtn    = document.getElementById('copy-code-btn');
  const waitingSubtitle= document.getElementById('waiting-subtitle');
  const waitingPlayers = document.getElementById('waiting-players');
  const startGameBtn   = document.getElementById('start-game-btn');
  const waitingHint    = document.getElementById('waiting-hint');

  // ── Game UI refs ───────────────────────────────────────────────────────────
  const playerLabel  = document.getElementById('current-player-label');
  const turnBannerSub= document.getElementById('turn-banner-sub');
  const turnBanner   = document.getElementById('turn-banner');
  const turnDot      = document.getElementById('turn-color-dot');
  const legendEl     = document.getElementById('player-legend');
  const logEl        = document.getElementById('log-scroll');
  const boardEl      = document.getElementById('hex-board');
  const handUI       = document.getElementById('player-hand-ui');
  const zoomInBtn    = document.getElementById('zoom-in-btn');
  const zoomOutBtn   = document.getElementById('zoom-out-btn');

  // ── Board zoom — uses the scroll-inner wrapper so scrolling still works ───
  // The SVG itself keeps width/height 100% inside the inner wrapper.
  // We scale the wrapper instead, and update the wrapper's explicit pixel
  // dimensions so the parent container knows how large the content is.
  const boardScrollInner = document.getElementById('board-scroll-inner');

  let boardZoom = 1;
  const BOARD_ZOOM_STEP = 0.25;
  const BOARD_ZOOM_MIN  = 0.5;
  const BOARD_ZOOM_MAX  = 2.5;

  function updateBoardZoom() {
    // Scale the inner wrapper using transform-origin top-left so the board
    // grows toward the bottom-right (natural reading direction).
    boardScrollInner.style.transformOrigin = 'top left';
    boardScrollInner.style.transform = `scale(${boardZoom})`;
    // Explicitly set the logical size of the wrapper so the parent container
    // has real scrollable area to work with.
    const natural = boardScrollInner.dataset.naturalWidth
      ? Number(boardScrollInner.dataset.naturalWidth)
      : boardScrollInner.offsetWidth;
    const naturalH = boardScrollInner.dataset.naturalHeight
      ? Number(boardScrollInner.dataset.naturalHeight)
      : boardScrollInner.offsetHeight;
    // Store natural size after first measurement
    if (!boardScrollInner.dataset.naturalWidth) {
      boardScrollInner.dataset.naturalWidth  = boardScrollInner.offsetWidth;
      boardScrollInner.dataset.naturalHeight = boardScrollInner.offsetHeight;
    }
    // Make the wrapper physically occupy its scaled size so the parent scrollbar tracks it
    boardScrollInner.style.width  = (Number(boardScrollInner.dataset.naturalWidth)  * boardZoom) + 'px';
    boardScrollInner.style.height = (Number(boardScrollInner.dataset.naturalHeight) * boardZoom) + 'px';
  }

  // ── 3b. Toast notification helper ─────────────────────────────────────────
  function showToast(text, { icon = 'ℹ️', type = 'info', duration = 3500 } = {}) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-text">${text}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-out');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }, duration);
  }

  // ── 3d. Richer game log ────────────────────────────────────────────────────
  function log(msg, type = 'system') {
    const p = document.createElement('p');
    p.className = `log-${type}`;
    p.textContent = msg;
    logEl.prepend(p);
    // Cap log length to avoid unbounded growth
    if (logEl.children.length > 60) logEl.lastChild.remove();
  }

  // ── Game + client setup ────────────────────────────────────────────────────
  const socket      = io();
  const client      = new GameClient(socket);
  const renderer    = new HexRenderer(document.getElementById('hex-board'));
  const cardUI      = new CardUI();
  const clientBoard = new ElDoradoHexBoard.HexBoard();

  const PAWN_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'];
  let allPlayers         = [];
  let localHand          = [];
  let selectedCard       = null;
  let selectedValidMoves = [];
  let isMidMove          = false;
  let rubblePendingTileId = null;
  let rubbleCardsNeeded   = 0;

  // Waiting-room state (updated on player_joined / player_left)
  let waitingRoomState = { players: [], maxPlayers: 2, hostId: null };

  // ── Helpers ────────────────────────────────────────────────────────────────
  function getPlayerName() {
    return nameInput.value.trim() || 'Explorer';
  }

  function setLobbyError(msg) {
    lobbyStatus.textContent  = msg;
    lobbyStatus.style.color  = '#e74c3c';
  }
  function setLobbyInfo(msg) {
    lobbyStatus.textContent  = msg;
    lobbyStatus.style.color  = '#aaa';
  }

  // ── Waiting-room rendering ─────────────────────────────────────────────────
  function renderWaitingRoom() {
    const { players, maxPlayers, hostId } = waitingRoomState;
    roomCodeValue.textContent = client.roomId || '';
    waitingSubtitle.textContent = `${players.length} / ${maxPlayers} players joined`;

    waitingPlayers.innerHTML = '';
    for (let i = 0; i < maxPlayers; i++) {
      const p   = players[i];
      const row = document.createElement('div');
      row.className = 'waiting-player-row';

      const dot = document.createElement('span');
      dot.className = 'waiting-player-dot';
      dot.style.background = p ? PAWN_COLORS[i] : '#444';

      const name = document.createElement('span');
      name.className = 'waiting-player-name';
      name.textContent = p
        ? p.name + (p.id === hostId ? ' 👑' : '')
        : `Waiting for player ${i + 1}…`;
      name.style.color = p ? '#e0e0e0' : '#666';

      row.appendChild(dot);
      row.appendChild(name);
      waitingPlayers.appendChild(row);
    }

    const isHost     = client.isHost;
    const canStart   = isHost && (players.length >= 2 || (DEBUG && players.length >= 1));
    startGameBtn.disabled   = !canStart;
    startGameBtn.style.opacity = canStart ? '1' : '0.4';
    startGameBtn.style.cursor  = canStart ? 'pointer' : 'not-allowed';

    if (!isHost) {
      waitingHint.textContent = 'Waiting for the host to start…';
    } else if (players.length < 2 && !DEBUG) {
      waitingHint.textContent = 'Need at least 2 players to start.';
    } else if (players.length < 2 && DEBUG) {
      waitingHint.textContent = 'Debug mode: you can start solo or wait for others.';
    } else if (players.length < maxPlayers) {
      waitingHint.textContent = `You can start now, or wait for ${maxPlayers - players.length} more.`;
    } else {
      waitingHint.textContent = 'All players connected — ready to start!';
    }
  }

  // ── Lobby events ───────────────────────────────────────────────────────────
  createRoomBtn.addEventListener('click', () => {
    const name = getPlayerName();
    if (!name) { setLobbyError('Enter your name first.'); return; }
    setLobbyInfo('Creating room…');
    createRoomBtn.disabled = true;
    client.createRoom(name, selectedPlayerCount, DEBUG);
  });

  joinRoomBtn.addEventListener('click', () => {
    const name = getPlayerName();
    const code = roomCodeInput.value.trim().toUpperCase();
    if (!name) { setLobbyError('Enter your name first.'); return; }
    if (!code) { setLobbyError('Enter a room code.'); return; }
    setLobbyInfo('Joining…');
    joinRoomBtn.disabled = true;
    client.joinRoom(name, code);
  });

  // Allow Enter key in room code field
  roomCodeInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') joinRoomBtn.click();
  });

  copyCodeBtn.addEventListener('click', () => {
    const code = roomCodeValue.textContent;
    navigator.clipboard?.writeText(code).then(() => {
      copyCodeBtn.textContent = '✅';
      setTimeout(() => { copyCodeBtn.textContent = '📋'; }, 1500);
    });
  });

  startGameBtn.addEventListener('click', () => {
    if (!startGameBtn.disabled) client.startGame();
  });

  zoomInBtn?.addEventListener('click', () => {
    boardZoom = Math.min(BOARD_ZOOM_MAX, boardZoom + BOARD_ZOOM_STEP);
    updateBoardZoom();
  });
  zoomOutBtn?.addEventListener('click', () => {
    boardZoom = Math.max(BOARD_ZOOM_MIN, boardZoom - BOARD_ZOOM_STEP);
    updateBoardZoom();
  });

  // ── Debug mode: mark title, but use the normal lobby flow ────────────────
  if (DEBUG) {
    document.title += ' [DEBUG]';
    nameInput.value = 'Debug Player';
  }

  // ── Client callbacks ───────────────────────────────────────────────────────

  client.onJoined = (data) => {
    createRoomBtn.disabled = false;
    joinRoomBtn.disabled   = false;
    setLobbyInfo('');

    waitingRoomState = {
      players:    data.players || [],
      maxPlayers: data.maxPlayers,
      hostId:     data.hostId,
    };
    showScreen('waiting');
    renderWaitingRoom();
  };

  client.onJoinError = ({ message }) => {
    createRoomBtn.disabled = false;
    joinRoomBtn.disabled   = false;
    setLobbyError(message || 'Could not join room.');
  };

  // Waiting room: someone joined or left
  client.onRoomUpdated = (data) => {
    if (data.players)    waitingRoomState.players    = data.players;
    if (data.maxPlayers) waitingRoomState.maxPlayers  = data.maxPlayers;
    if (data.hostId)     waitingRoomState.hostId      = data.hostId;
    if (waitingScreen.classList.contains('active')) renderWaitingRoom();
  };

  client.onPlayerJoined = ({ player }) => log(`${player.name} joined.`);
  client.onPlayerLeft   = ({ socketId }) => {
    const p = allPlayers.find(p => p.id === socketId);
    if (p) log(`${p.name} left.`);
  };

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

    // 3c: toast on game start
    showToast('Expedition begun! Good luck.', { icon: '🗺️', type: 'accent' });
    log('Game started!', 'system');
  };

  // ── Board ──────────────────────────────────────────────────────────────────
  function exitRubblePaymentMode() {
    rubblePendingTileId = null;
    rubbleCardsNeeded = 0;
    cardUI.exitRubblePaymentMode();
  }

  renderer.onTileClick = (tileId) => {
    if (rubblePendingTileId) return;

    if (!selectedValidMoves.includes(tileId)) return;

    const tile = clientBoard.getTile(tileId);
    if (tile?.terrainType === 'rubble' && tile.movementCost > 1) {
      rubblePendingTileId = tileId;
      rubbleCardsNeeded = tile.movementCost - 1;
      cardUI.enterRubblePaymentMode(rubbleCardsNeeded, selectedCard?.instanceId, () => {
        const cardIds = cardUI.getRubblePaymentCards();
        client.moveToRubble(tileId, cardIds);
        isMidMove = false;
        selectedCard = null;
        selectedValidMoves = [];
        renderer.clearHighlights();
        exitRubblePaymentMode();
      }, () => {
        exitRubblePaymentMode();
      });

      return;
    }

    if (isMidMove || selectedCard) {
      client.movePawn(tileId);
      return;
    }
  };

  // ── Cards ──────────────────────────────────────────────────────────────────
  cardUI.onCardPlayed     = (instanceId)  => selectCardForMove(instanceId);
  cardUI.onEndTurn        = ()            => client.endTurn();
  cardUI.onDiscardClicked = ()            => client.discardCard(selectedCard.instanceId);
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

    // 3c: toast for opponent moves only (own moves are obvious)
    if (playerId !== client.playerId) {
      const name = player?.name || 'Opponent';
      showToast(`${name} moved`, { icon: '👣', type: 'info' });
      log(`${name} moved to ${tileId}`, 'move');
    } else {
      log(`Moved to ${tileId}`, 'move');
    }
  };

  client.onCardDisposed = () => {
    isMidMove = false;
    selectedCard = null;
    selectedValidMoves = [];
    renderer.clearHighlights();
    exitRubblePaymentMode();
  };

  client.onTurnEnded = ({ nextPlayerId, nextPlayerName }) => {
    isMidMove = false;
    selectedCard = null;
    selectedValidMoves = [];
    renderer.clearHighlights();
    updateTurnLabel(nextPlayerId);
    log(`${nextPlayerName}'s turn.`, 'turn');

    // 3c: toast only when it becomes THIS player's turn
    if (nextPlayerId === client.playerId) {
      showToast('Your turn!', { icon: '⚡', type: 'accent', duration: 2000 });
    }
  };

  // ── Final round ────────────────────────────────────────────────────────────
  client.onFinalRoundStarted = ({ triggeredByPlayerId }) => {
    const trigger = allPlayers.find(p => p.id === triggeredByPlayerId);
    const triggerName = trigger?.name || 'A player';

    // 3g: Final round banner drops from top
    if (!document.getElementById('final-round-banner')) {
      const banner = document.createElement('div');
      banner.id = 'final-round-banner';
      banner.textContent = '⚑ Final Round — Someone Has Reached El Dorado';
      document.body.appendChild(banner);
    }

    // 3c: toast for final round
    showToast('Final round! Someone reached El Dorado.', { icon: '🏆', type: 'accent', duration: 6000 });

    if (client.playerId === triggeredByPlayerId) {
      const msg = '🏆 You reached El Dorado! Other players take their final turn.';
      showModal(msg);
      log(msg, 'win');
    } else {
      const msg = `${triggerName} reached El Dorado! Take your final turn.`;
      showModal(msg);
      log(msg, 'warn');
    }
  };

  client.onMarketUpdated  = ({ market }) => { cardUI.renderMarket(market); cardUI.showMarket(false); };
  client.onPurchaseOpened = ({ totalPurchasePower }) => cardUI.openMarketWithBonus(totalPurchasePower);
  client.onPurchaseClosed = () => cardUI.closeMarket();
  client.onPromptRemove   = ({ count })              => showModal(`Select ${count} card(s) to permanently remove from your deck.`);

  client.onGameWon = ({ playerId }) => {
    const winner = allPlayers.find(p => p.id === playerId);
    const winnerName = winner?.name || 'Someone';
    const isMe = client.playerId === playerId;
    const msg = isMe
      ? '🏆 You win! El Dorado is yours!'
      : `${winnerName} wins the race to El Dorado. Game over.`;
    showModal(msg, false);
    log(msg, 'win');
    // 3c: toast for game over
    showToast(msg, { icon: '🏆', type: isMe ? 'accent' : 'info', duration: 8000 });
  };

  // ── Reserve picker ─────────────────────────────────────────────────────────
  client.onPromptReserveChoice = ({ soldOutKey, reserveCards }) => {
    cardUI.showReservePicker(soldOutKey, reserveCards, (chosenKey) => {
      client.chooseReserveCard(soldOutKey, chosenKey);
      log(`Added ${chosenKey.replace(/_/g, ' ')} to the market.`, 'purchase');
    });
  };

  client.onActionError = ({ message }) => {
    isMidMove = false;
    selectedCard = null;
    selectedValidMoves = [];
    renderer.clearHighlights();
    exitRubblePaymentMode();
    log(`⚠ ${message}`, 'warn');

    // 3c: error toast
    showToast(message, { icon: '⚠️', type: 'warn' });

    // 3h: shake the hand area
    const handEl = document.getElementById('player-hand-ui');
    handEl.classList.remove('shake');
    void handEl.offsetWidth; // force reflow to restart animation
    handEl.classList.add('shake');
  };

  function selectCardForMove(instanceId) {
    const card = localHand.find(c => c.instanceId === instanceId);
    if (!card) return;

    cardUI.updateSelectedCardForMovement(instanceId);

    // Toggle deselect
    if (selectedCard && selectedCard.instanceId === instanceId) {
      selectedCard = null;
      selectedValidMoves = [];
      renderer.clearHighlights();
      client.cancelCard(instanceId);
      return;
    }

    const player = allPlayers.find(p => p.id === client.playerId);
    if (!player) {
      log('Unable to select card: player state is not ready.', 'warn');
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
        log('No valid moves available for that card.', 'warn');
      } else {
        log(`Selected ${card.cardName || card.key}: ${moves.length} target(s) available.`, 'system');
      }
    }

    client.playCard(instanceId);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  // Returns the 1-2 character initials for a player name
  function _initials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  function updateTurnLabel(currentPlayerId) {
    const isMe  = client.isMyTurn(currentPlayerId);
    const idx   = allPlayers.findIndex(p => p.id === currentPlayerId);
    const p     = allPlayers.find(p => p.id === currentPlayerId);
    const color = PAWN_COLORS[idx] || '#aaa';

    playerLabel.textContent = isMe ? '▶ Your turn' : `${p?.name || '?'}'s turn`;

    // Sub-label: hand size for the active player
    if (turnBannerSub) {
      const handSz = p?.handSize ?? localHand.length;
      turnBannerSub.textContent = isMe
        ? `${localHand.length} card${localHand.length !== 1 ? 's' : ''} in hand`
        : `${handSz} card${handSz !== 1 ? 's' : ''} in hand`;
    }

    turnDot.style.background = color;
    turnBanner.style.color = color;
    turnBanner.style.borderColor = color;

    if (isMe) {
      turnBanner.classList.add('my-turn');
    } else {
      turnBanner.classList.remove('my-turn');
    }

    // 3e: "just became my turn" flash
    turnBanner.classList.remove('just-became-my-turn');
    void turnBanner.offsetWidth; // force reflow to restart animation
    if (isMe) turnBanner.classList.add('just-became-my-turn');

    // 3f: opponent-turn hand dimming
    handUI.classList.toggle('opponent-turn', !isMe);
    handUI.style.borderTopColor = isMe ? color : '#555';

    renderPlayerLegend(currentPlayerId);
    cardUI.setControlsEnabled(isMe);
  }

  function renderPlayerLegend(currentPlayerId) {
    legendEl.innerHTML = '';
    allPlayers.forEach((p, i) => {
      const isActive = p.id === currentPlayerId;
      const row = document.createElement('div');
      row.className = 'legend-row' + (isActive ? ' active-player' : '');

      // Avatar circle with initials
      const avatar = document.createElement('span');
      avatar.className = 'legend-avatar';
      avatar.style.background = PAWN_COLORS[i];
      avatar.textContent = _initials(p.name);

      const name = document.createElement('span');
      name.className = 'legend-name';
      name.textContent = p.name || `Player ${i + 1}`;

      // Hand count badge
      const handCount = document.createElement('span');
      handCount.className = 'legend-hand-count';
      const hSize = (p.id === client.playerId) ? localHand.length : (p.handSize ?? 0);
      handCount.textContent = hSize;

      row.appendChild(avatar);
      row.appendChild(name);

      if (p.id === client.playerId) {
        const you = document.createElement('span');
        you.className = 'legend-you';
        you.textContent = 'you';
        row.appendChild(you);
      }

      row.appendChild(handCount);
      legendEl.appendChild(row);
    });
  }

  function showModal(message, showCancel = false) {
    const overlay = document.getElementById('modal-overlay');
    document.getElementById('modal-message').textContent = message;
    document.getElementById('modal-cancel-btn').style.display = showCancel ? '' : 'none';
    overlay.classList.remove('hidden');
    document.getElementById('modal-confirm-btn').onclick = () => overlay.classList.add('hidden');
    document.getElementById('modal-cancel-btn').onclick  = () => overlay.classList.add('hidden');
  }

  // ── Debug mode ─────────────────────────────────────────────────────────────
  if (DEBUG) {
    const _origOnGameStarted = client.onGameStarted;
    client.onGameStarted = (data) => {
      _origOnGameStarted(data);
      appendDebugPanel();
    };
  }

  function appendDebugPanel() {
    if (document.getElementById('debug-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'debug-panel';
    panel.innerHTML = `
      <button id="debug-toggle-btn" title="Minimize debug panel">—</button>
      <div class="debug-row">
        <input id="debug-hand-input" placeholder="explorer,scout,transmitter" />
        <button id="debug-set-hand-btn">Set Hand</button>
      </div>
      <div class="debug-row">
        <input id="debug-tile-input" placeholder="tile id e.g. 5_-11" />
        <button id="debug-teleport-btn">Teleport</button>
      </div>
      <div class="debug-row">
        <span class="debug-presets-label">Presets:</span>
        <button class="debug-preset" data-hand="transmitter,scout,scout,explorer">Transmitter</button>
        <button class="debug-preset" data-hand="pioneer,giant_machete,adventurer,prop_plane">Speed run</button>
        <button class="debug-preset" data-hand="scientist,travel_log,cartographer,compass">Purple hand</button>
      </div>
      <div>
        <button id="debug-btn">Debug State</button>
      </div>`;
    document.getElementById('game-screen').appendChild(panel);

    // ── Toggle collapse ──────────────────────────────────────────────────────
    const toggleBtn = document.getElementById('debug-toggle-btn');
    toggleBtn.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('collapsed');
      toggleBtn.textContent = collapsed ? '▲' : '—';
      toggleBtn.title = collapsed ? 'Expand debug panel' : 'Minimize debug panel';
    });

    document.getElementById('debug-set-hand-btn').addEventListener('click', () => {
      const val = document.getElementById('debug-hand-input').value.trim();
      if (val) client.debugSetHand(val.split(',').map(s => s.trim()).filter(Boolean));
    });
    document.getElementById('debug-teleport-btn').addEventListener('click', () => {
      const tileId = document.getElementById('debug-tile-input').value.trim();
      if (tileId) client.debugTeleport(tileId);
    });
    panel.querySelectorAll('.debug-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const keys = btn.dataset.hand.split(',');
        client.debugSetHand(keys);
        document.getElementById('debug-hand-input').value = btn.dataset.hand;
      });
    });
    document.getElementById('debug-btn').addEventListener('click', () => client.debugState());

    const _origTileClick = renderer.onTileClick;
    renderer.onTileClick = (tileId, event) => {
      if (event?.shiftKey) { client.debugTeleport(tileId); return; }
      _origTileClick?.(tileId);
    };
  }
});