# Quest for El Dorado — Tutorial Plan

## Overview

A fully client-side, pre-game interactive tutorial accessible from the lobby.
No server connection required. The player sees the real map, a real-looking
hand, and the real market UI — all driven by static fixture data. When the
tutorial ends, everything is cleaned up and the player is returned to the lobby.

**Entry point**: A "Learn to Play" button on the lobby screen.
**Exit points**: "Skip" button (always visible), or natural completion of all steps.
**Server dependency**: None. Zero socket events emitted.

---

## Status

- Phase 0 — Infrastructure: ✅ Done
- Phase 1 — zoomToTiles(): ✅ Done
- Phase 2 — Map terrain tour: ⬜ Not started
- Phase 3 — Turn loop walkthrough: ⬜ Not started
- Phase 4 — Market walkthrough: ⬜ Not started
- Phase 5 — Cleanup + polish: ⬜ Not started

---

## Architecture Overview

The tutorial is built as a single self-contained module: `client/src/game/Tutorial.js`.

It owns:
- The step sequence (an array of step definition objects)
- The spotlight overlay (positioning, animation)
- Fixture data (fake hand, fake market)
- Temporary callback intercepts on `CardUI`
- Entry and exit lifecycle

It does **not** own:
- `HexRenderer` — borrows the existing instance
- `CardUI` — borrows the existing instance, restores all callbacks on exit
- Any server state

`main.js` constructs the `Tutorial` instance once, passing the shared
`renderer` and `cardUI` instances. The tutorial is activated by calling
`tutorial.start()` and cleans itself up by calling `tutorial.exit()`.

---

## Files To Create

| File | Purpose |
|------|---------|
| `client/src/game/Tutorial.js` | Main tutorial module |
| `client/src/styles/tutorial.css` | All tutorial-specific styles |

## Files To Modify

| File | Change |
|------|--------|
| `client/index.html` | Add "Learn to Play" button; add tutorial overlay elements |
| `client/src/main.js` | Import Tutorial, wire up button, pass renderer + cardUI; call `renderer.notifyZoomChanged(boardZoom)` at end of `updateBoardZoom()` |
| `client/src/game/HexRenderer.js` | Add `zoomToTiles()`, `notifyZoomChanged()` |
| `client/src/styles/main.css` | Minor: add `tutorial.css` import or link tag |

---

## Phase 0 — Infrastructure ✅ DONE

Everything in Phase 0 is implemented and working:

- "Learn to Play" button in the lobby
- `#tutorial-screen` overlay with backdrop, spotlight hole, callout box, skip button
- `Tutorial.js` stub with lifecycle (`start`, `exit`, `_advance`, `_renderStep`)
- Spotlight engine (`_spotlightElement`, `_positionCallout`, `_centerCallout`)
- Callback save/restore pattern
- `tutorial.css` with all base styles
- Wired into `main.js` with `onExit` returning to lobby
- Script tag added to `index.html`

**What is in place from Phase 0 that Phase 2 can rely on:**
- `this._steps` array — Phase 2 populates this via `_buildSteps()`
- `step.onEnter?.()` — called every time a step renders; this is where `zoomToTiles` calls go
- `step.spotlightSelector` — for spotlighting DOM elements (hand, controls, etc.)
- `this._nextBtn`, `this._skipBtn` — wired and working
- `this._clearSpotlight()` / `this._centerCallout()` — for steps with no spotlight target

---

## Phase 1 — zoomToTiles() ✅ DONE

### What was planned vs. what was implemented

The original plan called for `setTransform(scale, panX, panY)` — a method that
would manipulate the SVG element directly with a CSS `translate + scale` transform,
effectively replacing the scroll-container architecture. This approach was attempted
and failed due to coordinate system mismatches between SVG space and scroll space.

**What was implemented instead:**

`zoomToTiles(tileIds, { animate, maxZoom })` works *with* the existing
scroll-container architecture (`#board-scroll-inner` scaled via CSS transform,
`#board-container` scrollable):

1. **Zoom**: Sets `scale()` on `#board-scroll-inner` and updates its explicit
   `width`/`height` so the scroll container knows the content extent. Reads
   the natural (pre-zoom) size from `dataset.naturalWidth/Height` — the same
   data attributes that `main.js`'s `updateBoardZoom()` already maintains.
   Bootstraps those attributes on first call if the zoom buttons haven't been
   used yet.

2. **Scroll**: Uses `element.scrollIntoView({ block: 'center', inline: 'center' })`
   on the SVG `<g>` element of the tile closest to the group centroid. The browser
   handles all pixel math. No coordinate conversion needed.

`notifyZoomChanged(zoom)` — a one-liner called from `main.js`'s `updateBoardZoom()`
to keep `this._zoom` in sync when the zoom buttons are used. Required for the
natural-size bootstrap calculation to work correctly on first call.

`setTransform()` and `panX/panY` from the original plan are **not implemented**
and **not needed**. The mobile plan (MOBILE_PLAN.md Phase 2) describes adding
touch pan/zoom to `HexRenderer` — when that is implemented it should also use
the scroll-container approach (single-finger drag updates `scrollLeft/scrollTop`,
pinch-to-zoom scales the wrapper) rather than SVG direct transforms.
`scrollIntoView` and scroll-container zoom are fully compatible with touch pan.

### What is in place from Phase 1 that Phase 2 can rely on:

- `renderer.zoomToTiles(tileIds)` — works, tested
- `renderer.zoomToTiles(tileIds, { animate: false })` — instant, no transition
- `renderer.zoomToTiles(tileIds, { maxZoom: 1.2 })` — for wide multi-tile views
- Single tile → zooms to `maxZoom` (default 2.0) and centres it
- Multiple tiles → fits group at 75% of viewport, centres on centroid tile
- `renderer.notifyZoomChanged(zoom)` — called from `main.js` after zoom button presses
- `main.js` one-line addition: `renderer.notifyZoomChanged(boardZoom)` at end of `updateBoardZoom()`

### Phase 1 completion criteria (confirmed working):
- `renderer.zoomToTiles(['26_-12'])` zooms to El Dorado tile ✅
- `renderer.zoomToTiles(['-3_3', '-3_2', '-3_1', '-3_0'])` shows all start tiles ✅
- Existing zoom +/- buttons still work ✅
- Repeated calls produce consistent results ✅

---

## Phase 2 — Map Terrain Tour (Steps 1–9)

**Goal**: Load the real map in the tutorial and walk through each terrain type
with a spotlight + callout. No hand or market UI in this phase.

The map renders via `renderer.render(tiles)` called with data from
`mapData.json`. The tutorial borrows the already-rendered board rather than
re-rendering it — by the time the tutorial starts, `client.onGameStarted` has
already called `renderer.render()`. If no game is running, the tutorial must
render the map itself.

### Task 2a — Render map in tutorial if no game is running

**File**: `client/src/game/Tutorial.js`

In `start()`, after `this._overlayEl.classList.remove('hidden')`, add:

```js
// If the board hasn't been rendered yet (no game in progress),
// render it now from the shared mapData
if (this.renderer.tileEls.size === 0) {
  fetch('/shared/mapData.json')
    .then(r => r.json())
    .then(data => {
      this.renderer.render(data.tiles);
      this._renderStep();
    });
  return; // _renderStep() will be called after fetch completes
}
this._renderStep();
```

### Task 2b — Define fixture: tile ID groups for each terrain type

**File**: `client/src/game/Tutorial.js`

Add as a module-level const above the class:

```js
const TUTORIAL_TILE_GROUPS = {
  start:     ['-3_3', '-3_2', '-3_1', '-3_0'],
  elDorado:  ['26_-12', '26_-11', '25_-10'],
  finishing: ['24_-10', '25_-12', '25_-11'],
  jungle:    ['-2_0', '-2_1', '-1_1', '0_0'],
  water:     ['-1_0', '0_-3', '1_-1', '3_-2'],
  village:   ['0_-1', '0_1', '1_-2', '2_-1'],
  rubble:    ['1_-5', '1_-6', '2_-7', '5_-8'],
  camp:      ['3_-1', '7_-17', '15_-8', '8_-8'],
};
```

These IDs come from `mapData.json`. Cross-reference before implementing to
confirm they match the correct terrain types.

### Task 2c — Spotlight on SVG tiles

DOM spotlight (`_spotlightElement`) works on regular HTML elements via
`getBoundingClientRect()`. SVG `<g>` tiles are also DOM elements and also have
`getBoundingClientRect()`, so **the same method works** — just pass the `g`
element's bounding rect instead of a CSS selector.

Add a helper alongside `_spotlightElement`:

```js
_spotlightTiles(tileIds, calloutPosition = 'right') {
  const rects = tileIds
    .map(id => this.renderer.tileEls.get(id)?.g)
    .filter(Boolean)
    .map(el => el.getBoundingClientRect());

  if (rects.length === 0) { this._clearSpotlight(); return; }

  // Union of all tile rects
  const top    = Math.min(...rects.map(r => r.top));
  const left   = Math.min(...rects.map(r => r.left));
  const right  = Math.max(...rects.map(r => r.right));
  const bottom = Math.max(...rects.map(r => r.bottom));

  const padding = 12;
  this._holeEl.style.display = 'block';
  this._holeEl.style.top     = (top    - padding) + 'px';
  this._holeEl.style.left    = (left   - padding) + 'px';
  this._holeEl.style.width   = (right  - left + padding * 2) + 'px';
  this._holeEl.style.height  = (bottom - top  + padding * 2) + 'px';

  this._positionCallout(
    { top, left, right, bottom, width: right - left, height: bottom - top },
    calloutPosition
  );
}
```

**Important timing note**: `_spotlightTiles` must be called *after*
`zoomToTiles` has finished scrolling, otherwise `getBoundingClientRect()`
returns stale positions. Use `setTimeout(() => this._spotlightTiles(...), 550)`
to wait for the smooth scroll animation to settle (matching the 500ms transition).
For `animate: false` calls, 0ms is fine.

### Task 2d — Define terrain tour steps (Steps 1–9)

**File**: `client/src/game/Tutorial.js`

Add a `_buildSteps()` method and call it from the constructor:
`this._steps = this._buildSteps();`

```js
_buildSteps() {
  const r = this.renderer;
  return [

    // ── Step 1: Overview ───────────────────────────────────────────────────
    {
      title: 'The Race to El Dorado',
      body:  'This is the map. You start at the <strong>bottom-left</strong> '
           + 'and race toward <strong>El Dorado</strong> in the top-right. '
           + 'Everyone shares the same map — whoever gets there first triggers '
           + 'the final round.',
      nextLabel: 'Show me the map →',
      onEnter: () => {
        r.zoomToTiles(
          [...TUTORIAL_TILE_GROUPS.start, ...TUTORIAL_TILE_GROUPS.elDorado],
          { maxZoom: 0.8 }
        );
        this._clearSpotlight();
        this._centerCallout();
      },
    },

    // ── Step 2: Start tiles ────────────────────────────────────────────────
    {
      title: 'Your Starting Position',
      body:  'Each player begins on one of these <strong>start tiles</strong>. '
           + 'You can\'t move back onto start tiles during the game.',
      onEnter: () => {
        r.zoomToTiles(TUTORIAL_TILE_GROUPS.start);
        setTimeout(() => this._spotlightTiles(TUTORIAL_TILE_GROUPS.start, 'right'), 550);
      },
    },

    // ── Step 3: El Dorado ──────────────────────────────────────────────────
    {
      title: 'El Dorado 🏆',
      body:  'These golden tiles are the finish. The first player to land on a '
           + '<strong>finishing tile</strong> (🏁) triggers the final round — '
           + 'every other player gets one more turn. Whoever is furthest wins.',
      onEnter: () => {
        const ids = [...TUTORIAL_TILE_GROUPS.finishing, ...TUTORIAL_TILE_GROUPS.elDorado];
        r.zoomToTiles(ids);
        setTimeout(() => this._spotlightTiles(ids, 'left'), 550);
      },
    },

    // ── Step 4: Jungle ────────────────────────────────────────────────────
    {
      title: '🌿 Jungle Tiles',
      body:  'Most of the early map is <strong>jungle</strong>. '
           + 'Your starting deck has <strong>green cards</strong> '
           + '(Explorers) to cross these. Each Explorer moves 1 space.',
      onEnter: () => {
        r.zoomToTiles(TUTORIAL_TILE_GROUPS.jungle);
        setTimeout(() => this._spotlightTiles(TUTORIAL_TILE_GROUPS.jungle, 'right'), 550);
      },
    },

    // ── Step 5: Water ─────────────────────────────────────────────────────
    {
      title: '🌊 Water Tiles',
      body:  'Rivers and lakes need <strong>blue cards</strong>. '
           + 'You start with one Sailor (1 water movement). '
           + 'There are several river crossings mid-map — buying '
           + '<strong>Captains</strong> from the market early pays off here.',
      onEnter: () => {
        r.zoomToTiles(TUTORIAL_TILE_GROUPS.water);
        setTimeout(() => this._spotlightTiles(TUTORIAL_TILE_GROUPS.water, 'right'), 550);
      },
    },

    // ── Step 6: Village ───────────────────────────────────────────────────
    {
      title: '🏘️ Village Tiles',
      body:  '<strong>Yellow cards</strong> move through villages. '
           + 'They also work as <strong>purchasing power</strong> to buy '
           + 'from the market. A Traveler (1 village movement) is worth 1 gold.',
      onEnter: () => {
        r.zoomToTiles(TUTORIAL_TILE_GROUPS.village);
        setTimeout(() => this._spotlightTiles(TUTORIAL_TILE_GROUPS.village, 'right'), 550);
      },
    },

    // ── Step 7: Rubble ────────────────────────────────────────────────────
    {
      title: '🪨 Rubble Tiles',
      body:  'Rubble tiles cost <strong>extra cards on top</strong> of the '
           + 'card you played to move there. A <strong>×2</strong> badge means '
           + 'discard 1 extra card of any type. ×3 costs 2 extra. '
           + 'There\'s a heavy rubble cluster mid-map — plan for it.',
      onEnter: () => {
        r.zoomToTiles(TUTORIAL_TILE_GROUPS.rubble);
        setTimeout(() => this._spotlightTiles(TUTORIAL_TILE_GROUPS.rubble, 'right'), 550);
      },
    },

    // ── Step 8: Camp ──────────────────────────────────────────────────────
    {
      title: '⛺ Camp Tiles',
      body:  'Landing on a camp tile <strong>ends your movement</strong> for '
           + 'that card, regardless of moves remaining. The card played is also '
           + '<strong>removed from your deck permanently</strong> — a deliberate '
           + 'purge opportunity.',
      onEnter: () => {
        r.zoomToTiles(TUTORIAL_TILE_GROUPS.camp);
        setTimeout(() => this._spotlightTiles(TUTORIAL_TILE_GROUPS.camp, 'right'), 550);
      },
    },

    // ── Step 9: Transition to turn loop ───────────────────────────────────
    {
      title: 'You Know the Map',
      body:  'Now you know what terrain you\'ll face and what card types '
           + 'you\'ll need. The next steps show you how a turn works.',
      nextLabel: 'Show me a turn →',
      onEnter: () => {
        r.zoomToTiles(
          [...TUTORIAL_TILE_GROUPS.start, ...TUTORIAL_TILE_GROUPS.elDorado],
          { maxZoom: 0.8 }
        );
        this._clearSpotlight();
        this._centerCallout();
      },
    },

  ];
}
```

### Phase 2 Completion Criteria

- Steps 1–9 display with correct text and step counter
- Board zooms to the correct region for each step
- Spotlight box appears over the correct tiles after the zoom animation settles
- "Next →" advances through all 9 steps cleanly
- "Skip" exits at any point and returns to the lobby
- No errors when tiles are off-screen before zoom (spotlight fires after delay)

---

## Phase 3 — Turn Loop Walkthrough (Steps 10–13)

**Goal**: Show the player how a turn works using a fake hand rendered into
the real `#hand-cards` element. No server. The board stays visible.

### Task 3a — Define fixture: tutorial hand data

**File**: `client/src/game/Tutorial.js`

Add as a module-level const:

```js
const TUTORIAL_HAND = [
  {
    instanceId: 'tut-explorer-0', key: 'explorer', cardName: 'Explorer',
    color: 'green', movementTerrain: 'jungle', movementTotal: 1,
    purchasingPower: 0.5, specialEffect: 'none', oneTimeUse: false, cost: 0,
  },
  {
    instanceId: 'tut-explorer-1', key: 'explorer', cardName: 'Explorer',
    color: 'green', movementTerrain: 'jungle', movementTotal: 1,
    purchasingPower: 0.5, specialEffect: 'none', oneTimeUse: false, cost: 0,
  },
  {
    instanceId: 'tut-traveler-0', key: 'traveler', cardName: 'Traveler',
    color: 'yellow', movementTerrain: 'village', movementTotal: 1,
    purchasingPower: 1, specialEffect: 'none', oneTimeUse: false, cost: 0,
  },
  {
    instanceId: 'tut-sailor-0', key: 'sailor', cardName: 'Sailor',
    color: 'blue', movementTerrain: 'water', movementTotal: 1,
    purchasingPower: 0.5, specialEffect: 'none', oneTimeUse: false, cost: 0,
  },
];
```

### Task 3b — Intercept CardUI callbacks for tutorial

```js
_installTurnCallbacks() {
  this.cardUI.onCardPlayed = (instanceId) => {
    this.cardUI.updateSelectedCardForMovement(instanceId);
    this._advance();
  };
  this.cardUI.onEndTurn = () => this._advance();
}
```

Call `_installTurnCallbacks()` in the `onEnter` of step 10.

### Task 3c — Show a fake pawn on the start tile

In `onEnter` for step 10:
```js
this.renderer.setPawnPosition('tutorial-player', '-3_3', 0);
```

Remove in `exit()`:
```js
const pawnEl = this.renderer.svg.querySelector('[data-pawn="tutorial-player"]');
if (pawnEl) pawnEl.remove();
```

### Task 3d — Define turn loop steps (Steps 10–13)

Append to the array returned by `_buildSteps()`:

```js
    // ── Step 10: Your hand ────────────────────────────────────────────────
    {
      title: 'Your Hand',
      body:  'Each turn starts with cards in your hand. '
           + '<strong>Green</strong> moves through jungle, '
           + '<strong>blue</strong> through water, '
           + '<strong>yellow</strong> through villages (and buys cards). '
           + 'Click a card to play it.',
      spotlightSelector: '#player-hand-ui',
      calloutPosition:   'above',
      onEnter: () => {
        this.renderer.zoomToTiles(TUTORIAL_TILE_GROUPS.start);
        this.renderer.setPawnPosition('tutorial-player', '-3_3', 0);
        this.cardUI.renderHand(TUTORIAL_HAND);
        this._installTurnCallbacks();
        this._nextBtn.style.display = 'none'; // must click a card to continue
      },
    },

    // ── Step 11: Valid moves ──────────────────────────────────────────────
    {
      title: 'Valid Moves',
      body:  'Glowing tiles show where you can move with the card you played. '
           + 'The card\'s terrain must match the tile. Click a glowing tile to move.',
      spotlightSelector: '#board-container',
      calloutPosition:   'right',
      onEnter: () => {
        this._nextBtn.style.display = 'none';
        const adjacentJungle = ['-2_3', '-2_2', '-2_1', '-2_0'];
        this.renderer.setValidMoves(adjacentJungle);

        const originalClick = this.renderer.onTileClick;
        this.renderer.onTileClick = (tileId) => {
          if (adjacentJungle.includes(tileId)) {
            this.renderer.setPawnPosition('tutorial-player', tileId, 0);
            this.renderer.clearHighlights();
            this.renderer.onTileClick = originalClick;
            this._advance();
          }
        };
      },
    },

    // ── Step 12: After moving ─────────────────────────────────────────────
    {
      title: 'After Moving',
      body:  'If you have moves remaining your card stays active and more '
           + 'tiles glow. When done, <strong>End Turn</strong> to draw back '
           + 'up to 4 cards, or open the <strong>Market</strong> to buy first.',
      spotlightSelector: '#hand-controls',
      calloutPosition:   'above',
      onEnter: () => {
        this._nextBtn.style.display = '';
        this.cardUI.onEndTurn = () => this._advance();
      },
    },

    // ── Step 13: Deck cycling ─────────────────────────────────────────────
    {
      title: 'Your Deck Grows',
      body:  'At end of turn you draw back up to 4 cards. Played cards go to '
           + 'your <strong>discard pile</strong>. When your draw pile runs out, '
           + 'the discard is reshuffled — so every card you buy '
           + '<em>will</em> reach your hand.',
      onEnter: () => {
        this._nextBtn.style.display = '';
        this._clearSpotlight();
        this._centerCallout();
      },
    },
```

### Phase 3 Completion Criteria

- Tutorial hand renders in `#hand-cards`
- Clicking a card in step 10 advances to step 11 (no socket event emitted)
- Valid move highlights appear on the correct tiles
- Clicking a highlighted tile moves the fake pawn and advances to step 12
- End Turn button advances to step 13 (no socket event)
- No leftover intercepts after the step passes

---

## Phase 4 — Market Walkthrough (Steps 14–17)

**Goal**: Show the market UI with real card data, demonstrate purchasing power
selection, and simulate a purchase — all without a server.

### Task 4a — Tutorial market data

Use the existing `buildShopState()` — it's already loaded at runtime:

```js
// At the top of _buildSteps() or in start():
const tutorialMarket = window.ElDoradoCards.buildShopState();
```

### Task 4b — Intercept market callbacks

```js
_installMarketCallbacks() {
  this.cardUI.onMarketCard = ({ cardKey }) => {
    this.cardUI.closeMarket();
    this._advance();
  };
  this.cardUI.onCancelPurchase = () => {
    // prevent closing market during market tutorial steps
  };
}
```

### Task 4c — Define market walkthrough steps (Steps 14–17)

Append to `_buildSteps()`:

```js
    // ── Step 14: Market intro ─────────────────────────────────────────────
    {
      title: 'The Market',
      body:  'During your turn, click <strong>Market</strong> to buy better '
           + 'cards. You pay using cards from your hand as purchasing power. '
           + 'Yellow cards are most valuable — a Traveler is worth 1 gold.',
      spotlightSelector: '#open-market-btn',
      calloutPosition:   'above',
      nextLabel:         'Open the Market →',
      onEnter: () => {
        this._nextBtn.style.display = '';
        this.cardUI.renderHand(TUTORIAL_HAND);
        this._nextBtn.onclick = () => {
          this.cardUI.renderMarket(tutorialMarket);
          this.cardUI.openMarket(0);
          this._nextBtn.onclick = null;
          this._advance();
        };
      },
    },

    // ── Step 15: Selecting purchasing power ───────────────────────────────
    {
      title: 'Adding Purchasing Power',
      body:  'Click cards in your hand to pool their purchasing power. '
           + 'Cards with a <strong>green outline</strong> are ones you can '
           + 'currently afford. Try clicking the Traveler.',
      spotlightSelector: '#player-hand-ui',
      calloutPosition:   'above',
      onEnter: () => {
        this._nextBtn.style.display = 'none';
        this._installMarketCallbacks();
        const originalPoolClick = this.cardUI._handleMarketPoolClick.bind(this.cardUI);
        this.cardUI._handleMarketPoolClick = (instanceId, btn) => {
          originalPoolClick(instanceId, btn);
          this.cardUI._handleMarketPoolClick = originalPoolClick;
          setTimeout(() => this._advance(), 400);
        };
      },
    },

    // ── Step 16: Buying a card ────────────────────────────────────────────
    {
      title: 'Buying a Card',
      body:  'Cards with a <strong>green outline</strong> are affordable. '
           + 'Click one to buy it. It goes to your <strong>discard pile</strong> '
           + 'and cycles into your hand in a future turn.',
      spotlightSelector: '#shop-slots',
      calloutPosition:   'above',
      onEnter: () => {
        this._nextBtn.style.display = 'none';
      },
    },

    // ── Step 17: Wrap-up ──────────────────────────────────────────────────
    {
      title: 'You\'re Ready to Explore',
      body:  'Build your deck around the terrain ahead, spend yellow cards '
           + 'to buy upgrades, and race your opponents to El Dorado. '
           + 'Good luck, explorer.',
      nextLabel: 'Start Playing →',
      onEnter: () => {
        this._nextBtn.style.display = '';
        this.cardUI.closeMarket();
        this._clearSpotlight();
        this._centerCallout();
      },
    },
```

### Phase 4 Completion Criteria

- Market opens on step 14→15 transition
- Clicking a yellow card updates affordability highlights
- Clicking an affordable market card advances to step 17 (no socket event)
- Market closes on step 17
- "Start Playing →" calls `exit()` and returns to lobby

---

## Phase 5 — Cleanup, Polish & Persistence

**Goal**: Make the tutorial feel complete. Handle edge cases, add replay option,
ensure nothing leaks into real game sessions.

### Task 5a — Full exit() cleanup

Ensure `exit()` does all of:

```js
exit() {
  this.active = false;
  this._overlayEl.classList.add('hidden');
  this._clearSpotlight();
  this._restoreCallbacks();
  if (this._savedTileClick !== undefined) {
    this.renderer.onTileClick = this._savedTileClick;
  }
  // Remove fake pawn
  const pawnEl = this.renderer.svg.querySelector('[data-pawn="tutorial-player"]');
  if (pawnEl) pawnEl.remove();
  // Clear fake hand
  this.cardUI.renderHand([]);
  // Close market if open
  this.cardUI.closeMarket();
  // Clear highlights
  this.renderer.clearHighlights();
  // Reset next button
  this._nextBtn.onclick = null;
  this._nextBtn.style.display = '';
  this.onExit?.();
}
```

Also save `renderer.onTileClick` at `start()` time:
```js
this._savedTileClick = this.renderer.onTileClick;
```

### Task 5b — localStorage persistence

In `start()`:
```js
localStorage.removeItem('el-dorado-tutorial-done');
```

In `exit()` after step completion (not skip):
```js
if (this._step >= this._steps.length - 1) {
  localStorage.setItem('el-dorado-tutorial-done', '1');
}
```

In `main.js` on lobby load:
```js
if (localStorage.getItem('el-dorado-tutorial-done')) {
  tutorialBtn.textContent = '📖 Replay Tutorial';
}
```

### Task 5c — Progress dots

Add `<div id="tutorial-progress-dots"></div>` to the callout in `index.html`,
between `#tutorial-callout-body` and `#tutorial-callout-actions`.

In `tutorial.css`:
```css
#tutorial-progress-dots {
  display: flex;
  gap: 5px;
  justify-content: center;
  margin-bottom: 0.75rem;
}
.tutorial-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--text-dim);
  transition: background 0.2s;
}
.tutorial-dot.active { background: var(--gold-mid); }
```

In `_renderStep()`:
```js
const dotsEl = document.getElementById('tutorial-progress-dots');
dotsEl.innerHTML = '';
this._steps.forEach((_, i) => {
  const dot = document.createElement('div');
  dot.className = 'tutorial-dot' + (i === this._step ? ' active' : '');
  dotsEl.appendChild(dot);
});
```

### Task 5d — Keyboard navigation

In `start()`:
```js
this._keyHandler = (e) => {
  if (!this.active) return;
  if (e.key === 'ArrowRight' || e.key === 'Enter') {
    if (this._nextBtn.style.display !== 'none') this._advance();
  }
  if (e.key === 'Escape') this.exit();
};
document.addEventListener('keydown', this._keyHandler);
```

In `exit()`:
```js
document.removeEventListener('keydown', this._keyHandler);
```

### Task 5e — Handle window resize

In `start()`:
```js
this._resizeHandler = () => {
  if (!this.active) return;
  const step = this._steps[this._step];
  if (step?.spotlightSelector) {
    this._spotlightElement(step.spotlightSelector, step.calloutPosition);
  }
};
window.addEventListener('resize', this._resizeHandler);
```

In `exit()`:
```js
window.removeEventListener('resize', this._resizeHandler);
```

### Task 5f — Callout arrow indicator

In `tutorial.css`:
```css
#tutorial-callout::after {
  content: '';
  position: absolute;
  width: 0; height: 0;
  border: 8px solid transparent;
}
#tutorial-callout.arrow-below::after {
  top: 100%; left: 50%; transform: translateX(-50%);
  border-top-color: #14243a;
}
#tutorial-callout.arrow-above::after {
  bottom: 100%; left: 50%; transform: translateX(-50%);
  border-bottom-color: #14243a;
}
#tutorial-callout.arrow-right::after {
  top: 50%; left: 100%; transform: translateY(-50%);
  border-left-color: #14243a;
}
#tutorial-callout.arrow-left::after {
  top: 50%; right: 100%; transform: translateY(-50%);
  border-right-color: #14243a;
}
```

In `_positionCallout()`, after setting top/left:
```js
this._calloutEl.className = this._calloutEl.className.replace(/arrow-\w+/g, '').trim();
const arrowClass = { above: 'arrow-below', below: 'arrow-above', left: 'arrow-right', right: 'arrow-left' }[position];
if (arrowClass) this._calloutEl.classList.add(arrowClass);
```

### Phase 5 Completion Criteria

- Completing the tutorial sets `localStorage` flag; button shows "Replay Tutorial" on return
- Pressing Escape at any point exits cleanly
- Pressing → or Enter advances steps when Next is visible
- Window resize re-positions spotlight correctly
- After exiting, starting a real game works normally — no leftover state
- No fake pawns, fake hands, or intercepted callbacks remain after exit

---

## Step Reference (All 17 Steps)

| # | Title | Topic | Spotlight |
|---|-------|-------|-----------|
| 1 | The Race to El Dorado | Overview | None (centred) |
| 2 | Your Starting Position | Start tiles | Tile group: start |
| 3 | El Dorado 🏆 | Finishing + El Dorado | Tile group: finishing + elDorado |
| 4 | 🌿 Jungle Tiles | Jungle | Tile group: jungle |
| 5 | 🌊 Water Tiles | Water | Tile group: water |
| 6 | 🏘️ Village Tiles | Village | Tile group: village |
| 7 | 🪨 Rubble Tiles | Rubble | Tile group: rubble |
| 8 | ⛺ Camp Tiles | Camp | Tile group: camp |
| 9 | You Know the Map | Transition | None (centred) |
| 10 | Your Hand | Turn loop | `#player-hand-ui` |
| 11 | Valid Moves | Turn loop | `#board-container` |
| 12 | After Moving | Turn loop | `#hand-controls` |
| 13 | Your Deck Grows | Turn loop | None (centred) |
| 14 | The Market | Market intro | `#open-market-btn` |
| 15 | Adding Purchasing Power | Market | `#player-hand-ui` |
| 16 | Buying a Card | Market | `#shop-slots` |
| 17 | You're Ready to Explore | Wrap-up | None (centred) |

---

## Files Created / Modified Summary

| File | Phase | Change |
|------|-------|--------|
| `client/src/game/Tutorial.js` | 0–5 | **New** — full tutorial module |
| `client/src/styles/tutorial.css` | 0, 5 | **New** — all tutorial styles |
| `client/index.html` | 0 | Add button, overlay elements, script tag |
| `client/src/main.js` | 0, 1 | Wire Tutorial; add `renderer.notifyZoomChanged(boardZoom)` to `updateBoardZoom()` |
| `client/src/game/HexRenderer.js` | 1 | Add `zoomToTiles()`, `notifyZoomChanged()` |

No server files change. No `shared/` files change.

---

## Implementation Order

```
Phase 0 ✅ → Phase 1 ✅ → Phase 2 → Phase 3 → Phase 4 → Phase 5
```

Each phase is independently testable before the next begins.

---

## How to Start Each Phase

Paste this at the top of a new chat:

> "I'm continuing work on Quest for El Dorado. Please read TUTORIAL_PLAN.md,
> then load the current versions of the relevant files from the project, and
> implement Phase N."

Phase 2 can be done in one session. Phases 3 and 4 are denser — starting
with a single task per session is recommended.
