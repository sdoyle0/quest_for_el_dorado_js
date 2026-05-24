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

    this._marketMode       = false;
    this._purchasePool     = new Map(); // instanceId → card
    this._transmitterBonus = 0;
    this._currentHand      = [];

    this._bindControls();
  }

  _bindControls() {
    document.getElementById('end-turn-btn')
      .addEventListener('click', () => this.onEndTurn?.());
    document.getElementById('open-market-btn')
      .addEventListener('click', () => this.openMarket());
    document.getElementById('cancel-purchase-btn')
      .addEventListener('click', () => this.closeMarket());
  }

  // ── Market open/close ──────────────────────────────────────────────────────

  openMarket(transmitterBonus = 0) {
    this._marketMode       = true;
    this._transmitterBonus = transmitterBonus;
    this._purchasePool.clear();
    this.marketEl.classList.remove('hidden');
    this._renderHandInMarketMode();
    this._updatePurchaseTotal();
  }

  closeMarket() {
    this._marketMode       = false;
    this._transmitterBonus = 0;
    this._purchasePool.clear();
    this.marketEl.classList.add('hidden');
    this.renderHand(this._currentHand); // back to movement mode
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

    const terrainLabel = card.movementTerrain && card.movementTerrain !== 'empty'
      ? `<span class="card-terrain">${card.movementTerrain}</span>` : '';
    const movesLabel = card.movementTotal > 0
      ? `<span class="card-moves">▶ ${card.movementTotal}</span>` : '';
    const powerLabel = card.purchasingPower
      ? `<span class="card-gold">💰 ${card.purchasingPower}</span>` : '';

    btn.innerHTML = `<span class="card-name">${card.cardName || card.key}</span>
      ${terrainLabel}${movesLabel}${powerLabel}`;
    return btn;
  }

  // ── Market rendering ───────────────────────────────────────────────────────

  renderMarket(market) {
    this.shopEl.innerHTML = '';
    const slots = market?.shop ?? [];
    for (const card of slots) {
      if (!card || card.remaining === 0) {
        const empty = document.createElement('div');
        empty.className = 'market-card empty';
        empty.textContent = card ? `${card.cardName} (sold out)` : '—';
        this.shopEl.appendChild(empty);
        continue;
      }
      const btn = document.createElement('button');
      btn.className = 'market-card';
      btn.dataset.cardKey = card.key;

      const movesLabel = card.movementTotal > 0
        ? `<span class="card-moves">▶ ${card.movementTotal}</span>` : '';
      const effectLabel = card.specialEffect && card.specialEffect !== 'none'
        ? `<span class="card-effect">★ ${card.specialEffect}</span>` : '';

      btn.innerHTML = `
        <span class="card-name">${card.cardName}</span>
        <span class="card-cost">Cost: ${card.cost}</span>
        <span class="card-remaining">×${card.remaining}</span>
        ${movesLabel}${effectLabel}`;

      btn.addEventListener('click', () => this._onMarketCardClicked(card));
      this.shopEl.appendChild(btn);
    }
    // Refresh affordability indicators if market is open
    if (this._marketMode) this._updateAffordability();
  }

  _onMarketCardClicked(card) {
    const power = this._currentPurchasePower();
    if (power < card.cost) {
      // Flash total red to signal not enough
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
    this.shopEl.querySelectorAll('.market-card:not(.empty)').forEach(btn => {
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
}
