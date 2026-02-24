const Card = require('./Card');

class Deck {
    constructor(numDecks = 3) {
        this.cards = [];
        this.numDecks = numDecks;
        this.suits = ['Hearts', 'Diamonds', 'Clubs', 'Spades'];
        this.values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
        this.init();
    }

    init() {
        this.cards = [];
        for (let i = 0; i < this.numDecks; i++) {
            for (const suit of this.suits) {
                for (const value of this.values) {
                    this.cards.push(new Card(suit, value));
                }
            }
            // Add 2 Jokers per deck
            this.cards.push(new Card('None', 'Joker'));
            this.cards.push(new Card('None', 'Joker'));
        }
    }

    shuffle() {
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
        }
    }

    draw() {
        return this.cards.pop();
    }

    remaining() {
        return this.cards.length;
    }
}

module.exports = Deck;
