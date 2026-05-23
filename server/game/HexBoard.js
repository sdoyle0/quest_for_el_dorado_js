// server/game/HexBoard.js
// Axial hex coordinates (q, r) for flat-top hexes.
// Pixel center: x = 75*q,  y = 43.3*q + 86.6*r
// Six neighbors: (±1,0), (0,±1), (+1,-1), (-1,+1)

const { TerrainType, CardEffect } = require('../../shared/constants');

const AXIAL_DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]];

class HexTile {
  constructor({ id, q, r, terrainType, movementCost, playerNumber }) {
    this.id           = id;
    this.q            = q;
    this.r            = r;
    this.terrainType  = terrainType;
    this.movementCost = movementCost ?? 1;
    this.playerNumber = playerNumber ?? null;
  }
}

class HexBoard {
  constructor() {
    this.tiles    = new Map(); // id      → HexTile
    this.coordMap = new Map(); // "q,r"   → HexTile
  }

  loadMap(mapData) {
    this.tiles.clear();
    this.coordMap.clear();
    for (const d of mapData.tiles) {
      const tile = new HexTile(d);
      this.tiles.set(tile.id, tile);
      this.coordMap.set(`${tile.q},${tile.r}`, tile);
    }
    console.log(`[Board] Loaded ${this.tiles.size} tiles`);
  }

  getTile(id)       { return this.tiles.get(id) || null; }
  getAt(q, r)       { return this.coordMap.get(`${q},${r}`) || null; }

  getPlayerStartTile(playerNumber) {
    for (const t of this.tiles.values())
      if (t.terrainType === TerrainType.START && t.playerNumber === playerNumber) return t;
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
      .filter(n => this.isValidMove({ neighbor:n, playedCard, movesRemaining, wildCardTerrain, players, handSize }))
      .map(t => t.id);
  }

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
