// client/src/game/CardUI.js
//
// Cards are rendered once into #hand-cards and kept in the DOM.
// A single delegated click handler on the container dispatches to the right
// action based on this._mode ('movement' | 'market' | 'rubble').
// Pool membership (market selection, rubble selection) is reflected by
// toggling CSS classes on the existing buttons — no rebuilds.

class CardUI {
  constructor() {
    this.handEl   = document.getElementById('hand-cards');
    this.shopEl   = document.getElementById('shop-slots');
    this.totalEl  = document.getElementById('purchase-total');
    this.marketEl = document.getElementById('card-market');

    // Callbacks — set by main.js
    this.onCardPlayed     = null; // (instanceId) — play for movement
    this.onMarketCard     = null; // ({ cardKey, handCardsUsed }) — purchase
    this.onEndTurn        = null;
    this.onCancelPurchase = null;
    this.onDiscardClicked = null;

    // ── Mode ────────────────────────────────────────────────────────────────
    // 'movement' | 'market' | 'rubble'
    this._mode = 'movement';

    // ── Shared state ────────────────────────────────────────────────────────
    this._currentHand      = [];
    this._lastMarket       = null;

    // ── Market state ────────────────────────────────────────────────────────
    this._transmitterBonus = 0;
    this._purchasePool     = new Map(); // instanceId → card

    // ── Rubble state ────────────────────────────────────────────────────────
    this._rubbleNeeded    = 0;
    this._rubblePool      = new Map(); // instanceId → card
    this._rubbleExcludeId = null;
    this._rubbleOnConfirm = null;
    this._rubbleOnCancel  = null;

    this._bindControls();
    this._bindHandDelegate();
  }

  // ── Static control bindings ──────────────────────────────────────────────

  _bindControls() {
    document.getElementById('end-turn-btn').addEventListener('click', () => this.onEndTurn?.());
    document.getElementById('open-market-btn').addEventListener('click', () => this.openMarket());
    document.getElementById('discard-btn').addEventListener('click', () => this.onDiscardClicked?.());
    document.getElementById('cancel-purchase-btn').addEventListener('click', () => this.closeMarket());
  }

  // ── Single delegated click handler on #hand-cards ────────────────────────

  _bindHandDelegate() {
    this.handEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.card-btn');
      if (!btn) return;
      const instanceId = btn.dataset.instanceId;
      if (!instanceId) return;

      if (this._mode === 'movement') {
        this._handleMovementClick(instanceId, btn);
      } else if (this._mode === 'market') {
        this._handleMarketPoolClick(instanceId, btn);
      } else if (this._mode === 'rubble') {
        this._handleRubblePoolClick(instanceId, btn);
      }
    });
  }

  _handleMovementClick(instanceId) {
    this.onCardPlayed?.(instanceId);
  }

  _handleMarketPoolClick(instanceId, btn) {
    const card = this._currentHand.find(c => c.instanceId === instanceId);
    if (!card) return;

    if (this._purchasePool.has(instanceId)) {
      this._purchasePool.delete(instanceId);
      btn.classList.remove('in-pool');
    } else {
      this._purchasePool.set(instanceId, card);
      btn.classList.add('in-pool');
    }
    this._updatePurchaseTotal();
  }

  _handleRubblePoolClick(instanceId, btn) {
    if (instanceId === this._rubbleExcludeId) return;
    const card = this._currentHand.find(c => c.instanceId === instanceId);
    if (!card) return;

    if (this._rubblePool.has(instanceId)) {
      this._rubblePool.delete(instanceId);
      btn.classList.remove('in-pool');
    } else if (this._rubblePool.size < this._rubbleNeeded) {
      this._rubblePool.set(instanceId, card);
      btn.classList.add('in-pool');
    }
    this._syncRubbleConfirmButton();
  }

  // ── Core hand render — called once per hand change ───────────────────────
  //
  // Diffs the DOM against this._currentHand:
  //   • Cards no longer in hand → removed
  //   • Cards already rendered → updated in-place (name/stats may change on
  //     debug hand-set; instanceId is the stable key)
  //   • New cards → appended
  //
  // After the diff, _syncHandState() applies the correct CSS classes for the
  // current mode (selected, in-pool, rubble-excluded, etc.) without touching
  // innerHTML.

  renderHand(cards) {
    this._currentHand = cards;

    const existingIds = new Set(
      [...this.handEl.querySelectorAll('.card-btn')].map(b => b.dataset.instanceId)
    );
    const incomingIds = new Set(cards.map(c => c.instanceId));

    // Remove cards no longer in hand
    for (const btn of [...this.handEl.querySelectorAll('.card-btn')]) {
      if (!incomingIds.has(btn.dataset.instanceId)) btn.remove();
    }

    // Add new cards (append in hand order)
    for (const card of cards) {
      if (!existingIds.has(card.instanceId)) {
        this.handEl.appendChild(this._makeCardButton(card));
      }
    }

    // Ensure DOM order matches hand order
    for (const card of cards) {
      const btn = this.handEl.querySelector(`[data-instance-id="${CSS.escape(card.instanceId)}"]`);
      if (btn) this.handEl.appendChild(btn); // appendChild moves if already present
    }

    // Prune stale pool entries (cards that left the hand)
    for (const id of [...this._purchasePool.keys()]) {
      if (!incomingIds.has(id)) this._purchasePool.delete(id);
    }
    for (const id of [...this._rubblePool.keys()]) {
      if (!incomingIds.has(id)) this._rubblePool.delete(id);
    }

    this._syncHandState();
    if (this._mode === 'market') this._updatePurchaseTotal();
  }

  // Apply CSS classes to every card button to reflect current mode + pools.
  _syncHandState() {
    for (const btn of this.handEl.querySelectorAll('.card-btn')) {
      const id = btn.dataset.instanceId;

      // Rubble-excluded cards are visually dimmed and non-interactive
      const excluded = this._mode === 'rubble' && id === this._rubbleExcludeId;
      btn.classList.toggle('rubble-excluded', excluded);
      btn.disabled = excluded;

      // Pool membership
      if (this._mode === 'market') {
        btn.classList.toggle('in-pool', this._purchasePool.has(id));
        btn.classList.remove('selected');
      } else if (this._mode === 'rubble') {
        btn.classList.toggle('in-pool', this._rubblePool.has(id));
        btn.classList.remove('selected');
      } else {
        btn.classList.remove('in-pool');
        btn.disabled = false;
      }
    }
  }

  // ── Card button factory — only called for NEW cards ──────────────────────

  _makeCardButton(card) {
    const btn = document.createElement('button');
    btn.className = 'card-btn' + (card.movementTerrain ? ` terrain-${card.movementTerrain}` : '');
    btn.dataset.instanceId = card.instanceId;

    const terrainIcon = this._terrainIcon(card.movementTerrain);
    const movesLabel  = card.movementTotal > 0
      ? `<span class="card-moves">${terrainIcon} ${card.movementTotal}</span>` : '';
    const oneTimeLabel = card.oneTimeUse ? '<span class="card-onetime">⚡ One-time</span>' : '';
    const powerLabel  = card.purchasingPower
      ? `<span class="card-gold">💰 ${card.purchasingPower}</span>` : '';
    const effectDesc = this._specialDescription(card.specialEffect);
    const effectLabel = effectDesc
      ? `<span class="card-effect-desc">${effectDesc}</span>` : '';

    btn.innerHTML = `
      <span class="card-name">${card.cardName || card.key}</span>
      ${movesLabel}
      ${powerLabel}
      ${effectLabel}
      ${oneTimeLabel}`;
    return btn;
  }

  _terrainIcon(terrain) {
    switch (terrain) {
      case 'jungle':  return '🌿';
      case 'water':   return '🌊';
      case 'village': return '🏘️';
      case 'wild':    return '🧭';
      case 'empty':   return '✨';
      default:        return '';
    }
  }

  _specialDescription(effect) {
    switch (effect) {
      case 'transmitter':  return '📡 Buy from reserve';
      case 'cartographer': return '🗺️ Draw 2 extra cards';
      case 'compass':      return '🧭 Remove 1 card from game';
      case 'scientist':    return '🔬 Treat as any terrain (1)';
      case 'travel_log':   return '📖 Reuse a played card';
      case 'native':       return '🏹 Wild move + draw 1 card';
      default:             return '';
    }
  }

  // ── Mode transitions ─────────────────────────────────────────────────────

  _setMode(mode) {
    this._mode = mode;
    this._syncHandState();
  }

  // ── Market open / close ──────────────────────────────────────────────────

  openMarket(transmitterBonus = 0) {
    this._transmitterBonus = transmitterBonus;
    this._purchasePool.clear();
    this.marketEl.classList.remove('hidden');
    this._setMode('market');
    if (this._lastMarket) this.renderMarket(this._lastMarket);
    this._updatePurchaseTotal();
  }

  closeMarket() {
    this._transmitterBonus = 0;
    this._purchasePool.clear();
    this.marketEl.classList.add('hidden');
    this._setMode('movement');
  }

  openMarketWithBonus(totalPurchasePower) {
    this.openMarket(totalPurchasePower);
  }

  _syncRubbleConfirmButton() {
    const btn = document.getElementById('rubble-confirm-btn');
    if (!btn) return;
    const ready = this._rubblePool.size >= this._rubbleNeeded;
    btn.disabled      = !ready;
    btn.style.opacity = ready ? '1' : '.4';
    btn.style.cursor  = ready ? 'pointer' : 'not-allowed';
    // Keep in-pool classes in sync with DOM
    this._syncHandState();
  }

  // ── Selected-card highlight (movement mode) ──────────────────────────────

  updateSelectedCardForMovement(instanceId) {
    for (const btn of this.handEl.querySelectorAll('.card-btn')) {
      btn.classList.toggle('selected', btn.dataset.instanceId === instanceId);
    }
  }

  // ── Market rendering ─────────────────────────────────────────────────────

  renderMarket(market) {
    this._lastMarket = market;
    this.shopEl.innerHTML = '';

    const isTransmitter = this._transmitterBonus > 0;

    const shopHeader = document.createElement('div');
    shopHeader.className = 'market-section-header';
    shopHeader.textContent = 'Shop';
    this.shopEl.appendChild(shopHeader);

    const shopRow = document.createElement('div');
    shopRow.className = 'market-row';
    this.shopEl.appendChild(shopRow);

    for (const card of (market?.shop ?? [])) {
      shopRow.appendChild(this._makeMarketCardEl(card, false));
    }

    const reserveCards = (market?.reserve ?? []).filter(c => c && c.remaining > 0);
    if (reserveCards.length > 0) {
      const divider = document.createElement('div');
      divider.className = 'market-divider';
      this.shopEl.appendChild(divider);

      const reserveHeader = document.createElement('div');
      reserveHeader.className = 'market-section-header market-reserve-header';
      reserveHeader.textContent = isTransmitter
        ? 'Reserve (Transmitter: buyable)'
        : 'Reserve (not yet available)';
      this.shopEl.appendChild(reserveHeader);

      const reserveRow = document.createElement('div');
      reserveRow.className = 'market-row';
      this.shopEl.appendChild(reserveRow);

      for (const card of reserveCards) {
        reserveRow.appendChild(this._makeMarketCardEl(card, true, isTransmitter));
      }
    }

    if (this._mode === 'market') this._updateAffordability();
  }

  _makeMarketCardEl(card, isReserve, transmitterActive = false) {
    if (!card || card.remaining === 0) {
      const empty = document.createElement('div');
      empty.className = 'market-card empty';
      empty.textContent = card ? `${card.cardName} (sold out)` : '—';
      return empty;
    }

    const btn = document.createElement('button');
    const reserveClass = isReserve ? ' market-reserve' : '';
    const terrainClass = card.movementTerrain ? ` terrain-${card.movementTerrain}` : '';
    btn.className = `market-card${reserveClass}${terrainClass}`;
    btn.dataset.cardKey = card.key;

    const terrainIcon = this._terrainIcon(card.movementTerrain);
    const movesLabel  = card.movementTotal > 0
      ? `<span class="card-moves">${terrainIcon} ${card.movementTotal}</span>` : '';
    const oneTimeLabel = card.oneTimeUse ? '<span class="card-onetime">⚡ One-time</span>' : '';
    const effectDesc = this._specialDescription(card.specialEffect);
    const effectLabel = effectDesc
      ? `<span class="card-effect-desc">${effectDesc}</span>` : '';

    btn.innerHTML = `
      <span class="card-name">${card.cardName}</span>
      ${movesLabel}
      <span class="card-cost">💰 Cost: ${card.cost}</span>
      <span class="card-remaining">×${card.remaining} left</span>
      ${effectLabel}
      ${oneTimeLabel}`;

    if (isReserve && !transmitterActive) {
      btn.classList.add('reserve-locked');
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () => this._onMarketCardClicked(card));
    }

    return btn;
  }

  _onMarketCardClicked(card) {
    const power = this._currentPurchasePower();
    if (power < card.cost) {
      if (this.totalEl) {
        this.totalEl.style.color = '#e74c3c';
        setTimeout(() => { this.totalEl.style.color = ''; }, 600);
      }
      return;
    }
    const handCardsUsed = [...this._purchasePool.keys()];
    this.onMarketCard?.({ cardKey: card.key, handCardsUsed });
  }

  // ── Purchase power ────────────────────────────────────────────────────────

  _currentPurchasePower() {
    let total = this._transmitterBonus;
    for (const card of this._purchasePool.values()) {
      total += card.purchasingPower ?? 0;
    }
    return total;
  }

  _updatePurchaseTotal() {
    const power = this._currentPurchasePower();
    if (this.totalEl) this.totalEl.textContent = `💰 ${power.toFixed(1)}`;
    this._updateAffordability();
  }

  _updateAffordability() {
    const power = this._currentPurchasePower();
    this.shopEl.querySelectorAll('.market-card:not(.empty):not(.reserve-locked)').forEach(btn => {
      const costEl = btn.querySelector('.card-cost');
      if (!costEl) return;
      const cost = parseFloat(costEl.textContent.replace(/[^0-9.]/g, ''));
      const affordable = power >= cost;
      btn.classList.toggle('cant-afford', !affordable);
      btn.classList.toggle('can-afford', affordable);
    });
  }

  updatePurchaseTotal(total) {
    this._transmitterBonus = total;
    this._updatePurchaseTotal();
  }

  // ── Misc ──────────────────────────────────────────────────────────────────

  showMarket(visible) {
    if (visible) this.openMarket();
    else this.closeMarket();
  }

  setControlsEnabled(enabled) {
    document.getElementById('end-turn-btn').disabled    = !enabled;
    document.getElementById('open-market-btn').disabled = !enabled;
  }

  // ── Rubble payment mode ──────────────────────────────────────────────────

  enterRubblePaymentMode(count, excludeInstanceId, onConfirm, onCancel) {
    this._rubbleNeeded    = count;
    this._rubbleExcludeId = excludeInstanceId ?? null;
    this._rubblePool      = new Map();
    this._rubbleOnConfirm = onConfirm;
    this._rubbleOnCancel  = onCancel;

    this._setMode('rubble');
    this._renderRubbleControls();
  }

  exitRubblePaymentMode() {
    this._rubblePool      = new Map();
    this._rubbleNeeded    = 0;
    this._rubbleExcludeId = null;
    document.getElementById('hand-messages').innerHTML = '';
    this._setMode('movement');
  }

  getRubblePaymentCards() {
    return [...this._rubblePool.keys()];
  }

  _renderRubbleControls() {
    const messages = document.getElementById('hand-messages');
    messages.innerHTML = `
      <div style="color:#ffaaaa;font-size:.8rem">☠ Rubble: select ${this._rubbleNeeded} card(s) to discard</div>
      <button id="rubble-confirm-btn" disabled
        style="background:#e74c3c;color:#fff;border:none;border-radius:4px;
               padding:.3rem .8rem;cursor:not-allowed;opacity:.4;font-size:.8rem">
        Move Here
      </button>
      <button id="rubble-cancel-btn"
        style="background:#555;color:#fff;border:none;border-radius:4px;
               padding:.3rem .8rem;cursor:pointer;font-size:.8rem">
        Cancel
      </button>`;
    document.getElementById('rubble-cancel-btn').onclick  = () => this._rubbleOnCancel?.();
    document.getElementById('rubble-confirm-btn').onclick = () => this._rubbleOnConfirm?.();
  }
}