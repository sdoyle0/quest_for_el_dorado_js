const _ElDoradoBoardDeps = (typeof module !== 'undefined' && module.exports)
  ? require('./constants')
  : window.ElDoradoConstants;

const AXIAL_DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]];

class HexTile {
  constructor({ id, q, r, terrainType, movementCost, playerNumber, isFinishing }) {
    this.id = id;
    this.q = q;
    this.r = r;
    this.terrainType = terrainType;
    this.movementCost = movementCost ?? 1;
    this.isFinishing = isFinishing ?? false;
    this.playerNumber = playerNumber ?? null;
  }
}

class HexBoard {
  constructor() {
    this.tiles = new Map();
    this.coordMap = new Map();
  }

  loadMap(mapData) {
    this.tiles.clear();
    this.coordMap.clear();
    for (const d of mapData.tiles) {
      const tile = new HexTile(d);
      this.tiles.set(tile.id, tile);
      this.coordMap.set(`${tile.q},${tile.r}`, tile);
    }
  }

  getTile(id) {
    return this.tiles.get(id) || null;
  }

  getAt(q, r) {
    return this.coordMap.get(`${q},${r}`) || null;
  }

  getPlayerStartTile(playerNumber) {
    for (const tile of this.tiles.values()) {
      if (tile.terrainType === _ElDoradoBoardDeps.TerrainType.START && tile.playerNumber === playerNumber) {
        return tile;
      }
    }
    return null;
  }

  getTileNeighbors(tile) {
    return AXIAL_DIRS
      .map(([dq, dr]) => this.getAt(tile.q + dq, tile.r + dr))
      .filter(Boolean);
  }

  getValidMoves({ currentTileId, playedCard, movesRemaining, wildCardTerrain, players, handSize }) {
    const tile = this.getTile(currentTileId);
    if (!tile) return [];

    return this.getTileNeighbors(tile)
      .filter((neighbor) => this.isValidMove({ neighbor, playedCard, movesRemaining, wildCardTerrain, players, handSize }))
      .map((neighbor) => neighbor.id);
  }

  isValidMove({ neighbor, playedCard, movesRemaining, wildCardTerrain, players, handSize }) {
    const terrain = neighbor.terrainType;
    const cost = neighbor.movementCost;
 
    if (terrain === _ElDoradoBoardDeps.TerrainType.START)     return false;
    if (terrain === _ElDoradoBoardDeps.TerrainType.MOUNTAIN)  return false;
    if (terrain === _ElDoradoBoardDeps.TerrainType.EL_DORADO) return false; // decorative — impassable
    if (players.some((p) => p.currentTileId === neighbor.id)) return false;
 
    if (playedCard.specialEffect === _ElDoradoBoardDeps.CardEffect.NATIVE) return true;
 
    if (terrain === _ElDoradoBoardDeps.TerrainType.RUBBLE) {
      if (movesRemaining < playedCard.movementTotal) return false;
      return handSize >= cost;
    }
 
    if (terrain === _ElDoradoBoardDeps.TerrainType.CAMP) return true;
 
    const enoughMoves = cost <= movesRemaining;
    let cardTerrain = playedCard.movementTerrain;
    if (cardTerrain === _ElDoradoBoardDeps.TerrainType.WILD) {
      if (wildCardTerrain === null) return enoughMoves;
      cardTerrain = wildCardTerrain;
    }
 
    return terrain === cardTerrain && enoughMoves;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HexBoard, HexTile };
} else {
  window.ElDoradoHexBoard = { HexBoard, HexTile };
}
