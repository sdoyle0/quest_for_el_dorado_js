// client/src/game/HexRenderer.js
// Renders the hex board as SVG — FLAT-TOP hexes, even columns shifted down.
// Matches BlockBase.gd pixel math:
//   x = col * (width * 0.75)  = col * 75
//   y = row * height + (col%2==0 ? height/2 : 0)  (even cols shifted DOWN)
//   width=100, height=86.6

const HEX_W  = 100;          // flat-top hex: full width (tip to tip)
const HEX_H  = 86.6;         // flat-top hex: full height (flat to flat) = sqrt(3)*50
const COL_STEP = HEX_W * 0.75; // horizontal spacing between column centers = 75

const TERRAIN_STYLE = {
  jungle:   { fill: '#1a6b1a', label: '🌿' },
  water:    { fill: '#1a5fa8', label: '🌊' },
  village:  { fill: '#c8a000', label: '🏘' },
  mountain: { fill: '#6b5b4e', label: '⛰' },
  camp:     { fill: '#7a3e1a', label: '🏕' },
  rubble:   { fill: '#888',    label: '💀' },
  start:    { fill: '#3a7abf', label: '🏳' },
  el_dorado:{ fill: '#ffd700', label: '✦' },
  empty:    { fill: '#333',    label: '?' },
};

class HexRenderer {
  constructor(svgEl) {
    this.svg       = svgEl;
    this.tileEls   = new Map();  // tileId → { g, polygon }
    this.onTileClick = null;     // callback(tileId)
  }

  // Call this on game_started with the full tile array from the server
  render(tiles) {
    this.svg.innerHTML = '';
    this.tileEls.clear();

    let minX =  Infinity, minY =  Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const tile of tiles) {
      const { cx, cy } = this._tileCenter(tile.col, tile.row);
      minX = Math.min(minX, cx - HEX_W / 2);
      minY = Math.min(minY, cy - HEX_H / 2);
      maxX = Math.max(maxX, cx + HEX_W / 2);
      maxY = Math.max(maxY, cy + HEX_H / 2);
    }

    const pad = 20;
    this.svg.setAttribute('viewBox',
      `${minX-pad} ${minY-pad} ${maxX-minX+pad*2} ${maxY-minY+pad*2}`);
    this.svg.style.width  = '100%';
    this.svg.style.height = '100%';

    for (const tile of tiles) this._renderTile(tile);
  }

  _tileCenter(col, row) {
    const cx = col * COL_STEP;
    const cy = row * HEX_H + (col % 2 === 0 ? HEX_H / 2 : 0);
    return { cx, cy };
  }

  _hexPoints(cx, cy) {
    // Flat-top hex: 6 corners, first corner at 0° (right)
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 180 * (60 * i);
      pts.push(`${cx + (HEX_W/2) * Math.cos(angle)},${cy + (HEX_H/2) * Math.sin(angle)}`);
    }
    return pts.join(' ');
  }

  _renderTile(tile) {
    const { cx, cy }    = this._tileCenter(tile.col, tile.row);
    const style         = TERRAIN_STYLE[tile.terrainType] || TERRAIN_STYLE.empty;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-tile-id', tile.id);
    g.style.cursor = 'pointer';

    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', this._hexPoints(cx, cy));
    poly.setAttribute('fill', style.fill);
    poly.setAttribute('stroke', '#111');
    poly.setAttribute('stroke-width', '2');

    // Terrain icon
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    icon.setAttribute('x', cx);
    icon.setAttribute('y', cy + 2);
    icon.setAttribute('text-anchor', 'middle');
    icon.setAttribute('dominant-baseline', 'middle');
    icon.setAttribute('font-size', '18');
    icon.setAttribute('pointer-events', 'none');
    icon.textContent = style.label;

    // Movement cost badge (for cost > 1)
    if (tile.movementCost > 1 && tile.terrainType !== 'mountain') {
      const badge = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      badge.setAttribute('x', cx + 24);
      badge.setAttribute('y', cy - 20);
      badge.setAttribute('text-anchor', 'middle');
      badge.setAttribute('font-size', '11');
      badge.setAttribute('fill', '#fff');
      badge.setAttribute('pointer-events', 'none');
      badge.textContent = `×${tile.movementCost}`;
      g.appendChild(badge);
    }

    g.appendChild(poly);
    g.appendChild(icon);
    g.addEventListener('click', () => this.onTileClick?.(tile.id));

    this.svg.appendChild(g);
    this.tileEls.set(tile.id, { g, poly, tile });
  }

  // Highlight valid move tiles in yellow
  setValidMoves(tileIds) {
    for (const [id, { poly }] of this.tileEls) {
      const valid = tileIds.includes(id);
      poly.setAttribute('stroke', valid ? '#ffff00' : '#111');
      poly.setAttribute('stroke-width', valid ? '4' : '2');
      poly.style.filter = valid ? 'brightness(1.4)' : '';
    }
  }

  clearHighlights() { this.setValidMoves([]); }

  // Place/move a pawn circle on a tile
  setPawnPosition(playerId, tileId, color = '#e74c3c') {
    const existing = this.svg.querySelector(`[data-pawn="${CSS.escape(playerId)}"]`);
    if (existing) existing.remove();

    const entry = this.tileEls.get(tileId);
    if (!entry) return;

    const { cx, cy } = this._tileCenter(entry.tile.col, entry.tile.row);
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy - 6);
    circle.setAttribute('r', '14');
    circle.setAttribute('fill', color);
    circle.setAttribute('stroke', '#fff');
    circle.setAttribute('stroke-width', '2.5');
    circle.setAttribute('pointer-events', 'none');
    circle.setAttribute('data-pawn', playerId);
    this.svg.appendChild(circle);
  }
}
