// client/src/game/CardUI.js
// Renders player hand and the card market.
// Mirrors: res://scenes/PlayerHandUI.tscn + CardMarket.tscn

class CardUI {
  constructor() {
    this.handEl     = document.getElementById('hand-cards');
    this.shopEl     = document.getElementById('shop-slots');
    this.totalEl    = document.getElementById('purchase-total');
    this.marketEl   = document.getElementById('card-market');

    this.onCardPlayed    = null; // callback(cardKey)
    this.onMarketCard    = null; // callback(cardKey)
    this.onEndTurn       = null;
    this.onOpenMarket    = null;
    this.onCancelPurchase= null;
    this.onDiscard       = null;

    this._bindControls();
  }

  _bindControls() {
    document.getElementById('end-turn-btn').addEventListener('click', () => this.onEndTurn?.());
    document.getElementById('open-market-btn').addEventListener('click', () => this.onOpenMarket?.());
    document.getElementById('cancel-purchase-btn').addEventListener('click', () => this.onCancelPurchase?.());
    document.getElementById('discard-btn').addEventListener('click', () => this.onDiscard?.());
  }

  renderHand(cards) {
    this.handEl.innerHTML = '';
    for (const card of cards) {
      const btn = document.createElement('button');
      btn.className = 'card-btn';
      btn.dataset.cardKey = card.key;
      btn.innerHTML = `
        <span class="card-name">${card.cardName || card.key}</span>
        <span class="card-terrain">${card.movementTerrain || ''}</span>
        <span class="card-moves">${card.movementTotal > 0 ? '▶ ' + card.movementTotal : ''}</span>
        ${card.purchasingPower ? `<span class="card-gold">💰 ${card.purchasingPower}</span>` : ''}
      `;
      btn.addEventListener('click', () => this.onCardPlayed?.(card.key));
      this.handEl.appendChild(btn);
    }
  }

  renderMarket(shopSlots) {
    this.shopEl.innerHTML = '';
    for (const card of shopSlots) {
      if (!card) {
        const empty = document.createElement('div');
        empty.className = 'market-card empty';
        empty.textContent = '—';
        this.shopEl.appendChild(empty);
        continue;
      }
      const btn = document.createElement('button');
      btn.className = 'market-card';
      btn.dataset.cardKey = card.key;
      btn.innerHTML = `
        <span class="card-name">${card.cardName || card.key}</span>
        <span class="card-cost">Cost: ${card.cost}</span>
        ${card.movementTotal ? `<span>▶ ${card.movementTotal}</span>` : ''}
      `;
      btn.addEventListener('click', () => this.onMarketCard?.(card.key));
      this.shopEl.appendChild(btn);
    }
  }

  updatePurchaseTotal(total) {
    if (this.totalEl) this.totalEl.textContent = `Total: ${total}`;
  }

  showMarket(visible) {
    this.marketEl.classList.toggle('hidden', !visible);
  }

  setControlsEnabled(enabled) {
    document.getElementById('end-turn-btn').disabled = !enabled;
    document.getElementById('open-market-btn').disabled = !enabled;
  }
}
