class Card {
    constructor(suit, value) {
        this.suit = suit;
        this.value = value;
    }

    getScore() {
        if (this.value === 'Joker') return 50;
        if (this.value === 'A') return 15;
        if (['10', 'J', 'Q', 'K'].includes(this.value)) return 10;
        return 5; // 2-9
    }
}

module.exports = Card;
