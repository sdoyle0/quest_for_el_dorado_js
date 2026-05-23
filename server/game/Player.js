// server/game/Player.js — mirrors Player.gd + deck management

const { buildStarterDeck } = require('../../shared/cardData');

class Player {
  constructor({ id, playerNumber, socketId, name }) {
    this.id           = id;
    this.playerNumber = playerNumber;
    this.socketId     = socketId;
    this.name         = name || `Player ${playerNumber}`;
    this.currentTileId = null;
    this.deck         = [];
    this.hand         = [];
    this.discardPile  = [];
    this.removedCards = [];  // permanently removed (Scientist / Travel Log)
  }

  init(startTileId) {
    this.currentTileId = startTileId;
    this.deck = shuffle(buildStarterDeck());
    this.hand = [];
    this.discardPile = [];
    this.drawCards(4);
  }

  drawCards(count) {
    for (let i = 0; i < count; i++) {
      if (this.deck.length === 0) {
        if (this.discardPile.length === 0) break;
        this.deck = shuffle([...this.discardPile]);
        this.discardPile = [];
      }
      this.hand.push(this.deck.pop());
    }
  }

  // Moves a card from hand to discard. Returns the card.
  discardCard(instanceId) {
    const idx = this.hand.findIndex(c => c.instanceId === instanceId);
    if (idx === -1) return null;
    const [card] = this.hand.splice(idx, 1);
    if (card.oneTimeUse) {
      this.removedCards.push(card);  // camp card — gone forever
    } else {
      this.discardPile.push(card);
    }
    return card;
  }

  // Removes a card permanently (Scientist / Travel Log effect)
  removeCardPermanently(instanceId) {
    const idx = this.hand.findIndex(c => c.instanceId === instanceId);
    if (idx === -1) return null;
    const [card] = this.hand.splice(idx, 1);
    this.removedCards.push(card);
    return card;
  }

  getHandCard(instanceId) {
    return this.hand.find(c => c.instanceId === instanceId) || null;
  }

  // Public data (safe to send to all clients — no hand contents)
  toPublicData() {
    return {
      id: this.id,
      playerNumber: this.playerNumber,
      name: this.name,
      currentTileId: this.currentTileId,
      handSize: this.hand.length,
      deckSize: this.deck.length,
      discardSize: this.discardPile.length,
    };
  }

  // Private data — send only to owning client
  toPrivateData() {
    return { ...this.toPublicData(), hand: this.hand };
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

module.exports = { Player };
