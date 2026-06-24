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

    this._positionCallout(rect, calloutPosition);
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
}