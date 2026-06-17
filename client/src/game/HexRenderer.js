// client/src/game/HexRenderer.js
// Flat-top hex pixel formula (matches BlockBase.gd exactly):
//   cx = 75 * q
//   cy = 43.3 * q + 86.6 * r

const HEX_R  = 50;
const W_STEP = 75;
const H_STEP = 86.6;
const H_HALF = 43.3;

// Terrain configuration
// fill      = base hex fill colour
// hilite    = lighter shade for top-left bevel edge
// shadow    = darker shade for bottom-right bevel edge
// innerFill = slightly lighter face for raised coin look
// stroke    = outer border colour between tiles
const TERRAIN = {
  jungle:   { fill: '#2a6b1a', hilite: '#4a9b2a', shadow: '#0e3a0a', innerFill: '#347a20', stroke: '#1a4a10', icon: '🌿' },
  water:    { fill: '#1a5a9a', hilite: '#3a8ace', shadow: '#08305a', innerFill: '#2068b0', stroke: '#0e3a6a', icon: '🌊' },
  village:  { fill: '#b07820', hilite: '#d4a040', shadow: '#6a4808', innerFill: '#c08828', stroke: '#7a5210', icon: '🏘️' },
  mountain: { fill: '#2a2420', hilite: '#4a3c34', shadow: '#100e0c', innerFill: '#342c26', stroke: '#1a1410', icon: '⛰',  textColor: '#9abcd4' },
  camp:     { fill: '#7a3a28', hilite: '#a85a40', shadow: '#3a1810', innerFill: '#8a4430', stroke: '#5a2818', icon: '⛺' },
  rubble:   { fill: '#5a5244', hilite: '#7a6e5e', shadow: '#2e2a22', innerFill: '#68604e', stroke: '#3e3830', icon: '🪨' },
  start:    { fill: '#2a4080', hilite: '#4a62b0', shadow: '#101e40', innerFill: '#344c90', stroke: '#1a2e5a', icon: '🏳' },
  el_dorado:{ fill: '#1a6a48', hilite: '#2a9a6a', shadow: '#083a28', innerFill: '#228058', stroke: '#0e4a30', icon: '🏆' },
};

// Pawn colors
const PAWN_PALETTE = [
  { fill: '#e74c3c', stroke: '#8b1a0e', glow: 'rgba(231,76,60,0.6)'   },
  { fill: '#3498db', stroke: '#1a5a8a', glow: 'rgba(52,152,219,0.6)'  },
  { fill: '#2ecc71', stroke: '#1a7a40', glow: 'rgba(46,204,113,0.6)'  },
  { fill: '#f39c12', stroke: '#8a5a06', glow: 'rgba(243,156,18,0.6)'  },
];

class HexRenderer {
  constructor(svgEl) {
    this.svg         = svgEl;
    this.tileEls     = new Map();
    this.pawnEls     = new Map();
    this.onTileClick = null;
    this.scale       = 1;
    this._defs       = null;
    this._animFrames = new Set();

    this._initDefs();
  }

  _initDefs() {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

    // NOTE on pattern scale: the SVG viewBox spans ~2200×1800 units.
    // Pattern widths/heights are in those same units, so a "10px-looking"
    // line at screen size needs to be ~10-14 units wide here.

    defs.innerHTML = `
      <!-- ── Parchment base: warm aged paper gradient ── -->
      <linearGradient id="parchment-base" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%"   stop-color="#efe0b0" />
        <stop offset="35%"  stop-color="#e6d498" />
        <stop offset="70%"  stop-color="#d9c278" />
        <stop offset="100%" stop-color="#c4a855" />
      </linearGradient>

      <!-- ── Parchment grain: feTurbulence in objectBoundingBox space ── -->
      <!-- filterUnits="objectBoundingBox" (default) means the filter region  -->
      <!-- covers the element. baseFrequency in this mode is normalised to     -->
      <!-- the element's bounding box, so 0.65 ≈ ~1.5 cycles across the rect. -->
      <filter id="parchment-grain" x="0%" y="0%" width="100%" height="100%"
              color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.65 0.45"
                      numOctaves="4" seed="42" stitchTiles="stitch" result="noise"/>
        <feColorMatrix type="saturate" values="0" in="noise" result="grayNoise"/>
        <feBlend in="SourceGraphic" in2="grayNoise" mode="multiply" result="fibred"/>
        <feComposite in="fibred" in2="SourceGraphic" operator="in"/>
      </filter>

      <!-- ── Age-spot blotches: coarser noise for stain patches ── -->
      <filter id="parchment-age" x="0%" y="0%" width="100%" height="100%"
              color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.18 0.12"
                      numOctaves="3" seed="7" stitchTiles="stitch" result="bigNoise"/>
        <feColorMatrix type="matrix" in="bigNoise"
          values="0 0 0 0 0.55
                  0 0 0 0 0.38
                  0 0 0 0 0.10
                  0 0 0 1.8 -0.7" result="brownTone"/>
        <feComposite in="brownTone" in2="SourceGraphic" operator="in"/>
      </filter>

      <!-- ── Map grid lines: faint cartographic grid ── -->
      <!-- Width/height in viewBox units (~2000 wide). 80 units ≈ visible grid. -->
      <pattern id="map-grid" x="0" y="0" width="80" height="80"
               patternUnits="userSpaceOnUse">
        <path d="M 80 0 L 0 0 0 80" fill="none"
              stroke="#8a6e30" stroke-width="0.6" opacity="1"/>
      </pattern>

      <!-- ── Diagonal hatch: secondary texture layer ── -->
      <pattern id="map-hatch" x="0" y="0" width="28" height="28"
               patternUnits="userSpaceOnUse">
        <line x1="0"  y1="28" x2="28" y2="0"  stroke="#7a5e28" stroke-width="0.5" opacity="1"/>
        <line x1="-7" y1="28" x2="21" y2="0"  stroke="#7a5e28" stroke-width="0.3" opacity="1"/>
        <line x1="7"  y1="28" x2="35" y2="0"  stroke="#7a5e28" stroke-width="0.3" opacity="1"/>
      </pattern>

      <!-- ── Edge vignette: darkens corners/edges, scrolls WITH the SVG ── -->
      <!-- gradientUnits="objectBoundingBox" means cx/cy/r are fractions of   -->
      <!-- the element's bounding box — works correctly since our rect spans   -->
      <!-- the full viewBox with explicit pixel coordinates.                   -->
      <radialGradient id="content-vignette" cx="50%" cy="50%" r="70%"
                      gradientUnits="objectBoundingBox">
        <stop offset="0%"   stop-color="#c8a030" stop-opacity="0"    />
        <stop offset="50%"  stop-color="#a07820" stop-opacity="0.05" />
        <stop offset="75%"  stop-color="#7a5010" stop-opacity="0.30" />
        <stop offset="100%" stop-color="#3a2005" stop-opacity="0.65" />
      </radialGradient>

      <!-- ── Per-tile face light (top-left bright spot) ── -->
      <radialGradient id="hex-face-light" cx="35%" cy="30%" r="70%">
        <stop offset="0%"   stop-color="rgba(255,255,255,0.22)"/>
        <stop offset="55%"  stop-color="rgba(255,255,255,0.04)"/>
        <stop offset="100%" stop-color="rgba(0,0,0,0.28)"/>
      </radialGradient>

      <!-- ── El Dorado tile gradients ── -->
      <radialGradient id="eldorado-radial" cx="50%" cy="45%" r="60%">
        <stop offset="0%"   stop-color="#36a070"/>
        <stop offset="55%"  stop-color="#1e7050"/>
        <stop offset="100%" stop-color="#0c4030"/>
      </radialGradient>
      <radialGradient id="eldorado-glow-grad" cx="50%" cy="50%" r="50%">
        <stop offset="0%"   stop-color="rgba(255,215,0,0.30)"/>
        <stop offset="100%" stop-color="rgba(255,215,0,0)"/>
      </radialGradient>
    `;

    this.svg.appendChild(defs);
    this._defs = defs;
  }

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

    const pad = 80;
    const vx = minX - pad;
    const vy = minY - pad;
    const vw = maxX - minX + pad * 2;
    const vh = maxY - minY + pad * 2;

    this.svg.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);

    const ns = 'http://www.w3.org/2000/svg';
    const mkRect = () => document.createElementNS(ns, 'rect');

    const base = (fill, filter) => {
      const r = mkRect();
      r.setAttribute('x', vx); r.setAttribute('y', vy);
      r.setAttribute('width', vw); r.setAttribute('height', vh);
      r.setAttribute('fill', fill);
      if (filter) r.setAttribute('filter', filter);
      r.setAttribute('pointer-events', 'none');
      return r;
    };

    // Layer 1: warm parchment base gradient
    this.svg.appendChild(base('url(#parchment-base)'));

    // Layer 2: organic paper-fibre noise (feTurbulence multiply blend)
    // Rendered at 35% opacity so the base colour shows through warmly
    const grainRect = base('#d4b870', 'url(#parchment-grain)');
    grainRect.setAttribute('opacity', '0.35');
    this.svg.appendChild(grainRect);

    // Layer 3: larger age-spot blotches at low opacity
    const ageRect = base('#c8a448', 'url(#parchment-age)');
    ageRect.setAttribute('opacity', '0.22');
    this.svg.appendChild(ageRect);

    // Layer 4: cartographic grid (very faint — just visible at normal zoom)
    const gridRect = base('url(#map-grid)');
    gridRect.setAttribute('opacity', '0.28');
    this.svg.appendChild(gridRect);

    // Layer 5: diagonal hatch (even fainter — gives the paper a woven feel)
    const hatchRect = base('url(#map-hatch)');
    hatchRect.setAttribute('opacity', '0.10');
    this.svg.appendChild(hatchRect);

    // Layer 6: edge vignette — must use vx/vy/vw/vh (same as all other rects).
    // SVG rect percentage dimensions are relative to the viewport, NOT viewBox,
    // so "100%" would render a tiny box. Use explicit coordinates.
    const vigRect = base('url(#content-vignette)');
    vigRect.setAttribute('pointer-events', 'none');
    this.svg.appendChild(vigRect);

    // ── Tiles ─────────────────────────────────────────────────────────────────
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

  _hexVertices(cx, cy, radius = HEX_R) {
    const verts = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i);
      verts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
    }
    return verts;
  }

  _renderTile(tile) {
    const { cx, cy } = this._center(tile.q, tile.r);
    const style = TERRAIN[tile.terrainType] || { fill: '#444', hilite: '#666', shadow: '#222', innerFill: '#555', stroke: '#333', icon: '?' };
    const isElDorado  = tile.terrainType === 'el_dorado';
    const isFinishing = tile.isFinishing;
    const isMountain  = tile.terrainType === 'mountain';

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-tile-id', tile.id);
    if (!isMountain) g.style.cursor = 'pointer';

    const ns = 'http://www.w3.org/2000/svg';
    const mk = (tag) => document.createElementNS(ns, tag);

    // ── El Dorado glow backdrop ──────────────────────────────────────────────
    if (isElDorado) {
      const glowCircle = mk('circle');
      glowCircle.setAttribute('cx', cx);
      glowCircle.setAttribute('cy', cy);
      glowCircle.setAttribute('r', HEX_R * 1.5);
      glowCircle.setAttribute('fill', 'url(#eldorado-glow-grad)');
      glowCircle.setAttribute('pointer-events', 'none');
      g.appendChild(glowCircle);
    }

    // ── Shadow bevel: offset hex behind main tile — creates raised-tile look ──
    const shadowPoly = mk('polygon');
    shadowPoly.setAttribute('points', this._hexPoints(cx + 1.5, cy + 2, HEX_R + 0.5));
    shadowPoly.setAttribute('fill', style.shadow);
    shadowPoly.setAttribute('opacity', '0.7');
    shadowPoly.setAttribute('pointer-events', 'none');
    g.appendChild(shadowPoly);

    // ── Main hex face ─────────────────────────────────────────────────────────
    const poly = mk('polygon');
    poly.setAttribute('points', this._hexPoints(cx, cy));
    poly.setAttribute('fill', isElDorado ? 'url(#eldorado-radial)' : style.fill);
    poly.setAttribute('stroke', style.stroke);
    poly.setAttribute('stroke-width', '1.5');
    poly.style.transition = 'filter 0.15s, stroke 0.15s, stroke-width 0.15s';
    g.appendChild(poly);

    // ── Inner face: slightly lighter + slightly smaller for coin-like depth ───
    if (!isMountain) {
      const innerPoly = mk('polygon');
      innerPoly.setAttribute('points', this._hexPoints(cx, cy, HEX_R - 3));
      innerPoly.setAttribute('fill', style.innerFill || style.fill);
      innerPoly.setAttribute('stroke', 'none');
      innerPoly.setAttribute('pointer-events', 'none');
      g.appendChild(innerPoly);
    }

    // ── Bevel highlight: bright polyline on top-left facing edges ─────────────
    // Flat-top vertices: 0=right, 1=lower-right, 2=lower-left,
    //                    3=left,  4=upper-left,  5=upper-right
    {
      const v = this._hexVertices(cx, cy, HEX_R - 1);
      const litPath = mk('polyline');
      litPath.setAttribute('points',
        `${v[3].x.toFixed(1)},${v[3].y.toFixed(1)} ` +
        `${v[4].x.toFixed(1)},${v[4].y.toFixed(1)} ` +
        `${v[5].x.toFixed(1)},${v[5].y.toFixed(1)} ` +
        `${v[0].x.toFixed(1)},${v[0].y.toFixed(1)}`
      );
      litPath.setAttribute('fill', 'none');
      litPath.setAttribute('stroke', style.hilite);
      litPath.setAttribute('stroke-width', '2');
      litPath.setAttribute('stroke-linecap', 'round');
      litPath.setAttribute('stroke-linejoin', 'round');
      litPath.setAttribute('opacity', '0.65');
      litPath.setAttribute('pointer-events', 'none');
      g.appendChild(litPath);

      const shadowLine = mk('polyline');
      shadowLine.setAttribute('points',
        `${v[0].x.toFixed(1)},${v[0].y.toFixed(1)} ` +
        `${v[1].x.toFixed(1)},${v[1].y.toFixed(1)} ` +
        `${v[2].x.toFixed(1)},${v[2].y.toFixed(1)} ` +
        `${v[3].x.toFixed(1)},${v[3].y.toFixed(1)}`
      );
      shadowLine.setAttribute('fill', 'none');
      shadowLine.setAttribute('stroke', style.shadow);
      shadowLine.setAttribute('stroke-width', '2');
      shadowLine.setAttribute('stroke-linecap', 'round');
      shadowLine.setAttribute('stroke-linejoin', 'round');
      shadowLine.setAttribute('opacity', '0.5');
      shadowLine.setAttribute('pointer-events', 'none');
      g.appendChild(shadowLine);
    }

    // ── Radial light overlay ──────────────────────────────────────────────────
    if (!isMountain) {
      const overlay = mk('polygon');
      overlay.setAttribute('points', this._hexPoints(cx, cy, HEX_R - 3));
      overlay.setAttribute('fill', 'url(#hex-face-light)');
      overlay.setAttribute('pointer-events', 'none');
      g.appendChild(overlay);
    }

    // ── El Dorado inner gold rings ────────────────────────────────────────────
    if (isElDorado) {
      const ring1 = mk('polygon');
      ring1.setAttribute('points', this._hexPoints(cx, cy, HEX_R * 0.80));
      ring1.setAttribute('fill', 'none');
      ring1.setAttribute('stroke', 'rgba(255,215,0,0.65)');
      ring1.setAttribute('stroke-width', '2');
      ring1.setAttribute('pointer-events', 'none');
      g.appendChild(ring1);

      const ring2 = mk('polygon');
      ring2.setAttribute('points', this._hexPoints(cx, cy, HEX_R * 0.58));
      ring2.setAttribute('fill', 'none');
      ring2.setAttribute('stroke', 'rgba(255,215,0,0.4)');
      ring2.setAttribute('stroke-width', '1.5');
      ring2.setAttribute('pointer-events', 'none');
      g.appendChild(ring2);
    }

    // ── Finishing tiles: dashed gold border ───────────────────────────────────
    if (isFinishing) {
      const finishRing = mk('polygon');
      finishRing.setAttribute('points', this._hexPoints(cx, cy, HEX_R * 0.84));
      finishRing.setAttribute('fill', 'none');
      finishRing.setAttribute('stroke', '#ffd700');
      finishRing.setAttribute('stroke-width', '2');
      finishRing.setAttribute('stroke-dasharray', '8 5');
      finishRing.setAttribute('pointer-events', 'none');
      finishRing.style.opacity = '0.8';
      g.appendChild(finishRing);
    }

    // ── Terrain icon ──────────────────────────────────────────────────────────
    const iconSize = isElDorado ? 34 : (isMountain ? 26 : 28);
    const iconY    = (tile.movementCost > 1 && !isMountain) ? cy - 8 : cy + 2;

    const icon = mk('text');
    icon.setAttribute('x', cx);
    icon.setAttribute('y', iconY);
    icon.setAttribute('text-anchor', 'middle');
    icon.setAttribute('dominant-baseline', 'middle');
    icon.setAttribute('font-size', iconSize);
    icon.setAttribute('pointer-events', 'none');
    if (style.textColor) icon.setAttribute('fill', style.textColor);
    icon.textContent = style.icon;
    g.appendChild(icon);

    // ── Movement cost badge ───────────────────────────────────────────────────
    if (tile.movementCost > 1 && !isMountain) {
      const badgeBg = mk('rect');
      badgeBg.setAttribute('x', cx - 14);
      badgeBg.setAttribute('y', cy + 15);
      badgeBg.setAttribute('width', 28);
      badgeBg.setAttribute('height', 15);
      badgeBg.setAttribute('rx', '7');
      badgeBg.setAttribute('fill', 'rgba(0,0,0,0.60)');
      badgeBg.setAttribute('pointer-events', 'none');
      g.appendChild(badgeBg);

      const badge = mk('text');
      badge.setAttribute('x', cx);
      badge.setAttribute('y', cy + 23);
      badge.setAttribute('text-anchor', 'middle');
      badge.setAttribute('dominant-baseline', 'middle');
      badge.setAttribute('font-size', '12');
      badge.setAttribute('fill', '#ffd700');
      badge.setAttribute('font-weight', 'bold');
      badge.setAttribute('font-family', 'Inter, sans-serif');
      badge.setAttribute('pointer-events', 'none');
      badge.textContent = `×${tile.movementCost}`;
      g.appendChild(badge);
    }

    // ── Finishing flag icon ───────────────────────────────────────────────────
    if (isFinishing) {
      const flag = mk('text');
      flag.setAttribute('x', cx + 22);
      flag.setAttribute('y', cy - 22);
      flag.setAttribute('text-anchor', 'middle');
      flag.setAttribute('dominant-baseline', 'middle');
      flag.setAttribute('font-size', '14');
      flag.setAttribute('pointer-events', 'none');
      flag.textContent = '🏁';
      g.appendChild(flag);
    }

    // ── El Dorado animated shimmer ring ───────────────────────────────────────
    if (isElDorado) {
      const shimmerRing = mk('polygon');
      shimmerRing.setAttribute('points', this._hexPoints(cx, cy, HEX_R * 0.93));
      shimmerRing.setAttribute('fill', 'none');
      shimmerRing.setAttribute('stroke', '#ffd700');
      shimmerRing.setAttribute('stroke-width', '2');
      shimmerRing.setAttribute('pointer-events', 'none');
      shimmerRing.setAttribute('opacity', '0');
      const animEl = mk('animate');
      animEl.setAttribute('attributeName', 'opacity');
      animEl.setAttribute('values', '0;0.85;0');
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

  // ── Valid move highlighting ───────────────────────────────────────────────

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

        let glowRing = this.tileEls.get(id)._glowRing;
        if (!glowRing) {
          const { cx, cy } = this._center(tile.q, tile.r);
          glowRing = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          glowRing.setAttribute('points', this._hexPoints(cx, cy, HEX_R + 5));
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

  // ── Pawn rendering ───────────────────────────────────────────────────────

  setPawnPosition(playerId, tileId, colorIndex = 0) {
    const existing = this.svg.querySelector(`[data-pawn="${CSS.escape(playerId)}"]`);
    if (existing) existing.remove();

    const entry = this.tileEls.get(tileId);
    if (!entry) return;

    const { cx, cy } = this._center(entry.tile.q, entry.tile.r);
    const palette = PAWN_PALETTE[colorIndex] || PAWN_PALETTE[0];
    const ns = 'http://www.w3.org/2000/svg';
    const mk = (tag) => document.createElementNS(ns, tag);

    const g = mk('g');
    g.setAttribute('data-pawn', playerId);
    g.setAttribute('pointer-events', 'none');

    const halo = mk('circle');
    halo.setAttribute('cx', cx);
    halo.setAttribute('cy', cy + 2);
    halo.setAttribute('r', '20');
    halo.setAttribute('fill', palette.glow);
    halo.setAttribute('opacity', '0.4');
    g.appendChild(halo);

    const body = mk('circle');
    body.setAttribute('cx', cx);
    body.setAttribute('cy', cy);
    body.setAttribute('r', '15');
    body.setAttribute('fill', palette.fill);
    body.setAttribute('stroke', palette.stroke);
    body.setAttribute('stroke-width', '2.5');
    g.appendChild(body);

    const highlight = mk('circle');
    highlight.setAttribute('cx', cx - 4);
    highlight.setAttribute('cy', cy - 4);
    highlight.setAttribute('r', '5');
    highlight.setAttribute('fill', 'rgba(255,255,255,0.28)');
    g.appendChild(highlight);

    const ring = mk('circle');
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

  // ── Flash a tile briefly ─────────────────────────────────────────────────

  flashTile(tileId, color = '#e74c3c') {
    const entry = this.tileEls.get(tileId);
    if (!entry) return;
    const { poly } = entry;
    const originalFilter = poly.style.filter;
    poly.style.filter = `brightness(2) sepia(1) hue-rotate(${color === '#e74c3c' ? '0' : '120'}deg)`;
    setTimeout(() => { poly.style.filter = originalFilter; }, 350);
  }

  // ── Scale / zoom ─────────────────────────────────────────────────────────

  setScale(s) {
    this.scale = Math.max(0.2, Math.min(4, Number(s) || 1));
    this.svg.style.width  = this.scale * 100 + '%';
    this.svg.style.height = this.scale * 100 + '%';
  }
}