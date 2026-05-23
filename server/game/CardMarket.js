// server/game/CardMarket.js
// Mirrors: res://scripts/CardMarket.gd
// The server is the authoritative source for market state.

class CardMarket {
  constructor() {
    // Active shop slots (typically 6 face-up cards)
    this.shopSlots = [];   // Array of CardData | null

    // Reserve deck (cards that refill empty shop slots)
    this.reserveDeck = [];
  }

  // TODO: Port your initial market setup from CardMarket.gd
  // Shuffle and deal initial shop cards from the full card pool
  init(cardPool) {
    this.reserveDeck = shuffle([...cardPool]);
    this.shopSlots = [];
    for (let i = 0; i < 6; i++) {
      this.shopSlots.push(this.reserveDeck.pop() || null);
    }
  }

  getCard(cardKey) {
    return this.shopSlots.find(c => c && c.key === cardKey) || null;
  }

  // Remove and return a card from the shop, flagging if reserve is needed
  buyCard(cardKey) {
    const idx = this.shopSlots.findIndex(c => c && c.key === cardKey);
    if (idx === -1) return null;
    const card = this.shopSlots[idx];

    if (this.reserveDeck.length > 0) {
      this.shopSlots[idx] = this.reserveDeck.pop();
    } else {
      this.shopSlots[idx] = null;
      // Signal that a player needs to manually place a reserve card
      // This mirrors: MultiplayerService.shop_card_needs_replaced signal
      this._needsManualReplace = true;
    }

    return card;
  }

  needsReserveReplacement() {
    return !!this._needsManualReplace;
  }

  // Player manually places a reserve card from the pile
  placeReserveCard(cardKey) {
    const emptyIdx = this.shopSlots.findIndex(s => s === null);
    if (emptyIdx === -1) return;
    const card = this.reserveDeck.find(c => c.key === cardKey);
    if (!card) return;
    this.reserveDeck = this.reserveDeck.filter(c => c.key !== cardKey);
    this.shopSlots[emptyIdx] = card;
    this._needsManualReplace = false;
  }

  getShopState() {
    return {
      shopSlots: this.shopSlots,
      reserveCount: this.reserveDeck.length,
    };
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

module.exports = { CardMarket };
