const Deck = require('./Deck');

class Game {
    constructor(roomId, io, roundNumber = 1) {
        this.roomId = roomId;
        this.io = io;
        this.players = [];
        this.deck = null;
        this.discardPile = [];
        this.currentTurnIndex = 0;
        this.dealerIndex = -1; // Track dealer
        this.round = roundNumber;
        this.gameStatus = 'waiting';

        // Buy Logic
        this.buys = {}; // { playerId: count }
        this.melds = {}; // Player melds on table
        this.pendingBuy = null; // Track who wants to buy { playerId, timestamp }
        this.onRoundEnd = null; // Callback for server

        this.rounds = [
            { id: 1, contract: '2 Sets', sets: 2, runs: 0 },
            { id: 2, contract: '1 Set, 1 Run', sets: 1, runs: 1 },
            { id: 3, contract: '2 Runs', sets: 0, runs: 2 },
            { id: 4, contract: '3 Sets', sets: 3, runs: 0 },
            { id: 5, contract: '2 Sets, 1 Run', sets: 2, runs: 1 },
            { id: 6, contract: '1 Set, 2 Runs', sets: 1, runs: 2 },
            { id: 7, contract: '3 Runs', sets: 0, runs: 3 }
        ];
    }

    addPlayer(player) {
        this.players.push(player);
        this.buys[player.id] = 2; // 2 buys per round
    }

    startRound() {
        if (this.round > this.rounds.length) {
            this.endGame();
            return;
        }

        this.deck = new Deck(3);
        this.deck.shuffle();
        this.discardPile = [this.deck.draw()];

        // Rotate Dealer
        if (this.dealerIndex === -1) {
            // First round: Pick random dealer
            this.dealerIndex = Math.floor(Math.random() * this.players.length);
        } else {
            // Subsequent rounds: Rotate clockwise
            this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
        }

        this.currentTurnIndex = (this.dealerIndex + 1) % this.players.length; // Player after dealer starts

        this.turnStatus = 'awaiting_draw'; // 'awaiting_draw' or 'playing'
        this.gameStatus = 'active';

        // Reset Round State
        this.players.forEach(p => {
            p.hand = [];
            p.melds = [];
            p.down = false;
            this.buys[p.id] = 2; // Reset buys
            for (let i = 0; i < 11; i++) {
                p.hand.push(this.deck.draw());
            }
        });

        this.broadcastState();
    }

    // --- Actions ---

    drawCard(playerId) {
        if (!this.isCurrentTurn(playerId)) return;
        if (this.turnStatus !== 'awaiting_draw') return;

        // BLOCK Actions if Buy Pending
        if (this.pendingBuy) {
            // Player MUST resolve the buy request first (Yes/No)
            // Send reminder?
            return;
        }

        const player = this.getPlayer(playerId);
        const card = this.deck.draw();

        if (!card) {
            return;
        }

        player.hand.push(card);
        this.turnStatus = 'playing';

        // Animation Event
        this.io.to(this.roomId).emit('animateAction', { type: 'draw', playerId });

        this.broadcastState();
    }

    drawDiscard(playerId) {
        if (!this.isCurrentTurn(playerId)) return;
        if (this.turnStatus !== 'awaiting_draw') return;
        if (this.discardPile.length === 0) return;

        // BLOCK Actions if Buy Pending
        // Actually, if I draw discard, does that implicitly "Deny" the buy?
        // User said: "saying no means you have to pick up the card... and not from the deck"
        // So clicking "Discard" (Draw Discard) is effectively saying No.
        // So we can ALLOW this, and it implicitly clears pendingBuy.

        if (this.pendingBuy) {
            this.pendingBuy = null; // Implicit denial accepted
        }

        const player = this.getPlayer(playerId);
        const card = this.discardPile.pop();
        player.hand.push(card);

        this.turnStatus = 'playing';

        // Animation Event
        this.io.to(this.roomId).emit('animateAction', { type: 'drawDiscard', playerId, card });

        this.broadcastState();
    }

    // Separated Buy Execution
    requestBuy(playerId) {
        if (this.gameStatus === 'game_end') return;
        // Logic: Can only buy if NOT my turn
        if (this.isCurrentTurn(playerId)) return;

        // CASE 1: Instant Buy (Post-Draw)
        // If current player has already drawn ('playing' phase), the discard is "open" 
        // because the current player implicitly declined it by drawing from the deck.
        if (this.turnStatus === 'playing') {
            // Validate if discard pile has cards
            if (this.discardPile.length === 0) return;

            // Immediate Buy
            this.executeBuy(playerId);
            return;
        }

        // CASE 2: Priority Buy (Pre-Draw)
        if (this.turnStatus !== 'awaiting_draw') return;

        // Prevent multiple pending buys for now
        if (this.pendingBuy) return;

        const player = this.getPlayer(playerId);
        if (this.buys[playerId] <= 0) return; // No buys left

        // Store pending buy
        this.pendingBuy = playerId;

        // Notify Current Player
        const currentTurnPlayer = this.getPlayer(this.players[this.currentTurnIndex].id);
        const socket = this.io.sockets.sockets.get(currentTurnPlayer.id);
        if (socket) {
            socket.emit('buyRequest', {
                requesterName: player.username,
                card: this.discardPile[this.discardPile.length - 1]
            });
        }

        // Notify others
        this.io.to(this.roomId).emit('message', `${player.username} wants to buy the discard! Waiting for ${currentTurnPlayer.username}...`);

        // Broadcast state to lock buttons for everyone else
        this.broadcastState();
    }

    resolveBuyRequest(playerId, allowed) {
        // Must be current turn player
        if (!this.isCurrentTurn(playerId)) return;
        if (!this.pendingBuy) return;

        const buyerId = this.pendingBuy;
        this.pendingBuy = null; // Clear it

        if (allowed) {
            // Player allowed the buy.
            // Buyer gets card + penalties
            this.executeBuy(buyerId);

            // Current player's turn continues. 
            // They MUST draw from deck now (since discard is gone/taken).
            // We don't auto-draw for them, we let them click "Draw Deck".
            // But they CANNOT draw discard anymore.
        } else {
            // Player DENIED the buy.
            // Player MUST take the discard.
            this.drawDiscard(playerId);
        }
    }
    // Separated Buy Execution
    executeBuy(playerId) {
        const player = this.getPlayer(playerId);
        if (!player) return;
        if (this.buys[playerId] <= 0) return;
        if (this.discardPile.length === 0) return;

        const card = this.discardPile.pop();
        // Penalty cards
        const penalty1 = this.deck.draw();
        const penalty2 = this.deck.draw();

        if (card && penalty1 && penalty2) {
            player.hand.push(card, penalty1, penalty2);
            this.buys[playerId]--;

            // Explicitly clear pendingBuy to unlock UI (if it wasn't already cleared by resolveBuyRequest)
            // This covers the "Open Buy" case where resolveBuyRequest wasn't called.
            this.pendingBuy = null;

            // Animation Event (Complex)
            this.io.to(this.roomId).emit('animateAction', { type: 'buy', playerId, card });

            this.broadcastState();
        } else {
            // Not enough cards or error
            if (card) this.discardPile.push(card); // Put it back if failed
        }
    }

    discardCard(playerId, cardIndex) {
        if (!this.isCurrentTurn(playerId)) return;
        if (this.turnStatus !== 'playing') return; // Must draw first

        const player = this.getPlayer(playerId);
        const card = player.hand.splice(cardIndex, 1)[0];
        this.discardPile.push(card);

        // Animation Event
        this.io.to(this.roomId).emit('animateAction', { type: 'discard', playerId, card });

        // End Turn
        // Check for round end? (Player has 0 cards?)
        if (player.hand.length === 0) {
            // Winner!
            this.endRound(playerId);
            return;
        }

        this.currentTurnIndex = (this.currentTurnIndex + 1) % this.players.length;
        this.turnStatus = 'awaiting_draw'; // Next player starts in draw phase
        this.broadcastState();
    }

    meld(playerId, meldGroups) {
        if (!this.isCurrentTurn(playerId)) return;
        if (this.turnStatus !== 'playing') return;

        const player = this.getPlayer(playerId);

        // Convert indices to cards
        const proposedMelds = meldGroups.map(group => group.map(i => player.hand[i]));

        // Validate against Contract
        if (!this.validateMeld(proposedMelds, this.rounds[this.round - 1])) {
            const socket = this.io.sockets.sockets.get(playerId);
            if (socket) socket.emit('error', 'Invalid Meld! Does not match contract.');
            return;
        }

        // Remove cards from hand
        // Indices were safer. Let's use indices but sort them descending to splice safely.
        const allIndices = meldGroups.flat().sort((a, b) => b - a);
        allIndices.forEach(idx => {
            player.hand.splice(idx, 1);
        });

        // Store Melds
        player.melds.push(...proposedMelds);

        // Check if went down
        if (!player.down) {
            player.down = true;
            this.io.to(this.roomId).emit('message', `${player.username} melded and is DOWN!`);
        } else {
            this.io.to(this.roomId).emit('message', `${player.username} added to melds.`);
        }

        this.broadcastState();
    }

    validateMeld(melds, contract) {
        // Round Requirements
        const roundReqs = [
            { sets: 2, runs: 0, setSize: 3, runSize: 0 }, // R1
            { sets: 1, runs: 1, setSize: 3, runSize: 4 }, // R2
            { sets: 0, runs: 2, setSize: 0, runSize: 4 }, // R3
            { sets: 3, runs: 0, setSize: 3, runSize: 0 }, // R4
            { sets: 2, runs: 1, setSize: 3, runSize: 4 }, // R5
            { sets: 1, runs: 2, setSize: 3, runSize: 4 }, // R6
            { sets: 0, runs: 3, setSize: 0, runSize: 4 }  // R7
        ];

        const req = roundReqs[this.round - 1];
        if (!req) return true; // Fallback

        let neededSets = req.sets;
        let neededRuns = req.runs;

        // Greedy matching: Try to assign groups to requirements
        for (const group of melds) {
            const canBeSet = this.isSet(group, req.setSize);
            const canBeRun = this.isRun(group, req.runSize);

            // Prioritize what we need
            // If we need Sets and it's a Set, take it.
            // If we need Runs and it's a Run, take it.
            // Ambiguity: A group might be BOTH (e.g. 3 Jokers).
            // Usually we prioritize the harder one? Or just greedy.

            if (neededSets > 0 && canBeSet) {
                neededSets--;
            } else if (neededRuns > 0 && canBeRun) {
                neededRuns--;
            } else if (canBeSet) {
                // Extra set allowed
            } else if (canBeRun) {
                // Extra run allowed
            } else {
                return false; // Group is neither valid Set nor Run
            }
        }

        return neededSets <= 0 && neededRuns <= 0;
    }

    isJoker(card) {
        return card.value === 'Joker' || card.value === '2';
    }

    isSet(cards, minSize) {
        if (cards.length < minSize) return false;
        const reference = cards.find(c => !this.isJoker(c));
        if (!reference) return true;
        return cards.every(c => this.isJoker(c) || c.value === reference.value);
    }

    isRun(cards, minSize) {
        if (cards.length < minSize) return false;
        const reference = cards.find(c => !this.isJoker(c));
        if (!reference) return true;

        const suit = reference.suit;
        if (cards.some(c => !this.isJoker(c) && c.suit !== suit)) return false;

        const getVal = (c) => {
            if (this.isJoker(c)) return -1;
            const map = { '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14, '2': 2 };
            return map[c.value] || 0;
        };

        const naturals = cards.filter(c => !this.isJoker(c)).map(c => getVal(c)).sort((a, b) => a - b);
        const wildCount = cards.length - naturals.length;

        if (naturals.length === 0) return true;

        if (new Set(naturals).size !== naturals.length) return false;

        let neededWilds = 0;
        for (let i = 0; i < naturals.length - 1; i++) {
            const gap = naturals[i + 1] - naturals[i] - 1;
            if (gap < 0) return false;
            neededWilds += gap;
        }

        return wildCount >= neededWilds;
    }


    reorderHand(playerId, newHand) {
        const player = this.getPlayer(playerId);
        if (!player) return;

        // Validation: Ensure newHand contains exact same cards as player.hand
        // Since we have multiple decks, duplicates are possible. Use frequency map.
        if (newHand.length !== player.hand.length) return;

        const countCards = (hand) => {
            const counts = {};
            hand.forEach(c => {
                const key = `${c.suit}-${c.value}`;
                counts[key] = (counts[key] || 0) + 1;
            });
            return counts;
        };

        const currentCounts = countCards(player.hand);
        const newCounts = countCards(newHand);

        // Compare maps
        for (const key in currentCounts) {
            if (currentCounts[key] !== newCounts[key]) {
                console.log(`Cheating attempt or desync? Player ${player.username} tried to modify hand.`);
                return;
            }
        }

        // If valid, update hand order
        player.hand = newHand;

        // We do NOT strictly need to broadcast everyone else's state just for one player's hand reorder,
        // BUT for consistency and simple state management, we will.
        // Optimization: Emit only to the specific player? 
        // Current architecture relies on 'gameState' broadcast.
        this.broadcastState();
    }

    // --- Helpers ---

    isCurrentTurn(playerId) {
        return this.players[this.currentTurnIndex].id === playerId;
    }

    getPlayer(playerId) {
        return this.players.find(p => p.id === playerId);
    }

    resolveBuyRequest(winnerId) {
        // Logic to handle multiple buy requests if we added a timer
    }

    endRound(winnerId) {
        this.gameStatus = 'game_end';
        // Calculate scores
        this.players.forEach(p => {
            // Simple scoring: 1 point per card? Or rank based?
            // Rules: Aces 15, Face 10, Others 5, Joker 50.
            let roundScore = 0;
            p.hand.forEach(c => {
                if (c.value === 'Joker') roundScore += 50;
                else if (c.value === 'A') roundScore += 15;
                else if (['K', 'Q', 'J', '10'].includes(c.value)) roundScore += 10;
                else roundScore += 5;
            });
            p.score += roundScore;
        });

        const winner = this.getPlayer(winnerId);
        this.io.to(this.roomId).emit('message', `${winner.username} went out! Round over.`);
        this.io.to(this.roomId).emit('gameEnd', {
            scores: this.players.map(p => ({
                username: p.username,
                score: p.score
            }))
        });

        if (this.onRoundEnd) this.onRoundEnd();
    }

    broadcastState() {
        this.players.forEach(player => {
            const personalizedState = {
                round: this.round,
                contract: this.rounds[this.round - 1],
                discardTop: this.discardPile[this.discardPile.length - 1],
                players: this.players.map(p => ({
                    id: p.id,
                    username: p.username,
                    handCount: p.hand.length,
                    melds: p.melds,
                    down: p.down,
                    score: p.score,
                    buys: this.buys[p.id],
                    // See Opponents cards if round end?
                    hand: (this.gameStatus === 'game_end') ? p.hand : undefined
                })),
                currentTurn: this.players[this.currentTurnIndex].id,
                turnStatus: this.turnStatus,
                deckCount: this.deck.remaining(),
                // My Private State
                myHand: player.hand,
                // Buy Lock State
                pendingBuy: !!this.pendingBuy // Boolean for client logic
            };

            // Check if socket exists (player might have disconnected but preserved in object?)
            const socket = this.io.sockets.sockets.get(player.id);
            if (socket) {
                socket.emit('gameState', personalizedState);
            }
        });
    }

    endGame() {
        this.gameStatus = 'game_end';
        this.io.to(this.roomId).emit('gameEnd', { scores: this.players });
        if (this.onRoundEnd) this.onRoundEnd();
    }
}

module.exports = Game;
