// client/src/game/Tutorial.js
// Self-contained tutorial module. No server connection required.
//
// Usage:
//   const tutorial = new Tutorial({ renderer, cardUI });
//   tutorial.onExit = () => showScreen('lobby');
//   tutorial.start();
//
// The tutorial reuses #game-screen as its visual backdrop (board + hand
// are already there). The #tutorial-screen overlay sits on top of it.
// Zero socket events are emitted during tutorial playback.

// ── Phase 2: Tile groups used in the terrain tour ────────────────────────────
// IDs cross-referenced against mapData.json.
const TUTORIAL_TILE_GROUPS = {
  start: ['-3_3', '-3_2', '-3_1', '-3_0'],
  elDorado: ['26_-12', '26_-11', '25_-10'],
  finishing: ['24_-10', '25_-12', '25_-11'],
  jungle: ['-2_0'],
  water: ['-1_0'],
  village: ['0_-1'],
  rubble: ['1_-5'],
  mountain: ['3_-7'],
  camp: ['7_-17'],
  more_requirements: ['11_-10']
};

// ── Phase 3: Tutorial hand fixture ───────────────────────────────────────────
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

class Tutorial {
  constructor({ renderer, cardUI }) {
    this.renderer = renderer;
    this.cardUI   = cardUI;
    this.active   = false;
    this._step    = 0;
    this._steps   = [];       // populated in later phases
    this._savedCallbacks  = {}; // CardUI callbacks saved on entry, restored on exit
    this._savedTileClick  = undefined; // renderer.onTileClick saved on entry

    // ── Overlay element refs ───────────────────────────────────────────────
    this._overlayEl   = document.getElementById('tutorial-screen');
    this._backdropEl  = document.getElementById('tutorial-backdrop');
    this._holeEl      = document.getElementById('tutorial-spotlight-hole');
    this._calloutEl   = document.getElementById('tutorial-callout');
    this._stepLabelEl = document.getElementById('tutorial-callout-step');
    this._titleEl     = document.getElementById('tutorial-callout-title');
    this._bodyEl      = document.getElementById('tutorial-callout-body');
    this._nextBtn     = document.getElementById('tutorial-next-btn');
    this._skipBtn     = document.getElementById('tutorial-skip-btn');

    this._nextBtn.addEventListener('click', () => this._advance());
    this._skipBtn.addEventListener('click', () => this.exit());

    // Build steps once — they reference this.renderer so must be done here
    this._steps = this._buildSteps();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  start() {
    if (this.active) return;
    this.active = true;
    this._step  = 0;

    // Save live callbacks before we intercept anything
    this._saveCallbacks();
    this._savedTileClick = this.renderer.onTileClick;

    this._overlayEl.classList.remove('hidden');

    // Phase 2, Task 2a: Render map if no game is running yet
    if (this.renderer.tileEls.size === 0) {
      fetch('/shared/mapData.json')
        .then(r => r.json())
        .then(data => {
          this.renderer.render(data.tiles);
          // After fresh render the scroll-inner has no stored natural size yet.
          // Give the browser one frame to lay out the SVG before step 1's
          // onEnter calls zoomToTiles() (which needs offsetWidth to be real).
          requestAnimationFrame(() => this._renderStep());
        })
        .catch(() => {
          this._renderStep();
        });
      return;
    }

    this._renderStep();
  }

  exit() {
    this.active = false;
    this._overlayEl.classList.add('hidden');

    // Clear spotlight hole and any callout arrow classes
    this._clearSpotlight();

    // Restore CardUI and renderer callbacks
    this._restoreCallbacks();
    if (this._savedTileClick !== undefined) {
      this.renderer.onTileClick = this._savedTileClick;
    }

    // Remove fake pawn if present (added in Phase 3)
    const pawnEl = this.renderer.svg?.querySelector('[data-pawn="tutorial-player"]');
    if (pawnEl) pawnEl.remove();

    // Clear any fake hand / market state
    this.cardUI.renderHand([]);
    this.cardUI.closeMarket();
    this.renderer.clearHighlights();

    // Reset next button in case a step hid it or swapped its handler
    this._nextBtn.style.display = '';
    this._nextBtn.onclick = null;

    this.onExit?.();
  }

  // ── Step navigation ───────────────────────────────────────────────────────

  _advance() {
    this._step++;
    if (this._step >= this._steps.length) {
      this.exit();
      return;
    }
    this._renderStep();
  }

  _renderStep() {
    const step = this._steps[this._step];

    // Phase 0: no steps defined yet — show a neutral "no content" state
    if (!step) {
      this._stepLabelEl.textContent = `Step ${this._step + 1} of ${this._steps.length}`;
      this._titleEl.textContent = '';
      this._bodyEl.innerHTML    = '';
      this._nextBtn.textContent = 'Done ✓';
      this._clearSpotlight();
      this._centerCallout();
      return;
    }

    // ── Update step counter ────────────────────────────────────────────────
    this._stepLabelEl.textContent = `Step ${this._step + 1} of ${this._steps.length}`;

    // ── Update text content ────────────────────────────────────────────────
    this._titleEl.textContent = step.title || '';
    this._bodyEl.innerHTML    = step.body  || '';

    // ── Next button label ──────────────────────────────────────────────────
    const isLast = this._step === this._steps.length - 1;
    this._nextBtn.textContent = step.nextLabel || (isLast ? 'Done ✓' : 'Next →');
    this._nextBtn.style.display = '';
    this._nextBtn.onclick = null; // clear any step-specific override

    // ── Spotlight ──────────────────────────────────────────────────────────
    if (step.spotlightSelector) {
      this._spotlightElement(step.spotlightSelector, step.calloutPosition);
    } else {
      this._clearSpotlight();
      this._centerCallout();
    }

    // ── Side-effects (open market, render hand, zoom board, etc.) ──────────
    step.onEnter?.();
  }

  // ── Spotlight helpers ─────────────────────────────────────────────────────

  _spotlightElement(selector, calloutPosition = 'below') {
    const target = document.querySelector(selector);
    if (!target) {
      this._clearSpotlight();
      this._centerCallout();
      return;
    }

    const rect    = target.getBoundingClientRect();
    const padding = 8;

    this._holeEl.style.display = 'block';
    this._holeEl.style.top     = (rect.top    - padding) + 'px';
    this._holeEl.style.left    = (rect.left   - padding) + 'px';
    this._holeEl.style.width   = (rect.width  + padding * 2) + 'px';
    this._holeEl.style.height  = (rect.height + padding * 2) + 'px';


    // The hole's box-shadow provides the dark surround — hide backdrop to
    // prevent double-darkening that makes the spotlight invisible.
    this._backdropEl.style.display = 'none';

    this._positionCallout(rect, calloutPosition);
  }

  // Phase 2, Task 2c: Spotlight across a group of SVG tile <g> elements.
  // Must be called AFTER zoomToTiles() has scrolled into position — use
  // setTimeout(..., 550) to let the smooth scroll animation settle first.
  _spotlightTiles(tileIds, calloutPosition = 'right') {
    const rects = tileIds
      .map(id => this.renderer.tileEls.get(id)?.g)
      .filter(Boolean)
      .map(el => el.getBoundingClientRect());

    if (rects.length === 0) {
      this._clearSpotlight();
      return;
    }

    // Compute the bounding union of all tile rects
    const top = Math.min(...rects.map(r => r.top));
    const left = Math.min(...rects.map(r => r.left));
    const right = Math.max(...rects.map(r => r.right));
    const bottom = Math.max(...rects.map(r => r.bottom));

    const padding = 12;
    this._holeEl.style.display = 'block';
    this._holeEl.style.top = (top - padding) + 'px';
    this._holeEl.style.left = (left - padding) + 'px';
    this._holeEl.style.width = (right - left + padding * 2) + 'px';
    this._holeEl.style.height = (bottom - top + padding * 2) + 'px';

    // The hole's box-shadow creates the dark surround — hide the backdrop
    // so they don't stack and make the highlighted area invisible.
    this._backdropEl.style.display = 'none';

    this._positionCallout(
      { top, left, right, bottom, width: right - left, height: bottom - top },
      calloutPosition
    );
  }

  _positionCallout(targetRect, position = 'below') {
    const callout  = this._calloutEl;
    callout.style.display   = 'block';
    callout.style.transform = ''; // clear any center-callout transform

    const calloutH = callout.offsetHeight || 160;
    const calloutW = callout.offsetWidth  || 340;
    const margin   = 16;
    const vw       = window.innerWidth;
    const vh       = window.innerHeight;

    let top, left;

    switch (position) {
      case 'above':
        top  = targetRect.top - calloutH - margin;
        left = targetRect.left + targetRect.width / 2 - calloutW / 2;
        break;
      case 'below':
        top  = targetRect.bottom + margin;
        left = targetRect.left + targetRect.width / 2 - calloutW / 2;
        break;
      case 'left':
        top  = targetRect.top + targetRect.height / 2 - calloutH / 2;
        left = targetRect.left - calloutW - margin;
        break;
      case 'right':
        top  = targetRect.top + targetRect.height / 2 - calloutH / 2;
        left = targetRect.right + margin;
        break;
      default:
        top  = targetRect.bottom + margin;
        left = targetRect.left;
    }

    // Clamp to viewport so the callout never goes off-screen
    top  = Math.max(margin, Math.min(top,  vh - calloutH - margin));
    left = Math.max(margin, Math.min(left, vw - calloutW - margin));

    callout.style.top  = top  + 'px';
    callout.style.left = left + 'px';
  }

  _centerCallout() {
    const callout = this._calloutEl;
    callout.style.display   = 'block';
    callout.style.top       = '50%';
    callout.style.left      = '50%';
    callout.style.transform = 'translate(-50%, -50%)';
  }

  _clearSpotlight() {
    this._holeEl.style.display    = 'none';
    this._calloutEl.style.transform = '';
    // Restore backdrop for non-spotlight steps
    this._backdropEl.style.display = 'block';
  }

  // ── Callback save / restore ───────────────────────────────────────────────

  _saveCallbacks() {
    this._savedCallbacks = {
      onCardPlayed:     this.cardUI.onCardPlayed,
      onMarketCard:     this.cardUI.onMarketCard,
      onEndTurn:        this.cardUI.onEndTurn,
      onCancelPurchase: this.cardUI.onCancelPurchase,
      onDiscardClicked: this.cardUI.onDiscardClicked,
    };
  }

  _restoreCallbacks() {
    Object.assign(this.cardUI, this._savedCallbacks);
  }

  _installTurnCallbacks() {
    this.cardUI.onCardPlayed = (instanceId) => {
      this.cardUI.updateSelectedCardForMovement(instanceId);
      this._advance();
    };
    this.cardUI.onEndTurn = () => this._advance();
  }

  _installMarketCallbacks() {
    this.cardUI.onMarketCard = ({ cardKey }) => {
      this.cardUI.closeMarket();
      this._advance();
    };
    this.cardUI.onCancelPurchase = () => {
      // prevent closing market during market tutorial steps
    };
  }

  // ── Phase 2: Step builder ─────────────────────────────────────────────────

  _buildSteps() {
    const r = this.renderer;

    return [

      // ── Step 1: Overview ─────────────────────────────────────────────────
      {
        title: 'The Race to El Dorado',
        body: 'This is the map. You start at the <strong>bottom-left</strong> '
          + 'and race toward <strong>El Dorado</strong> in the top-right. '
          + 'Everyone shares the same map — whoever gets there first triggers '
          + 'the final round.',
        nextLabel: 'Show me the map →',
        onEnter: () => {
          this._clearSpotlight();
          this._centerCallout();
        },
      },

      // ── Step 2: Start tiles ───────────────────────────────────────────────
      {
        title: 'Your Starting Position',
        body: 'Each player begins on one of these <strong>start tiles</strong>. '
          + 'You can\'t move back onto start tiles during the game — '
          + 'only forward, toward El Dorado.',
        onEnter: () => {
          r.zoomToTiles(TUTORIAL_TILE_GROUPS.start);
          setTimeout(() => this._spotlightTiles(TUTORIAL_TILE_GROUPS.start, 'right'), 550);
        },
      },

      // ── Step 3: El Dorado ─────────────────────────────────────────────────
      {
        title: 'El Dorado 🏆',
        body: 'The green tiles with a <strong>dashed gold border</strong> and a 🏁 flag '
          + 'are <strong>finishing tiles</strong>. The first player to land on one '
          + 'triggers the final round — every other player gets one more turn. '
          + 'Whoever is furthest along the path wins.',
        onEnter: () => {
          const ids = [...TUTORIAL_TILE_GROUPS.finishing, ...TUTORIAL_TILE_GROUPS.elDorado];
          r.zoomToTiles(ids);
          setTimeout(() => this._spotlightTiles(ids, 'left'), 550);
        },
      },

      // ── Step 4: Jungle ────────────────────────────────────────────────────
      {
        title: '🌿 Jungle Tiles',
        body: 'Most of the early map is <strong>jungle</strong>. '
          + 'Your starting deck has <strong>green cards</strong> '
          + '(Explorers) to cross these. Each Explorer moves you 1 space '
          + 'through the jungle.',
        onEnter: () => {
          r.zoomToTiles(TUTORIAL_TILE_GROUPS.jungle);
          setTimeout(() => this._spotlightTiles(TUTORIAL_TILE_GROUPS.jungle, 'right'), 550);
        },
      },

      // ── Step 5: Water ─────────────────────────────────────────────────────
      {
        title: '🌊 Water Tiles',
        body: 'Rivers and lakes need <strong>blue cards</strong>. '
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
        body: '<strong>Yellow cards</strong> move through villages. '
          + 'They also double as <strong>purchasing power</strong> to buy '
          + 'from the market. A Traveler (1 village movement) is worth 1 gold '
          + 'when spent on a purchase.',
        onEnter: () => {
          r.zoomToTiles(TUTORIAL_TILE_GROUPS.village);
          setTimeout(() => this._spotlightTiles(TUTORIAL_TILE_GROUPS.village, 'right'), 550);
        },
      },

      // ── Step 7: Rubble ────────────────────────────────────────────────────
      {
        title: '🪨 Rubble Tiles',
        body: `To move onto a rubble or base camp space, use any cards from your hand. The number of symbols
              on the space indicates the number of cards you need to play. The identity of those cards is
              irrelevant.`,
        onEnter: () => {
          r.zoomToTiles(TUTORIAL_TILE_GROUPS.rubble);
          setTimeout(() => this._spotlightTiles(TUTORIAL_TILE_GROUPS.rubble, 'right'), 550);
        },
      },

      {
        title: '⛰ Mountain Tiles',
        body: `Mountain tiles are impassable. You cannot move onto them, and you cannot play cards to move through them. You must go around.`,
        onEnter: () => {
          r.zoomToTiles(TUTORIAL_TILE_GROUPS.mountain);
          setTimeout(() => this._spotlightTiles(TUTORIAL_TILE_GROUPS.mountain, 'right'), 550);
        },
      },

      // ── Step 8: Camp ──────────────────────────────────────────────────────
      {
        title: '⛺ Camp Tiles',
        body: `Cards you play to move onto a base camp space aren’t discarded. Instead, they are completely
                removed from the game. They won’t be used again this game.`,
        onEnter: () => {
          r.zoomToTiles(TUTORIAL_TILE_GROUPS.camp);
          setTimeout(() => this._spotlightTiles(TUTORIAL_TILE_GROUPS.camp, 'right'), 550);
        },
      },

      {
        title: 'Greater requirements',
        body: `Some tiles have greater requirements than that you'll need more powerful cards to move onto. For example, the tile 
                highlighted here requires a card that has at least 3 jungle power. The power value of the card must be equal or higher than
                the power of the space. Important: You cannot combine multiple cards to move onto a landscape space with high power value!`,
        onEnter: () => {
          r.zoomToTiles(TUTORIAL_TILE_GROUPS.more_requirements);
          setTimeout(() => this._spotlightTiles(TUTORIAL_TILE_GROUPS.more_requirements, 'right'), 550);
        },
      },

      // ── Step 9: Transition to turn loop ──────────────────────────────────
      {
        title: 'You Know the Map',
        body: 'Now you know what terrain you\'ll face and what card types '
          + 'you\'ll need. The next steps show you how a turn works — '
          + 'from playing your first card to ending your turn.',
        nextLabel: 'Show me a turn →',
        onEnter: () => {
          r.zoomToTiles([...TUTORIAL_TILE_GROUPS.start, ], {maxZoom: 1});
          this._clearSpotlight();
          this._centerCallout();
        },
      },

      // ── Step 10: Your hand ────────────────────────────────────────────────
      {
        title: 'Your Hand',
        body: 'Each turn starts with cards in your hand. '
          + '<strong>Green</strong> moves through jungle, '
          + '<strong>blue</strong> through water, '
          + '<strong>yellow</strong> through villages (and buys cards). '
          + 'Click a card to play it.',
        spotlightSelector: '#player-hand-ui',
        calloutPosition: 'above',
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
        body: 'Glowing tiles show where you can move with the card you played. '
          + 'The card\'s terrain must match the tile. Click a glowing tile to move.',
        spotlightSelector: '#board-container',
        calloutPosition: 'right',
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
        body: 'If you have moves remaining your card stays active and more '
          + 'tiles glow. When done, <strong>End Turn</strong> to draw back '
          + 'up to 4 cards, or open the <strong>Market</strong> to buy first.',
        spotlightSelector: '#hand-controls',
        calloutPosition: 'above',
        onEnter: () => {
          this._nextBtn.style.display = '';
          this.cardUI.onEndTurn = () => this._advance();
        },
      },

      // ── Step 13: Deck cycling ─────────────────────────────────────────────
      {
        title: 'Your Deck Grows',
        body: 'At end of turn you draw back up to 4 cards. Played cards go to '
          + 'your <strong>discard pile</strong>. When your draw pile runs out, '
          + 'the discard is reshuffled — so every card you buy '
          + '<em>will</em> reach your hand.',
        onEnter: () => {
          this._nextBtn.style.display = '';
          this._clearSpotlight();
          this._centerCallout();
        },
      },

      // ── Step 14: Market intro ─────────────────────────────────────────────
      {
        title: 'The Market',
        body: 'During your turn, click <strong>Market</strong> to buy better '
          + 'cards. You pay using cards from your hand as purchasing power. '
          + 'Yellow cards are most valuable — a Traveler is worth 1 gold.',
        spotlightSelector: '#open-market-btn',
        calloutPosition: 'above',
        nextLabel: 'Open the Market →',
        onEnter: () => {
          const tutorialMarket = window.ElDoradoCards.buildShopState();
          this.cardUI.renderHand(TUTORIAL_HAND);
          this.cardUI.renderMarket(tutorialMarket);
          this.cardUI.openMarket(0);
          this._installMarketCallbacks();
          this._nextBtn.style.display = '';
        },
      },

      // ── Step 15: Selecting purchasing power ───────────────────────────────
      {
        title: 'Adding Purchasing Power',
        body: 'Click cards in your hand to pool their purchasing power. '
          + 'Cards with a <strong>green outline</strong> are ones you can '
          + 'currently afford. Try clicking the Traveler.',
        spotlightSelector: '#player-hand-ui',
        calloutPosition: 'above',
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
        body: 'Cards with a <strong>green outline</strong> are affordable. '
          + 'Click one to buy it. It goes to your <strong>discard pile</strong> '
          + 'and cycles into your hand in a future turn.',
        spotlightSelector: '#shop-slots',
        calloutPosition: 'above',
        onEnter: () => {
          this._nextBtn.style.display = 'none';
        },
      },

      // ── Step 17: Wrap-up ──────────────────────────────────────────────────
      {
        title: 'You\'re Ready to Explore',
        body: 'Build your deck around the terrain ahead, spend yellow cards '
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
    ];
  }
}