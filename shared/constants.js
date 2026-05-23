// shared/constants.js — mirrors Globals.gd
// Used by both server (Node require) and browser (<script> tag)

const TerrainType = {
  JUNGLE:    'jungle',
  WATER:     'water',
  MOUNTAIN:  'mountain',   // impassable via normal movement; requires 2-cost card
  VILLAGE:   'village',    // TODO: confirm exact mechanic — appears in BlockB, may = sand/coin terrain
  SAND:      'sand',       // yellow terrain (if used separately from village)
  CAMP:      'camp',       // ends movement; card becomes one-time-use
  RUBBLE:    'rubble',     // costs extra cards from hand equal to movementCost
  START:     'start',      // player start tile; playerNumber field identifies which player
  EL_DORADO: 'el_dorado',  // win condition
  WILD:      'wild',       // card type only — matches any terrain
};

const CardEffect = {
  NONE:         'none',
  TRANSMITTER:  'transmitter',   // free purchase worth 20 gold
  CARTOGRAPHER: 'cartographer',  // draw 2 cards
  COMPASS:      'compass',       // draw 3 cards
  SCIENTIST:    'scientist',     // draw 1, then remove 1 from hand permanently
  TRAVEL_LOG:   'travel_log',    // draw 2, then remove 2 from hand permanently
  NATIVE:       'native',        // move to any adjacent non-mountain/start tile
};

const GameState = {
  AWAITING_CARD: 'awaiting_card',
  AWAITING_MOVE: 'awaiting_move',
  TURN_END:      'turn_end',
  GAME_OVER:     'game_over',
};

const CARD_KEYS = {
  // Starter deck
  MACHETE:    'machete',    // jungle movement, cost 1 to move
  PADDLE:     'paddle',     // water movement, cost 1 to move
  COIN:       'coin',       // purchasing power only, no movement
  TRAVELER:   'traveler',   // wild movement, cost 1 to move
  // Market cards — TODO: fill in from your CardData.gd
  TRANSMITTER:'transmitter',
  CARTOGRAPHER:'cartographer',
  COMPASS:    'compass',
  SCIENTIST:  'scientist',
  TRAVEL_LOG: 'travel_log',
  NATIVE:     'native',     // the native guide card
};

const TRANSMITTER_PURCHASE_POWER = 20;

// Export for Node or attach to window for browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TerrainType, CardEffect, GameState, CARD_KEYS, TRANSMITTER_PURCHASE_POWER };
} else {
  window.ElDoradoConstants = { TerrainType, CardEffect, GameState, CARD_KEYS, TRANSMITTER_PURCHASE_POWER };
}
