// server/game/HexBoard.js
//
// FLAT-TOP hex grid, even-column-down offset.
// BlockBase uses: x = col*75, y = row*86.6 + (col%2==0 ? 43.3 : 0)
// Confirmed flat-top by width=100, height=86.6=sqrt(3)*50
//
// Neighbor offsets (dCol, dRow) for flat-top even-col-down:
//   Even col: right neighbors at (col+1, row) and (col+1, row+1)
//   Odd  col: right neighbors at (col+1, row-1) and (col+1, row)

const { TerrainType, CardEffect } = require('../../shared/constants');

const NEIGHBOR_OFFSETS = {
  // even columns are shifted DOWN → adjacent odd-col tiles are at row and row+1
  even: [ [+1, 0], [+1, +1], [0, +1], [-1, +1], [-1, 0], [0, -1] ],
  // odd  columns are not shifted → adjacent even-col tiles are at row-1 and row
  odd:  [ [+1, -1], [+1, 0], [0, +1], [-1, 0], [-1, -1], [0, -1] ],
};

class HexTile {
  constructor({ id, col, row, terrainType, movementCost, playerNumber }) {
    this.id           = id;
    this.col          = col;
    this.row          = row;
    this.terrainType  = terrainType;
    this.movementCost = movementCost ?? 1;
    this.playerNumber = playerNumber ?? null;
  }
}

class HexBoard {
  constructor() {
    this.tiles     = new Map();   // id → HexTile
    this.coordMap  = new Map();   // "col,row" → HexTile
  }

  loadMap(mapData) {
    this.tiles.clear();
    this.coordMap.clear();
    for (const d of mapData.tiles) {
      const tile = new HexTile(d);
      this.tiles.set(tile.id, tile);
      this.coordMap.set(`${tile.col},${tile.row}`, tile);
    }
    console.log(`[Board] Loaded ${this.tiles.size} tiles`);
  }

  getTile(id)     { return this.tiles.get(id) || null; }
  getTileAt(c, r) { return this.coordMap.get(`${c},${r}`) || null; }

  getPlayerStartTile(playerNumber) {
    for (const t of this.tiles.values())
      if (t.terrainType === TerrainType.START && t.playerNumber === playerNumber) return t;
    return null;
  }

  getTileNeighbors(tile) {
    const offsets = (tile.col % 2 === 0) ? NEIGHBOR_OFFSETS.even : NEIGHBOR_OFFSETS.odd;
    return offsets
      .map(([dc, dr]) => this.getTileAt(tile.col + dc, tile.row + dr))
      .filter(Boolean);
  }

  getValidMoves({ currentTileId, playedCard, movesRemaining, wildCardTerrain, players, handSize }) {
    const tile = this.getTile(currentTileId);
    if (!tile) return [];
    return this.getTileNeighbors(tile)
      .filter(n => this.isValidMove({ neighbor: n, playedCard, movesRemaining, wildCardTerrain, players, handSize }))
      .map(t => t.id);
  }

  // Mirrors Main.gd _is_neighbor_valid_move()
  isValidMove({ neighbor, playedCard, movesRemaining, wildCardTerrain, players, handSize }) {
    const terrain = neighbor.terrainType;
    const cost    = neighbor.movementCost;

    if (terrain === TerrainType.START)    return false;
    if (terrain === TerrainType.MOUNTAIN) return false;
    if (players.some(p => p.currentTileId === neighbor.id)) return false;

    if (playedCard.specialEffect === CardEffect.NATIVE) return true;

    if (terrain === TerrainType.RUBBLE) {
      if (movesRemaining < playedCard.movementTotal) return false;
      return handSize >= cost;
    }

    if (terrain === TerrainType.CAMP) return true;

    const enoughMoves = cost <= movesRemaining;
    let cardTerrain = playedCard.movementTerrain;
    if (cardTerrain === TerrainType.WILD) {
      if (wildCardTerrain === null) return enoughMoves;
      cardTerrain = wildCardTerrain;
    }

    return terrain === cardTerrain && enoughMoves;
  }
}

module.exports = { HexBoard, HexTile };
