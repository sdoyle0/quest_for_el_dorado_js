// client/src/game/HexRenderer.js
// Renders the hex board as SVG using axial coordinates.
// Flat-top hex pixel formula (matches BlockBase.gd exactly):
//   cx = 75 * q
//   cy = 43.3 * q + 86.6 * r
//
// Hex corner formula (flat-top, 6 corners at 0°, 60°, 120°, ...):
//   corner_x = cx + 50 * cos(i * 60°)
//   corner_y = cy + 50 * sin(i * 60°)   [50 = hex radius = width/2]

const HEX_R  = 50;    // hex radius (center to corner)
const W_STEP = 75;    // horizontal spacing = cos(30°) * 2 * r * (3/4)... = 75
const H_STEP = 86.6;  // vertical spacing
const H_HALF = 43.3;

const TERRAIN_STYLE = {
  jungle:   { fill:'#1e5e1e', stroke:'#143d14', label:'🌿'  },
  water:    { fill:'#1a5fa8', stroke:'#0e3d6e', label:'🌊'  },
  village:  { fill:'#c8a000', stroke:'#8a6e00', label:'🏘'  },
  mountain: { fill:'#251e17', stroke:'#18100c', label:'⛰', textColor: '#a2e5ff'  },
  camp:     { fill:'#c57466', stroke:'#b84c39', label:'🚫'  },
  rubble:   { fill:'#6b6b6b', stroke:'#444',    label:'🪨'  },
  start:    { fill:'#2a5fa8', stroke:'#1a3d6e', label:'🏳'  },
  el_dorado:{ fill:'#19755a', stroke:'#29a17d', label:'🏆'  },
};

class HexRenderer {
  constructor(svgEl) {
    this.svg      = svgEl;
    this.tileEls  = new Map(); // tileId → { g, poly, tile }
    this.onTileClick = null;
  }

  render(tiles) {
    this.svg.innerHTML = '';
    this.tileEls.clear();
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

    const pad = 30;
    this.svg.setAttribute('viewBox',
      `${minX-pad} ${minY-pad} ${maxX-minX+pad*2} ${maxY-minY+pad*2}`);

    // Sort so el_dorado tiles render on top
    const sorted = [...tiles].sort((a, b) =>
      (a.terrainType === 'el_dorado' ? 1 : 0) - (b.terrainType === 'el_dorado' ? 1 : 0));

    for (const tile of sorted) this._renderTile(tile);
  }

  _center(q, r) {
    return { cx: W_STEP * q, cy: H_HALF * q + H_STEP * r };
  }

  _hexPoints(cx, cy) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i);
      pts.push(`${(cx + HEX_R * Math.cos(a)).toFixed(1)},${(cy + HEX_R * Math.sin(a)).toFixed(1)}`);
    }
    return pts.join(' ');
  }

  _renderTile(tile) {
    const { cx, cy } = this._center(tile.q, tile.r);
    const style = TERRAIN_STYLE[tile.terrainType] || { fill:'#555', stroke:'#333', label:'?' };

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-tile-id', tile.id);
    g.style.cursor = 'pointer';

    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', this._hexPoints(cx, cy));
    poly.setAttribute('fill', style.fill);
    poly.setAttribute('stroke', style.stroke);
    poly.setAttribute('stroke-width', '2');
    poly.style.transition = 'filter 0.1s';
    g.appendChild(poly);
    

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    icon.setAttribute('x', cx);
    icon.setAttribute('y', cy + 2);
    icon.setAttribute('text-anchor', 'middle');
    icon.setAttribute('dominant-baseline', 'middle');
    icon.setAttribute('font-size', '18');
    icon.setAttribute('pointer-events', 'none');
    if (style.textColor) icon.setAttribute('fill', style.textColor);
    icon.textContent = style.label;

    g.appendChild(icon);

    // Cost badge for multi-move tiles
    if (tile.movementCost > 1 && tile.terrainType !== 'mountain') {
      const badge = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      icon.setAttribute('y', cy - 5);
      badge.setAttribute('x', cx);
      badge.setAttribute('y', cy + 24);
      badge.setAttribute('text-anchor', 'middle');
      badge.setAttribute('font-size', '24');
      badge.setAttribute('fill', '#fff');
      badge.setAttribute('font-weight', 'bold');
      badge.setAttribute('pointer-events', 'none');
      badge.textContent = `×${tile.movementCost}`;
      g.appendChild(badge);
    }
    
    g.addEventListener('click', () => this.onTileClick?.(tile.id));

    this.svg.appendChild(g);
    this.tileEls.set(tile.id, { g, poly, tile });
  }

  setValidMoves(tileIds) {
    const set = new Set(tileIds);
    for (const [id, { poly }] of this.tileEls) {
      const valid = set.has(id);
      poly.setAttribute('stroke', valid ? '#ffff00' : TERRAIN_STYLE[this.tileEls.get(id)?.tile?.terrainType]?.stroke || '#333');
      poly.setAttribute('stroke-width', valid ? '4' : '2');
      poly.style.filter = valid ? 'brightness(1.5)' : '';
    }
  }

  clearHighlights() { this.setValidMoves([]); }

  setPawnPosition(playerId, tileId, color = '#e74c3c') {
    const existing = this.svg.querySelector(`[data-pawn="${CSS.escape(playerId)}"]`);
    if (existing) existing.remove();

    const entry = this.tileEls.get(tileId);
    if (!entry) return;
    const { cx, cy } = this._center(entry.tile.q, entry.tile.r);

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', '16');
    circle.setAttribute('fill', color);
    circle.setAttribute('stroke', '#fff');
    circle.setAttribute('stroke-width', '3');
    circle.setAttribute('pointer-events', 'none');
    circle.setAttribute('data-pawn', playerId);
    this.svg.appendChild(circle);
  }

  setScale(s) {
    const clamped = Math.max(0.2, Math.min(4, Number(s) || 1));
    this.scale = clamped;
    if (this._lastExtents) {
      this.svg.style.width = (this._lastExtents.w * this.scale) + 'px';
      this.svg.style.height = (this._lastExtents.h * this.scale) + 'px';
    }
  }
}
