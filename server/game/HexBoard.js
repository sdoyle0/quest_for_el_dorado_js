// server/game/HexBoard.js
// Hex grid for a SINGLE FLAT MAP (no block rotation/stitching needed).
//
// Coordinate system: "pointy-top, odd-row offset"
// Each tile has (col, row) from the 2D grid array in the original GDScript blocks.
// The neighbor formula accounts for the staggered offset on odd rows.
//
// Reference: https://www.redblobgames.com/grids/hexagons/#coordinates-offset

const { TerrainType, CardEffect } = require('../../shared/constants');

// Neighbor offsets for offset coordinates (pointy-top hexes, odd rows shift right)
// For EVEN rows: neighbors use these (dCol, dRow) offsets
// For ODD  rows: neighbors use a different set
const NEIGHBOR_OFFSETS = {
  even: [ [-1,-1],[0,-1],  [1,0],  [0,1], [-1,1], [-1,0] ],
  odd:  [ [ 0,-1],[1,-1],  [1,0],  [1,1],  [0,1], [-1,0] ],
};

class HexTile {
  constructor({ id, col, row, terrainType, movementCost, playerNumber }) {
    this.id           = id;
    this.col          = col;
    this.row          = row;
    this.terrainType  = terrainType;
    this.movementCost = movementCost || 1;
    this.playerNumber = playerNumber || null; // only set on START tiles (1-4)
  }

  toRpcData() {
    return { id: this.id, col: this.col, row: this.row };
  }
}

class HexBoard {
  constructor() {
    this.tiles    = new Map(); // id → HexTile
    this.colRowMap = new Map(); // "col,row" → HexTile  (fast neighbor lookup)
  }

  // Load from mapData.json  { tiles: [...] }
  loadMap(mapData) {
    this.tiles.clear();
    this.colRowMap.clear();
    for (const d of mapData.tiles) {
      const tile = new HexTile(d);
      this.tiles.set(tile.id, tile);
      this.colRowMap.set(`${tile.col},${tile.row}`, tile);
    }
    console.log(`[Board] Loaded ${this.tiles.size} tiles`);
  }

  getTile(tileId) {
    return this.tiles.get(tileId) || null;
  }

  getPlayerStartTile(playerNumber) {
    for (const tile of this.tiles.values()) {
      if (tile.terrainType === TerrainType.START && tile.playerNumber === playerNumber) {
        return tile;
      }
    }
    return null;
  }

  // Returns all 6 adjacent tiles that actually exist on the board
  // Mirrors: Board.gd get_tile_neighbors()
  getTileNeighbors(tile) {
    const offsets = (tile.row % 2 === 0) ? NEIGHBOR_OFFSETS.even : NEIGHBOR_OFFSETS.odd;
    const neighbors = [];
    for (const [dc, dr] of offsets) {
      const neighbor = this.colRowMap.get(`${tile.col + dc},${tile.row + dr}`);
      if (neighbor) neighbors.push(neighbor);
    }
    return neighbors;
  }

  // Returns tile IDs of valid destination tiles for the current move
  // Mirrors: Main.gd _calculate_valid_moves() + _is_neighbor_valid_move()
  getValidMoves({ currentTileId, playedCard, movesRemaining, wildCardTerrain, players, handSize }) {
    const currentTile = this.getTile(currentTileId);
    if (!currentTile) return [];

    return this.getTileNeighbors(currentTile)
      .filter(neighbor => this.isValidMove({
        neighbor, playedCard, movesRemaining, wildCardTerrain, players, handSize
      }))
      .map(t => t.id);
  }

  // Mirrors: Main.gd _is_neighbor_valid_move()
  isValidMove({ neighbor, playedCard, movesRemaining, wildCardTerrain, players, handSize }) {
    const terrain = neighbor.terrainType;
    const cost    = neighbor.movementCost;

    // Blocked terrain
    if (terrain === TerrainType.START)    return false;
    if (terrain === TerrainType.MOUNTAIN) return false;

    // Occupied by another pawn
    if (players.some(p => p.currentTileId === neighbor.id)) return false;

    // NATIVE: can enter any unblocked tile regardless of terrain
    if (playedCard.specialEffect === CardEffect.NATIVE) return true;

    // RUBBLE: must be first move (full moves remaining), costs extra hand cards
    if (terrain === TerrainType.RUBBLE) {
      if (movesRemaining < playedCard.movementTotal) return false;
      return handSize >= cost;
    }

    // CAMP: always enterable (movement ends, card becomes one-time-use)
    if (terrain === TerrainType.CAMP) return true;

    const enoughMoves = cost <= movesRemaining;

    // WILD card: locks onto first terrain entered, then must match
    let cardTerrain = playedCard.movementTerrain;
    if (cardTerrain === TerrainType.WILD) {
      if (wildCardTerrain === null) return enoughMoves; // not yet locked in
      cardTerrain = wildCardTerrain;
    }

    return terrain === cardTerrain && enoughMoves;
  }
}

module.exports = { HexBoard, HexTile };
