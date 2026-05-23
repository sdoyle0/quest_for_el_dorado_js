// shared/cardData.js
// Card definitions. Mirrors your CardData.gd resource files.
//
// TODO: Verify these against your CardData.gd:
//   - Exact card names
//   - Purchasing power values
//   - Movement totals (some cards give 2 moves, not 1)
//   - Full market card list
//   - Any card effects I may have wrong
//
// Each card:
//   key             — unique identifier (matches CARD_KEYS in constants.js)
//   cardName        — display name
//   movementTerrain — which terrain it moves on ('jungle','water','wild', etc.) null if non-movement
//   movementTotal   — total movement points the card provides (0 if not a movement card)
//   purchasingPower — gold value when used to buy from market
//   cost            — how much gold it costs to buy from the market (0 = not for sale / starter)
//   specialEffect   — from CardEffect enum, or 'none'

const CARD_DEFINITIONS = [

  // ── STARTER DECK (cost: 0, not purchasable) ──────────────────────────────
  // TODO: Verify exact counts — the starter deck builder in your code will tell us
  {
    key: 'machete',
    cardName: 'Machete',
    movementTerrain: 'jungle',
    movementTotal: 1,
    purchasingPower: 0,
    cost: 0,
    specialEffect: 'none',
  },
  {
    key: 'paddle',
    cardName: 'Paddle',
    movementTerrain: 'water',
    movementTotal: 1,
    purchasingPower: 0,
    cost: 0,
    specialEffect: 'none',
  },
  {
    key: 'coin',
    cardName: 'Coin',
    movementTerrain: null,
    movementTotal: 0,
    purchasingPower: 1,
    cost: 0,
    specialEffect: 'none',
  },
  {
    key: 'traveler',
    cardName: 'Traveler',
    movementTerrain: 'wild',   // TODO: verify — might be 'jungle' with movement 2, or truly wild
    movementTotal: 1,
    purchasingPower: 0,
    cost: 0,
    specialEffect: 'none',
  },

  // ── MARKET CARDS ──────────────────────────────────────────────────────────
  // TODO: Fill in from CardData.gd — these are approximate based on the real game
  {
    key: 'explorer',
    cardName: 'Explorer',
    movementTerrain: 'wild',
    movementTotal: 1,
    purchasingPower: 1,
    cost: 3,
    specialEffect: 'none',
  },
  {
    key: 'journalist',
    cardName: 'Journalist',
    movementTerrain: 'jungle',
    movementTotal: 2,
    purchasingPower: 0,
    cost: 4,
    specialEffect: 'none',
  },
  {
    key: 'photographer',
    cardName: 'Photographer',
    movementTerrain: 'water',
    movementTotal: 2,
    purchasingPower: 0,
    cost: 4,
    specialEffect: 'none',
  },
  {
    key: 'cartographer',
    cardName: 'Cartographer',
    movementTerrain: 'jungle',
    movementTotal: 1,
    purchasingPower: 0,
    cost: 5,
    specialEffect: 'cartographer',  // draw 2
  },
  {
    key: 'compass',
    cardName: 'Compass',
    movementTerrain: 'wild',
    movementTotal: 1,
    purchasingPower: 0,
    cost: 4,
    specialEffect: 'compass',       // draw 3
  },
  {
    key: 'scientist',
    cardName: 'Scientist',
    movementTerrain: 'wild',
    movementTotal: 1,
    purchasingPower: 0,
    cost: 5,
    specialEffect: 'scientist',     // draw 1, remove 1
  },
  {
    key: 'travel_log',
    cardName: 'Travel Log',
    movementTerrain: 'wild',
    movementTotal: 1,
    purchasingPower: 1,
    cost: 6,
    specialEffect: 'travel_log',    // draw 2, remove 2
  },
  {
    key: 'transmitter',
    cardName: 'Transmitter',
    movementTerrain: null,
    movementTotal: 0,
    purchasingPower: 0,
    cost: 7,
    specialEffect: 'transmitter',   // free purchase worth 20
  },
  {
    key: 'native',
    cardName: 'Native Guide',
    movementTerrain: 'wild',
    movementTotal: 1,
    purchasingPower: 0,
    cost: 5,
    specialEffect: 'native',        // ignore terrain restrictions
  },
];

// ── STARTER DECK COMPOSITION ────────────────────────────────────────────────
// TODO: Verify exact counts from your CardData.gd / deck builder script
// Standard El Dorado starter deck is typically 10 cards:
const STARTER_DECK_TEMPLATE = [
  { key: 'machete', count: 4 },
  { key: 'paddle',  count: 3 },
  { key: 'coin',    count: 2 },
  { key: 'traveler',count: 1 },
];

// Build a full starter deck array (with duplicates) from the template
function buildStarterDeck() {
  const cardMap = new Map(CARD_DEFINITIONS.map(c => [c.key, c]));
  const deck = [];
  for (const { key, count } of STARTER_DECK_TEMPLATE) {
    const def = cardMap.get(key);
    if (!def) continue;
    for (let i = 0; i < count; i++) {
      // Each card instance gets a unique instanceId so duplicates are distinct
      deck.push({ ...def, instanceId: `${key}-${i}` });
    }
  }
  return deck;
}

// Market card pool (cards available to purchase in the shop)
// Excludes starter cards
const MARKET_CARD_POOL = CARD_DEFINITIONS.filter(c => c.cost > 0);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CARD_DEFINITIONS, STARTER_DECK_TEMPLATE, buildStarterDeck, MARKET_CARD_POOL };
} else {
  window.ElDoradoCards = { CARD_DEFINITIONS, STARTER_DECK_TEMPLATE, buildStarterDeck, MARKET_CARD_POOL };
}
