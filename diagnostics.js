const Game = require('./game/Game');
const Deck = require('./game/Deck');

// Mock IO
const mockIo = {
    to: (roomId) => ({
        emit: (event, data) => {
            console.log(`[Event: ${event}]`, typeof data === 'object' ? JSON.stringify(data).substring(0, 100) + '...' : data);
        }
    })
};

console.log('--- Starting Diagnostics ---');

// 1. Verify Deck Composition
console.log('\n[1] Verifying Deck Composition (3 Decks)');
const deck = new Deck(3);
const totalCardsExpected = 3 * (52 + 2); // 52 standard + 2 jokers
console.log(`Expected Cards: ${totalCardsExpected}`);
console.log(`Actual Cards: ${deck.cards.length}`);

const jokers = deck.cards.filter(c => c.value === 'Joker');
console.log(`Joker Count: ${jokers.length} (Expected: 6)`);

// 2. Init Game
console.log('\n[2] Initializing Game & Dealing');
const game = new Game('room1', mockIo);
game.addPlayer({ id: 'p1', username: 'Player 1' });
game.addPlayer({ id: 'p2', username: 'Player 2' });
game.addPlayer({ id: 'p3', username: 'Player 3' });
game.addPlayer({ id: 'p4', username: 'Player 4' });

game.startRound();

const p1 = game.getPlayer('p1');
console.log(`Player 1 Hand Size: ${p1.hand.length} (Expected: 11)`);
console.log(`Discard Pile Size: ${game.discardPile.length} (Expected: 1)`);
console.log(`Remaining Deck: ${game.deck.remaining()}`);

const totalCardsInPlay = game.players.reduce((acc, p) => acc + p.hand.length, 0) + game.discardPile.length + game.deck.remaining();
console.log(`Total Inventory Check: ${totalCardsInPlay} / ${totalCardsExpected}`);

if (totalCardsInPlay !== totalCardsExpected) {
    console.error('CRITICAL: Card usage mismatch!');
} else {
    console.log('PASSED: Card inventory conserved.');
}

// 3. Simulate Gameplay
console.log('\n[3] Simulating Turns');
console.log(`Current Turn: ${game.players[game.currentTurnIndex].username}`);

// Player 1 draws
console.log('Action: P1 Draws Card');
game.drawCard('p1');
console.log(`P1 Hand after draw: ${p1.hand.length}`);

// Player 1 discards
console.log('Action: P1 Discards');
game.discardCard('p1', 0); // Discard 0th card
console.log(`P1 Hand after discard: ${p1.hand.length}`);
console.log(`Turn advanced to: ${game.players[game.currentTurnIndex].username}`);

// 4. Test Buy Logic (Player 3 buys out of turn)
console.log('\n[4] Testing Buy Logic');
const p2 = game.getPlayer('p2');
const p3 = game.getPlayer('p3');
const initialP3Size = p3.hand.length;
const initialDeckSize = game.deck.remaining();
const initialDiscardSize = game.discardPile.length;

// Ensure it is P2's turn currently
if (game.players[game.currentTurnIndex].id !== 'p2') {
    console.error('Unexpected turn index');
}

console.log('Action: P3 Buying out of turn');
// P3 buys the card P1 just discarded
game.requestBuy('p3');

console.log(`P3 Hand Size: ${p3.hand.length} (Expected: ${initialP3Size + 3}) (1 discard + 2 penalties)`);
console.log(`Deck Size: ${game.deck.remaining()} (Expected: ${initialDeckSize - 2})`);
console.log(`Discard Pile: ${game.discardPile.length} (Expected: ${initialDiscardSize - 1})`);

// 5. Check Turn Integrity
// Turn should still be P2's
console.log(`Current Turn is still: ${game.players[game.currentTurnIndex].username} (Expected: Player 2)`);

// 6. Check Dealer Rotation (Manual Inspection of Logic)
// Game.js line 43: currentTurnIndex = 0.
console.log('\n[5] Logic Check: Dealer Rotation');
console.log('Note: Game.js resets currentTurnIndex to 0 every round. This means Player 1 always starts.');

console.log('\n--- Diagnostics Complete ---');
