# Quest for El Dorado — Web Port

## Stack
- **Server**: Node.js + Express + Socket.io
- **Client**: Vanilla JS + SVG hex board
- **Hosting**: Railway, Render, or any Node host

## Project Structure

```
el-dorado/
├── server/
│   ├── server.js              # Entry point — Express + Socket.io
│   ├── package.json
│   └── game/
│       ├── GameManager.js     # Room/session management (replaces MultiplayerService.gd server side)
│       ├── GameState.js       # Core state machine (port of Main.gd logic)
│       ├── HexBoard.js        # Hex grid math + valid move calculation
│       ├── CardMarket.js      # Shop/market logic
│       └── Player.js          # Player model
├── client/
│   ├── index.html
│   └── src/
│       ├── main.js            # Wires everything together (replaces Main.gd _ready())
│       └── game/
│           ├── GameClient.js  # Socket.io client (replaces MultiplayerService.gd client side)
│           ├── HexRenderer.js # SVG hex board renderer
│           └── CardUI.js      # Hand + market UI
└── shared/
    └── constants.js           # Terrain types, card effects, game states (replaces Globals.gd)
```

## Getting Started

```bash
cd server
npm install
npm run dev     # starts with nodemon (auto-restart on changes)
# Visit http://localhost:3000
```

## Port Checklist

### Already done (skeleton in place)
- [x] Game state machine (AWAITING_CARD → AWAITING_MOVE → TURN_END → GAME_OVER)
- [x] Valid move calculation (_calculate_valid_moves + _is_neighbor_valid_move)
- [x] Hex neighbor math (cube coordinate system)
- [x] Card effect handling (all special effects stubbed)
- [x] Purchase/market flow
- [x] Socket.io event wiring (replaces all RPC calls)
- [x] SVG hex renderer with pawn markers and move highlights
- [x] Client-side card hand + market UI

### Still TODO (bring over from your GDScript files)
- [ ] **Map data** — export your tile layout to `shared/mapData.json`
  - Each tile needs: id, col, row, block, terrainType, movementCost
  - Call `board.loadMap(mapData)` in GameManager._startGame()
- [ ] **Card data** — export all CardData to `shared/cardPool.json`
  - Each card needs: key, cardName, movementTerrain, movementTotal, purchasingPower, specialEffect, cost
  - Port from your CardData resource files
- [ ] **Starter deck** — port the initial deck composition (from Player.gd or wherever it's defined)
- [ ] **Block seam stitching** — HexBoard._findTileByColRowAcrossBlocks() needs your block adjacency logic
- [ ] **Card visuals** — add card artwork/icons to the card buttons
- [ ] **Terrain visuals** — replace the letter labels in HexRenderer with proper hex artwork

### Porting your other 24 scripts
Priority order:
1. CardData.gd → shared/cardPool.json (data) + CardData class
2. Board.gd / tile scene data → shared/mapData.json
3. Player.gd → server/game/Player.js (already stubbed, fill in deck logic)
4. CardMarket.gd → server/game/CardMarket.js (already stubbed)
5. PlayerHandUI.gd → client/src/game/CardUI.js (already stubbed)
6. Remaining UI scripts → client/src/main.js handlers

## Deploying to Railway (free tier)

1. Push to GitHub
2. Create new project at railway.app → "Deploy from GitHub repo"
3. Set start command: `cd server && npm start`
4. Done — Railway gives you a public URL

## On the Browser-Only Question

Yes, this runs in a browser. But if you ever want desktop/mobile builds:
- **Desktop**: Wrap with Electron (adds ~150MB but gives a real .exe/.app)
- **Mobile**: Wrap with Capacitor or PWA (add to home screen, works offline)
- **Steam**: Steam supports web games via the Steamworks overlay browser

For a multiplayer board game, browser is genuinely the best distribution — 
no install, share a link, play instantly.
