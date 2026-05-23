// client/src/game/HexRenderer.js
// Renders the hex board as an SVG.
// Mirrors: the visual parts of res://scenes/Board.tscn + ElDoradoTile.gd
//
// Uses pointy-top hexes. Reference: https://www.redblobgames.com/grids/hexagons/

const HEX_SIZE = 40; // pixel radius of each hex — adjust to taste

// Terrain color map — customize to match your art direction
const TERRAIN_COLORS = {
  jungle:    '#2d6a2d',
  water:     '#1a6fa8',
  mountain:  '#7a6652',
  sand:      '#c8a84b',
  camp:      '#8b4513',
  rubble:    '#888888',
  start:     '#4a90d9',
  el_dorado: '#ffd700',
  wild:      '#9b59b6',
};

const TERRAIN_LABELS = {
  jungle:    'J',
  water:     'W',
  mountain:  'M',
  sand:      'S',
  camp:      'C',
  rubble:    'R',
  start:     '★',
  el_dorado: '✦',
};

class HexRenderer {
  constructor(svgEl) {
    this.svg = svgEl;
    this.tiles = new Map();       // tileId → SVG group element
    this.onTileClick = null;      // callback(tileId)
  }

  // Render all tiles from the board data array
  // tiles: [{ id, col, row, terrainType, movementCost }, ...]
  render(tiles) {
    this.svg.innerHTML = '';
    this.tiles.clear();

    // Calculate bounds to set viewBox
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const tile of tiles) {
      const { x, y } = this._hexToPixel(tile.col, tile.row);
      minX = Math.min(minX, x - HEX_SIZE);
      minY = Math.min(minY, y - HEX_SIZE);
      maxX = Math.max(maxX, x + HEX_SIZE);
      maxY = Math.max(maxY, y + HEX_SIZE);
    }

    const padding = HEX_SIZE;
    this.svg.setAttribute('viewBox',
      `${minX - padding} ${minY - padding} ${maxX - minX + padding * 2} ${maxY - minY + padding * 2}`
    );

    for (const tile of tiles) {
      this._renderTile(tile);
    }
  }

  _renderTile(tile) {
    const { x, y } = this._hexToPixel(tile.col, tile.row);
    const color = TERRAIN_COLORS[tile.terrainType] || '#cccccc';
    const label = TERRAIN_LABELS[tile.terrainType] || '?';

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-tile-id', tile.id);
    g.style.cursor = 'pointer';

    // Hex polygon
    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    polygon.setAttribute('points', this._hexPoints(x, y).join(' '));
    polygon.setAttribute('fill', color);
    polygon.setAttribute('stroke', '#1a1a1a');
    polygon.setAttribute('stroke-width', '1.5');

    // Terrain label
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', x);
    text.setAttribute('y', y + 5);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '14');
    text.setAttribute('fill', '#fff');
    text.setAttribute('pointer-events', 'none');
    text.textContent = label;

    g.appendChild(polygon);
    g.appendChild(text);

    g.addEventListener('click', () => this.onTileClick?.(tile.id));

    this.svg.appendChild(g);
    this.tiles.set(tile.id, { el: g, polygon, tile });
  }

  // Highlight valid move tiles
  setValidMoves(tileIds) {
    for (const [id, { polygon }] of this.tiles) {
      if (tileIds.includes(id)) {
        polygon.setAttribute('stroke', '#ffff00');
        polygon.setAttribute('stroke-width', '3');
        polygon.setAttribute('filter', 'brightness(1.3)');
      } else {
        polygon.setAttribute('stroke', '#1a1a1a');
        polygon.setAttribute('stroke-width', '1.5');
        polygon.removeAttribute('filter');
      }
    }
  }

  clearHighlights() {
    this.setValidMoves([]);
  }

  // Place or move a pawn marker
  setPawnPosition(playerId, tileId, color = '#ff4444') {
    // Remove existing pawn for this player
    const existing = this.svg.querySelector(`[data-pawn="${playerId}"]`);
    if (existing) existing.remove();

    const tileEntry = this.tiles.get(tileId);
    if (!tileEntry) return;

    const { x, y } = this._hexToPixel(tileEntry.tile.col, tileEntry.tile.row);

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y - 8);
    circle.setAttribute('r', '10');
    circle.setAttribute('fill', color);
    circle.setAttribute('stroke', '#fff');
    circle.setAttribute('stroke-width', '2');
    circle.setAttribute('pointer-events', 'none');
    circle.setAttribute('data-pawn', playerId);

    this.svg.appendChild(circle);
  }

  // --- Hex math ---

  // Pointy-top hex → pixel center
  _hexToPixel(col, row) {
    const x = HEX_SIZE * Math.sqrt(3) * (col + 0.5 * (row & 1));
    const y = HEX_SIZE * 1.5 * row;
    return { x, y };
  }

  // 6 corner points for a pointy-top hex centered at (cx, cy)
  _hexPoints(cx, cy) {
    const points = [];
    for (let i = 0; i < 6; i++) {
      const angleDeg = 60 * i - 30; // pointy-top: start at -30°
      const angleRad = Math.PI / 180 * angleDeg;
      points.push(`${cx + HEX_SIZE * Math.cos(angleRad)},${cy + HEX_SIZE * Math.sin(angleRad)}`);
    }
    return points;
  }
}
