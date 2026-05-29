// client/src/game/CardUI.js

class CardUI {
  constructor() {
    this.handEl   = document.getElementById('hand-cards');
    this.shopEl   = document.getElementById('shop-slots');
    this.totalEl  = document.getElementById('purchase-total');
    this.marketEl = document.getElementById('card-market');

    this.onCardPlayed     = null; // (instanceId) — play for movement
    this.onMarketCard     = null; // ({ cardKey, handCardsUsed }) — purchase
    this.onEndTurn        = null;
    this.onCancelPurchase = null;
    this.onDiscardClicked = null;

    this._marketMode       = false;
    this._purchasePool     = new Map(); // instanceId → card
    this._transmitterBonus = 0;
    this._currentHand      = [];
    this._lastMarket       = null; // { shop, reserve } — cached for re-render

    this._bindControls();
  }

  _bindControls() {
    document.getElementById('end-turn-btn').addEventListener('click', () => this.onEndTurn?.());
    document.getElementById('open-market-btn').addEventListener('click', () => this.openMarket());
    document.getElementById('discard-btn').addEventListener('click', () => this.onDiscardClicked?.());
    document.getElementById('cancel-purchase-btn').addEventListener('click', () => this.closeMarket());
  }

  // ── Market open/close ──────────────────────────────────────────────────────

  openMarket(transmitterBonus = 0) {
    this._marketMode       = true;
    this._transmitterBonus = transmitterBonus;
    this._purchasePool.clear();
    this.marketEl.classList.remove('hidden');
    this._renderHandInMarketMode();
    if (this._lastMarket) this.renderMarket(this._lastMarket);
    this._updatePurchaseTotal();
  }

  closeMarket() {
    this._marketMode       = false;
    this._transmitterBonus = 0;
    this._purchasePool.clear();
    this.marketEl.classList.add('hidden');
    this.renderHand(this._currentHand);
  }

  // Called when server emits purchase_opened (Transmitter card played)
  openMarketWithBonus(totalPurchasePower) {
    this.openMarket(totalPurchasePower);
  }

  // ── Hand rendering ─────────────────────────────────────────────────────────

  renderHand(cards) {
    this._currentHand = cards;
    if (this._marketMode) {
      this._renderHandInMarketMode();
    } else {
      this._renderHandForMovement();
    }
  }

  _renderHandForMovement() {
    this.handEl.innerHTML = '';
    for (const card of this._currentHand) {
      const btn = this._makeCardButton(card, false);
      btn.addEventListener('click', () => this.onCardPlayed?.(card.instanceId));
      this.handEl.appendChild(btn);
    }
  }

  _renderHandInMarketMode() {
    this.handEl.innerHTML = '';
    for (const card of this._currentHand) {
      const inPool = this._purchasePool.has(card.instanceId);
      const btn = this._makeCardButton(card, inPool);
      btn.addEventListener('click', () => {
        if (this._purchasePool.has(card.instanceId)) {
          this._purchasePool.delete(card.instanceId);
          btn.classList.remove('in-pool');
        } else {
          this._purchasePool.set(card.instanceId, card);
          btn.classList.add('in-pool');
        }
        this._updatePurchaseTotal();
      });
      this.handEl.appendChild(btn);
    }
  }

  _makeCardButton(card, inPool = false) {
    const btn = document.createElement('button');
    btn.className = 'card-btn' + (inPool ? ' in-pool' : '') + (card.movementTerrain ? ` terrain-${card.movementTerrain}` : '');
    btn.dataset.instanceId = card.instanceId;

    const movesLabel = card.movementTotal > 0 ? `▶ ${card.movementTotal}` : '&nbsp;';
    const oneTimeLabel = card.oneTimeUse ? ` ❌` : '';
    const powerLabel = card.purchasingPower
      ? `<span class="card-gold">💰 ${card.purchasingPower}</span>` : '';

    btn.innerHTML = `<span class="card-name">${card.cardName || card.key}</span>
      <span class="card-moves">${movesLabel}${oneTimeLabel}</span>
      ${powerLabel}`;
    return btn;
  }

  updateSelectedCardForMovement(instanceId) {
    for (const btn of this.handEl.querySelectorAll('.card-btn')) {
      if (btn.dataset.instanceId === instanceId) {
        btn.classList.toggle('selected');
      } else {
        btn.classList.remove('selected');
      }
    }
  }

  // ── Market rendering ───────────────────────────────────────────────────────

  renderMarket(market) {
    this._lastMarket = market;
    this.shopEl.innerHTML = '';

    const isTransmitter = this._transmitterBonus > 0;

    // ── Shop section ──────────────────────────────────────────────────────
    const shopHeader = document.createElement('div');
    shopHeader.className = 'market-section-header';
    shopHeader.textContent = 'Shop';
    this.shopEl.appendChild(shopHeader);

    const shopRow = document.createElement('div');
    shopRow.className = 'market-row';
    this.shopEl.appendChild(shopRow);

    const slots = market?.shop ?? [];
    for (const card of slots) {
      shopRow.appendChild(this._makeMarketCardEl(card, false));
    }

    // ── Reserve section — always visible so players know what's out there ──
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

    if (this._marketMode) this._updateAffordability();
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
    btn.className = `market-card${reserveClass}`;
    btn.dataset.cardKey = card.key;

    const movesLabel = card.movementTotal > 0 ? `▶ ${card.movementTotal}` : '&nbsp;';
    const oneTimeLabel = card.oneTimeUse ? ` ❌` : '';
    const effectLabel = card.specialEffect && card.specialEffect !== 'none'
      ? `<span class="card-effect">★ ${card.specialEffect.replace(/_/g, ' ')}</span>` : '';

    btn.innerHTML = `
      <span class="card-name">${card.cardName}</span>
      <span class="card-moves">${movesLabel}${oneTimeLabel}</span>
      <span class="card-cost">Cost: ${card.cost}</span>
      <span class="card-remaining">×${card.remaining}</span>
      ${effectLabel}`;

    // Reserve cards are only clickable during Transmitter
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

  // ── Purchase power ─────────────────────────────────────────────────────────

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
      const cost = parseFloat(costEl.textContent.replace('Cost: ', ''));
      btn.classList.toggle('cant-afford', power < cost);
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

  enterRubblePaymentMode(count, excludeInstanceId, onConfirm, onCancel) {
    this._rubbleMode = true;
    this._rubbleNeeded = count;
    this._rubblePool = new Map();
    this._rubbleExcludeId = excludeInstanceId ?? null;
    this._rubbleOnConfirm = onConfirm;
    this._rubbleOnCancel = onCancel;
    this._renderHandForRubble();
  }

  exitRubblePaymentMode() {
    this._rubbleMode = false;
    this._rubblePool = new Map();
    this.renderHand(this._currentHand);
    document.getElementById('hand-messages').innerHTML = '';
  }

  getRubblePaymentCards() {
    return [...this._rubblePool.keys()];
  }

  _renderHandForRubble() {
    const messages = document.getElementById('hand-messages');
    messages.innerHTML = `
      <div style="color:#ffaaaa;font-size:.8rem">☠ Rubble: select ${this._rubbleNeeded} card(s) to discard</div>
      <button id="rubble-confirm-btn" disabled style="background:#e74c3c;color:#fff;border:none;border-radius:4px;padding:.3rem .8rem;cursor:not-allowed;opacity:.4;font-size:.8rem">Move Here</button>
      <button id="rubble-cancel-btn" style="background:#555;color:#fff;border:none;border-radius:4px;padding:.3rem .8rem;cursor:pointer;font-size:.8rem">Cancel</button>`;

    document.getElementById('rubble-cancel-btn').onclick  = () => this._rubbleOnCancel?.();
    document.getElementById('rubble-confirm-btn').onclick = () => this._rubbleOnConfirm?.();

    this.handEl.innerHTML = '';
    for (const card of this._currentHand) {
      if (card.instanceId === this._rubbleExcludeId) continue;
      const btn = this._makeCardButton(card, false);
      btn.addEventListener('click', () => {
        if (this._rubblePool.has(card.instanceId)) {
          this._rubblePool.delete(card.instanceId);
          btn.classList.remove('in-pool');
        } else if (this._rubblePool.size < this._rubbleNeeded) {
          this._rubblePool.set(card.instanceId, card);
          btn.classList.add('in-pool');
        }
        const confirmBtn = document.getElementById('rubble-confirm-btn');
        if (confirmBtn) {
          const ready = this._rubblePool.size >= this._rubbleNeeded;
          confirmBtn.disabled = !ready;
          confirmBtn.style.opacity = ready ? '1' : '.4';
          confirmBtn.style.cursor  = ready ? 'pointer' : 'not-allowed';
        }
      });
      this.handEl.appendChild(btn);
    }
  }
}