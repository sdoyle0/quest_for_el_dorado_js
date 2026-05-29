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
  const debugBtn    = document.getElementById('debug-btn');

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
  let rubblePendingTileId = null;
  let rubbleCardsNeeded   = 0;

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

  debugBtn?.addEventListener('click', () => {
    client.debugState();
  });

  if (DEBUG) {
    const panel = document.createElement('div');
    panel.id = 'debug-panel';
    panel.innerHTML = `
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
  `;
    document.getElementById('game-screen').appendChild(panel);

    document.getElementById('debug-set-hand-btn').addEventListener('click', () => {
      const val = document.getElementById('debug-hand-input').value.trim();
      if (!val) return;
      client.debugSetHand(val.split(',').map(s => s.trim()).filter(Boolean));
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

    // Shift+click any tile to teleport instead of move
    const _originalTileClick = renderer.onTileClick;
    renderer.onTileClick = (tileId, event) => {
      if (event?.shiftKey) { client.debugTeleport(tileId); return; }
      _originalTileClick?.(tileId);
    };
  }

  client.onJoined = ({ roomId }) => {
    lobbyStatus.textContent = `Joined room ${roomId}. Waiting for opponent…`;
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

  function exitRubblePaymentMode() {
    rubblePendingTileId = null;
    rubbleCardsNeeded = 0;
    cardUI.exitRubblePaymentMode();
  }

  // ── Board ──────────────────────────────────────────────────────────────────
  renderer.onTileClick = (tileId) => {
    // Already in rubble-payment mode — ignore board clicks
    if (rubblePendingTileId) return;

    if (!selectedValidMoves.includes(tileId)) return;

    const tile = clientBoard.getTile(tileId);
    if (tile?.terrainType === 'rubble' && tile.movementCost > 1) {
      // Enter rubble payment mode instead of moving immediately
      rubblePendingTileId = tileId;
      rubbleCardsNeeded = tile.movementCost - 1; // movement card already "pays" 1
      cardUI.enterRubblePaymentMode(rubbleCardsNeeded, selectedCard?.instanceId, () => {
        // onConfirm: collect selected cards and fire single event
        const cardIds = cardUI.getRubblePaymentCards();
        client.moveToRubble(tileId, cardIds);
        // Clear movement card state so it can't be re-selected
        isMidMove = false;
        selectedCard = null;
        selectedValidMoves = [];
        renderer.clearHighlights();
        exitRubblePaymentMode(); 
      }, () => {
        // onCancel
        exitRubblePaymentMode();
      });

      return;
    }

    if (isMidMove) {
      client.movePawn(tileId);
      return;
    }
    if (selectedCard) {
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
    log(`Moved to ${tileId}`);
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
    log(`${nextPlayerName}'s turn.`);
  };

  // ── Final round ────────────────────────────────────────────────────────────
  // Fires when the first player reaches El Dorado but is NOT the last player
  // in the round. Every remaining player in this round takes one last turn.
  client.onFinalRoundStarted = ({ triggeredByPlayerId }) => {
    const trigger = allPlayers.find(p => p.id === triggeredByPlayerId);
    const triggerName = trigger?.name || 'A player';

    if (client.playerId === triggeredByPlayerId) {
      const msg = '🏆 You reached El Dorado! Other players take their final turn.';
      showModal(msg);
      log(msg);
    } else {
      const msg = `${triggerName} reached El Dorado! Take your final turn.`;
      showModal(msg);
      log(msg);
    }
  };

  client.onMarketUpdated  = ({ market }) => { cardUI.renderMarket(market); cardUI.showMarket(false); };
  client.onPurchaseOpened = ({ totalPurchasePower }) => cardUI.openMarketWithBonus(totalPurchasePower);
  client.onPurchaseClosed = () => cardUI.closeMarket();
  client.onPromptRemove   = ({ count })              => showModal(`Select ${count} card(s) to permanently remove from your deck.`);

  client.onGameWon = ({ playerId }) => {
    const winner = allPlayers.find(p => p.id === playerId);
    const winnerName = winner?.name || 'Someone';
    const msg = client.playerId === playerId
      ? '🏆 You win! El Dorado is yours!'
      : `${winnerName} wins the race to El Dorado. Game over.`;
    showModal(msg, false);
    log(msg);
  };

  // ── Reserve picker ─────────────────────────────────────────────────────────
  client.onPromptReserveChoice = ({ soldOutKey, reserveCards }) => {
    showReservePicker(soldOutKey, reserveCards);
  };

  function showReservePicker(soldOutKey, reserveCards) {
    const overlay    = document.getElementById('reserve-picker');
    const container  = document.getElementById('reserve-cards');
    const soldOutLbl = document.getElementById('reserve-sold-out-label');

    soldOutLbl.textContent = `Empty slot: ${soldOutKey.replace(/_/g, ' ')}`;
    container.innerHTML = '';

    for (const card of reserveCards) {
      const btn = document.createElement('button');
      btn.className = 'reserve-card-btn';

      const movesLine  = card.movementTotal > 0
        ? `<span>▶ ${card.movementTotal} ${card.movementTerrain}</span>` : '';
      const effectLine = card.specialEffect && card.specialEffect !== 'none'
        ? `<span style="color:#c0a830">★ ${card.specialEffect.replace(/_/g, ' ')}</span>` : '';

      btn.innerHTML = `
        <span style="font-weight:bold">${card.cardName}</span>
        <span style="color:#ffd700">Cost: ${card.cost}</span>
        <span style="color:#aaa">×${card.remaining} in reserve</span>
        ${movesLine}
        ${effectLine}`;

      btn.addEventListener('click', () => {
        client.chooseReserveCard(soldOutKey, card.key);
        overlay.classList.add('hidden');
        log(`Added ${card.cardName} to the market.`);
      });
      container.appendChild(btn);
    }

    overlay.classList.remove('hidden');
  }

  client.onActionError = ({ message }) => {
    isMidMove = false;
    selectedCard = null;
    selectedValidMoves = [];
    renderer.clearHighlights();
    exitRubblePaymentMode();
    log(`⚠ ${message}`);
  };

  function selectCardForMove(instanceId) {
    const card = localHand.find(c => c.instanceId === instanceId);
    if (!card) return;

    cardUI.updateSelectedCardForMovement(instanceId);

    // Toggle deselect — clicking the selected card again clears it
    if (selectedCard && selectedCard.instanceId === instanceId) {
      selectedCard = null;
      selectedValidMoves = [];
      renderer.clearHighlights();
      client.cancelCard(instanceId);
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
