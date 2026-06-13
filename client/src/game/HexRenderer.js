// client/src/game/HexRenderer.js
// Flat-top hex pixel formula (matches BlockBase.gd exactly):
//   cx = 75 * q
//   cy = 43.3 * q + 86.6 * r

const HEX_R  = 50;
const W_STEP = 75;
const H_STEP = 86.6;
const H_HALF = 43.3;

// Terrain configuration — richer visual identity per tile type
const TERRAIN = {
  jungle:   { fill: '#1a4f1a', stroke: '#0e3010', icon: '🌿', label: 'Jungle'    },
  water:    { fill: '#0e3d72', stroke: '#082550', icon: '🌊', label: 'River'     },
  village:  { fill: '#7a5800', stroke: '#4d3800', icon: '🏘️', label: 'Village'   },
  mountain: { fill: '#1a1410', stroke: '#0e0c08', icon: '⛰',  label: 'Mountain', textColor: '#7ab8d4' },
  camp:     { fill: '#5a2a20', stroke: '#3d1a12', icon: '⛺',  label: 'Camp'     },
  rubble:   { fill: '#3a3830', stroke: '#252420', icon: '🪨',  label: 'Rubble'   },
  start:    { fill: '#1a3060', stroke: '#0e1e40', icon: '🏳',  label: 'Start'    },
  el_dorado:{ fill: '#1a5a40', stroke: '#0e3a28', icon: '🏆',  label: 'El Dorado'},
};

// Pawn colors with a richer palette
const PAWN_PALETTE = [
  { fill: '#e74c3c', stroke: '#8b1a0e', glow: 'rgba(231,76,60,0.6)'   }, // red
  { fill: '#3498db', stroke: '#1a5a8a', glow: 'rgba(52,152,219,0.6)'  }, // blue
  { fill: '#2ecc71', stroke: '#1a7a40', glow: 'rgba(46,204,113,0.6)'  }, // green
  { fill: '#f39c12', stroke: '#8a5a06', glow: 'rgba(243,156,18,0.6)'  }, // orange
];

class HexRenderer {
  constructor(svgEl) {
    this.svg        = svgEl;
    this.tileEls    = new Map(); // tileId → { g, poly, tile }
    this.pawnEls    = new Map(); // playerId → { g, circle }
    this.onTileClick = null;
    this.scale      = 1;
    this._defs      = null;
    this._animFrames = new Set(); // active rAF ids for cleanup

    this._initDefs();
  }

  // ── SVG defs: filters + gradients used across tiles ──────────────────────

  _initDefs() {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

    // Subtle grain/noise filter for terrain tiles
    defs.innerHTML = `
      <filter id="tile-grain" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" result="noise"/>
        <feColorMatrix type="saturate" values="0" in="noise" result="grayNoise"/>
        <feBlend in="SourceGraphic" in2="grayNoise" mode="overlay" result="blended"/>
        <feComposite in="blended" in2="SourceGraphic" operator="in"/>
      </filter>

      <filter id="pawn-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="5" result="blur"/>
        <feFlood flood-color="white" flood-opacity="0.4" result="color"/>
        <feComposite in="color" in2="blur" operator="in" result="coloredBlur"/>
        <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>

      <filter id="valid-glow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="4" result="blur"/>
        <feFlood flood-color="#ffff00" flood-opacity="0.7" result="color"/>
        <feComposite in="color" in2="blur" operator="in" result="glow"/>
        <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>

      <filter id="eldorado-glow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="6" result="blur"/>
        <feFlood flood-color="#ffd700" flood-opacity="0.8" result="color"/>
        <feComposite in="color" in2="blur" operator="in" result="glow"/>
        <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>

      <radialGradient id="hex-inner-light" cx="40%" cy="35%" r="65%">
        <stop offset="0%"   stop-color="rgba(255,255,255,0.12)"/>
        <stop offset="100%" stop-color="rgba(0,0,0,0.25)"/>
      </radialGradient>

      <radialGradient id="eldorado-radial" cx="50%" cy="50%" r="55%">
        <stop offset="0%"   stop-color="#2a7a58"/>
        <stop offset="60%"  stop-color="#1a5a40"/>
        <stop offset="100%" stop-color="#0e3a28"/>
      </radialGradient>

      <radialGradient id="eldorado-glow-grad" cx="50%" cy="50%" r="50%">
        <stop offset="0%"   stop-color="rgba(255,215,0,0.25)"/>
        <stop offset="100%" stop-color="rgba(255,215,0,0)"/>
      </radialGradient>
    `;

    this.svg.appendChild(defs);
    this._defs = defs;
  }

  // ── Main render ───────────────────────────────────────────────────────────

  render(tiles) {
    // Keep defs, clear everything else
    const toRemove = [];
    for (const child of this.svg.children) {
      if (child.tagName !== 'defs') toRemove.push(child);
    }
    toRemove.forEach(el => el.remove());

    this.tileEls.clear();
    this.pawnEls.clear();

    if (!tiles || tiles.length === 0) return;

    let minX =  Infinity, minY =  Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const t of tiles) {
      const { cx, cy } = this._center(t.q, t.r);
      if (cx - HEX_R < minX) minX = cx - HEX_R;
      if (cy - HEX_R < minY) minY = cy - HEX_R;
      if (cx + HEX_R > maxX) maxX = cx + HEX_R;
      if (cy + HEX_R > maxY) maxY = cy + HEX_R;
    }

    const pad = 40;
    this.svg.setAttribute('viewBox',
      `${minX-pad} ${minY-pad} ${maxX-minX+pad*2} ${maxY-minY+pad*2}`);

    // Layer order: start tiles → normal → camp/rubble → el_dorado on top
    const ORDER = { start: 0, jungle: 1, water: 1, village: 1, mountain: 1, rubble: 2, camp: 2, el_dorado: 3 };
    const sorted = [...tiles].sort((a, b) => (ORDER[a.terrainType] ?? 1) - (ORDER[b.terrainType] ?? 1));

    for (const tile of sorted) this._renderTile(tile);
  }

  _center(q, r) {
    return { cx: W_STEP * q, cy: H_HALF * q + H_STEP * r };
  }

  _hexPoints(cx, cy, radius = HEX_R) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i);
      pts.push(`${(cx + radius * Math.cos(a)).toFixed(1)},${(cy + radius * Math.sin(a)).toFixed(1)}`);
    }
    return pts.join(' ');
  }

  _renderTile(tile) {
    const { cx, cy } = this._center(tile.q, tile.r);
    const style = TERRAIN[tile.terrainType] || { fill: '#333', stroke: '#222', icon: '?' };
    const isElDorado = tile.terrainType === 'el_dorado';
    const isFinishing = tile.isFinishing;
    const isMountain  = tile.terrainType === 'mountain';

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-tile-id', tile.id);
    if (!isMountain) g.style.cursor = 'pointer';

    // ── El Dorado: special glow backdrop ──────────────────────────────────
    if (isElDorado) {
      const glowCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      glowCircle.setAttribute('cx', cx);
      glowCircle.setAttribute('cy', cy);
      glowCircle.setAttribute('r', HEX_R * 1.4);
      glowCircle.setAttribute('fill', 'url(#eldorado-glow-grad)');
      glowCircle.setAttribute('pointer-events', 'none');
      g.appendChild(glowCircle);
    }

    // ── Main hex polygon ──────────────────────────────────────────────────
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', this._hexPoints(cx, cy));
    poly.setAttribute('fill', isElDorado ? 'url(#eldorado-radial)' : style.fill);
    poly.setAttribute('stroke', style.stroke);
    poly.setAttribute('stroke-width', isElDorado ? '2.5' : '1.5');
    poly.style.transition = 'filter 0.15s, stroke 0.15s, stroke-width 0.15s';
    g.appendChild(poly);

    // ── Inner light overlay (makes tiles feel 3-dimensional) ─────────────
    if (!isMountain) {
      const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      overlay.setAttribute('points', this._hexPoints(cx, cy, HEX_R - 1));
      overlay.setAttribute('fill', 'url(#hex-inner-light)');
      overlay.setAttribute('pointer-events', 'none');
      g.appendChild(overlay);
    }

    // ── El Dorado inner ring ──────────────────────────────────────────────
    if (isElDorado) {
      const ring1 = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      ring1.setAttribute('points', this._hexPoints(cx, cy, HEX_R * 0.82));
      ring1.setAttribute('fill', 'none');
      ring1.setAttribute('stroke', 'rgba(255,215,0,0.6)');
      ring1.setAttribute('stroke-width', '2');
      ring1.setAttribute('pointer-events', 'none');
      g.appendChild(ring1);

      const ring2 = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      ring2.setAttribute('points', this._hexPoints(cx, cy, HEX_R * 0.62));
      ring2.setAttribute('fill', 'none');
      ring2.setAttribute('stroke', 'rgba(255,215,0,0.35)');
      ring2.setAttribute('stroke-width', '1.5');
      ring2.setAttribute('pointer-events', 'none');
      g.appendChild(ring2);
    }

    // ── Finishing tiles: dashed gold border ───────────────────────────────
    if (isFinishing) {
      const finishRing = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      finishRing.setAttribute('points', this._hexPoints(cx, cy, HEX_R * 0.86));
      finishRing.setAttribute('fill', 'none');
      finishRing.setAttribute('stroke', '#ffd700');
      finishRing.setAttribute('stroke-width', '2.5');
      finishRing.setAttribute('stroke-dasharray', '8 5');
      finishRing.setAttribute('pointer-events', 'none');
      finishRing.style.opacity = '0.85';
      g.appendChild(finishRing);
    }

    // ── Terrain icon ──────────────────────────────────────────────────────
    const iconSize = isElDorado ? 34 : (isMountain ? 28 : 30);
    const iconY    = (tile.movementCost > 1 && !isMountain) ? cy - 8 : cy + 2;

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    icon.setAttribute('x', cx);
    icon.setAttribute('y', iconY);
    icon.setAttribute('text-anchor', 'middle');
    icon.setAttribute('dominant-baseline', 'middle');
    icon.setAttribute('font-size', iconSize);
    icon.setAttribute('pointer-events', 'none');
    if (style.textColor) icon.setAttribute('fill', style.textColor);
    icon.textContent = style.icon;
    g.appendChild(icon);

    // ── Movement cost badge ───────────────────────────────────────────────
    if (tile.movementCost > 1 && !isMountain) {
      // Background pill for readability
      const badgeBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      badgeBg.setAttribute('x', cx - 16);
      badgeBg.setAttribute('y', cy + 16);
      badgeBg.setAttribute('width', 32);
      badgeBg.setAttribute('height', 16);
      badgeBg.setAttribute('rx', '8');
      badgeBg.setAttribute('fill', 'rgba(0,0,0,0.55)');
      badgeBg.setAttribute('pointer-events', 'none');
      g.appendChild(badgeBg);

      const badge = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      badge.setAttribute('x', cx);
      badge.setAttribute('y', cy + 25);
      badge.setAttribute('text-anchor', 'middle');
      badge.setAttribute('dominant-baseline', 'middle');
      badge.setAttribute('font-size', '13');
      badge.setAttribute('fill', '#ffd700');
      badge.setAttribute('font-weight', 'bold');
      badge.setAttribute('font-family', 'Inter, sans-serif');
      badge.setAttribute('pointer-events', 'none');
      badge.textContent = `×${tile.movementCost}`;
      g.appendChild(badge);
    }

    // ── Finishing flag icon ───────────────────────────────────────────────
    if (isFinishing) {
      const flag = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      flag.setAttribute('x', cx + 22);
      flag.setAttribute('y', cy - 22);
      flag.setAttribute('text-anchor', 'middle');
      flag.setAttribute('dominant-baseline', 'middle');
      flag.setAttribute('font-size', '14');
      flag.setAttribute('pointer-events', 'none');
      flag.textContent = '🏁';
      g.appendChild(flag);
    }

    // ── El Dorado animated shimmer ring ───────────────────────────────────
    if (isElDorado) {
      const shimmerRing = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      shimmerRing.setAttribute('points', this._hexPoints(cx, cy, HEX_R * 0.95));
      shimmerRing.setAttribute('fill', 'none');
      shimmerRing.setAttribute('stroke', '#ffd700');
      shimmerRing.setAttribute('stroke-width', '2');
      shimmerRing.setAttribute('pointer-events', 'none');
      shimmerRing.setAttribute('opacity', '0');

      const animEl = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
      animEl.setAttribute('attributeName', 'opacity');
      animEl.setAttribute('values', '0;0.8;0');
      animEl.setAttribute('dur', '2.5s');
      animEl.setAttribute('repeatCount', 'indefinite');
      animEl.setAttribute('begin', `${Math.random() * 2}s`);
      shimmerRing.appendChild(animEl);
      g.appendChild(shimmerRing);
    }

    g.addEventListener('click', () => this.onTileClick?.(tile.id));

    this.svg.appendChild(g);
    this.tileEls.set(tile.id, { g, poly, tile });
  }

  // ── Valid move highlighting ────────────────────────────────────────────────

  setValidMoves(tileIds) {
    const validSet = new Set(tileIds);

    for (const [id, { poly, tile }] of this.tileEls) {
      const isValid = validSet.has(id);
      const style = TERRAIN[tile.terrainType] || {};

      if (isValid) {
        poly.setAttribute('stroke', '#ffee00');
        poly.setAttribute('stroke-width', '3.5');
        poly.style.filter = 'brightness(1.4)';
        poly.style.animation = 'hex-pulse 1.4s ease-in-out infinite';

        // Add a pulsing glow ring
        let glowRing = this.tileEls.get(id)._glowRing;
        if (!glowRing) {
          const { cx, cy } = this._center(tile.q, tile.r);
          glowRing = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          glowRing.setAttribute('points', this._hexPoints(cx, cy, HEX_R + 4));
          glowRing.setAttribute('fill', 'none');
          glowRing.setAttribute('stroke', 'rgba(255,238,0,0.45)');
          glowRing.setAttribute('stroke-width', '8');
          glowRing.setAttribute('pointer-events', 'none');
          glowRing.style.animation = 'glow-pulse 1.4s ease-in-out infinite';
          this.tileEls.get(id)._glowRing = glowRing;
          this.tileEls.get(id).g.insertBefore(glowRing, this.tileEls.get(id).g.firstChild);
        }
        glowRing.style.display = '';
      } else {
        poly.setAttribute('stroke', style.stroke || '#222');
        poly.setAttribute('stroke-width', tile.terrainType === 'el_dorado' ? '2.5' : '1.5');
        poly.style.filter = '';
        poly.style.animation = '';

        const entry = this.tileEls.get(id);
        if (entry._glowRing) entry._glowRing.style.display = 'none';
      }
    }
  }

  clearHighlights() {
    this.setValidMoves([]);
  }

  // ── Pawn rendering ────────────────────────────────────────────────────────
  // Pawns are expedition markers: a filled circle with a contrasting stroke,
  // a small highlight dot for depth, and a player-number label.

  setPawnPosition(playerId, tileId, colorIndex = 0) {
    // Remove existing pawn element
    const existing = this.svg.querySelector(`[data-pawn="${CSS.escape(playerId)}"]`);
    if (existing) existing.remove();

    const entry = this.tileEls.get(tileId);
    if (!entry) return;

    const { cx, cy } = this._center(entry.tile.q, entry.tile.r);
    const palette = PAWN_PALETTE[colorIndex] || PAWN_PALETTE[0];

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-pawn', playerId);
    g.setAttribute('pointer-events', 'none');

    // Shadow / glow halo beneath the pawn
    const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    halo.setAttribute('cx', cx);
    halo.setAttribute('cy', cy + 2);
    halo.setAttribute('r', '20');
    halo.setAttribute('fill', palette.glow);
    halo.setAttribute('opacity', '0.4');
    g.appendChild(halo);

    // Main pawn body
    const body = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    body.setAttribute('cx', cx);
    body.setAttribute('cy', cy);
    body.setAttribute('r', '15');
    body.setAttribute('fill', palette.fill);
    body.setAttribute('stroke', palette.stroke);
    body.setAttribute('stroke-width', '2.5');
    g.appendChild(body);

    // Inner highlight for depth
    const highlight = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    highlight.setAttribute('cx', cx - 4);
    highlight.setAttribute('cy', cy - 4);
    highlight.setAttribute('r', '5');
    highlight.setAttribute('fill', 'rgba(255,255,255,0.28)');
    g.appendChild(highlight);

    // Outer stroke ring
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ring.setAttribute('cx', cx);
    ring.setAttribute('cy', cy);
    ring.setAttribute('r', '17');
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', 'rgba(255,255,255,0.2)');
    ring.setAttribute('stroke-width', '1');
    g.appendChild(ring);

    this.svg.appendChild(g);
    this.pawnEls.set(playerId, g);
  }

  // ── Flash a tile briefly (e.g. on illegal move attempt) ──────────────────

  flashTile(tileId, color = '#e74c3c') {
    const entry = this.tileEls.get(tileId);
    if (!entry) return;
    const { poly } = entry;
    const originalFilter = poly.style.filter;
    poly.style.filter = `brightness(2) sepia(1) hue-rotate(${color === '#e74c3c' ? '0' : '120'}deg)`;
    setTimeout(() => { poly.style.filter = originalFilter; }, 350);
  }

  // ── Scale / zoom ──────────────────────────────────────────────────────────

  setScale(s) {
    this.scale = Math.max(0.2, Math.min(4, Number(s) || 1));
    this.svg.style.width  = this.scale * 100 + '%';
    this.svg.style.height = this.scale * 100 + '%';
  }
}