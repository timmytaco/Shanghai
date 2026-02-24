const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const Game = require('./game/Game'); // Game acts as the "Table" logic

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// --- Data Structures ---
// Rooms: { [roomId]: Room }
const rooms = {};

class Room {
    constructor(id, hostId, options = {}) {
        this.id = id;
        this.hostId = hostId;
        this.players = []; // Array of { id, username, socket, score: 0 }
        this.tables = [];  // Array of Game instances
        this.status = 'lobby'; // lobby, active, intermission
        this.currentRoundNumber = 1;
        this.finishedTables = 0;
        this.activeConfig = null;

        // Randomization
        this.config = {
            randomizer: options.randomizer || 'normal'
        };
        // History: Map of "playerA_playerB" -> count of times played together
        this.pairHistory = new Map();

        // Options

        // Options
        this.maxWaitingPlayers = options.maxWaitingPlayers || 24; // Default limit for testing
        this.isLocked = false;
        this.chatHistory = [];

        // Settings for the tournament/game
        this.tableSize = 8; // Default, but overridden by start config
    }

    addPlayer(socket, username) {
        if (this.isLocked) return 'locked';
        if (this.players.length >= this.maxWaitingPlayers) return 'full';

        const player = {
            id: socket.id,
            username: username,
            socket: socket,
            score: 0
        };
        this.players.push(player);
        socket.join(this.id);

        return true;
    }

    removePlayer(socketId) {
        this.players = this.players.filter(p => p.id !== socketId);
        // Clean up empty room handled purely in server loop?
    }

    // Start a new tournament round with specific configuration
    startRound(io, config = {}) {
        // config.tableSizes is an array of integers, e.g. [5, 5] for 10 players
        // Check permissions/validity
        if (this.players.length < 5) return { error: 'Minimum 5 players required.' };

        // If config is provided (first round), store it. If not (next rounds), use active.
        if (Object.keys(config).length > 0) {
            this.activeConfig = config;
        } else {
            config = this.activeConfig;
        }

        const sizes = config.tableSizes || [this.players.length]; // Default to 1 table
        const totalSeats = sizes.reduce((a, b) => a + b, 0);

        if (totalSeats !== this.players.length) {
            return { error: 'Table configuration does not match player count.' };
        }

        // Validate 5-12 rule
        if (sizes.some(s => s < 5 || s > 12)) {
            return { error: 'All tables must have between 5 and 12 players.' };
        }

        this.status = 'active';
        // this.currentRoundNumber is managed by startNextRound logic or reset here if it's round 1
        if (config.isNewGame) {
            this.currentRoundNumber = 1;
        }

        this.finishedTables = 0;
        this.tables = [];

        // Shuffle Players
        let shuffled = [...this.players];

        // 1. Determine Shuffle Method
        const useRoundRobin = config.randomizerType === 'round_robin';
        if (useRoundRobin && this.currentRoundNumber > 1) { // Only matters after Round 1 to minimize repeats
            shuffled = this.getWeightedShuffle(shuffled, sizes);
        } else {
            // Standard Random
            shuffled.sort(() => 0.5 - Math.random());
        }

        let offset = 0;

        sizes.forEach((size, index) => {
            const chunk = shuffled.slice(offset, offset + size);
            offset += size;

            // Record History for this chunk (group of players at a table)
            this.recordPairHistory(chunk);

            const tableId = `${this.id}_table_${index}`;
            // Pass round number to Game
            const game = new Game(tableId, io, this.currentRoundNumber);

            chunk.forEach(p => {
                game.addPlayer({
                    id: p.id,
                    username: p.username,
                    hand: [],
                    score: p.score
                });

                p.socket.emit('tableAssigned', { tableId: tableId });
                p.socket.join(tableId);
            });

            // Handle Round End
            game.onRoundEnd = () => {
                this.finishedTables++;
                // Notify players in this table they are in intermission
                io.to(tableId).emit('roomStatus', { status: 'intermission_local', message: 'Waiting for other tables...' });

                if (this.finishedTables >= this.tables.length) {
                    this.status = 'intermission';
                    io.to(this.id).emit('roomStatus', { status: 'intermission_global', round: this.currentRoundNumber });
                }
            };

            game.startRound();
            this.tables.push(game);
        });

        io.to(this.id).emit('roomStatus', { status: 'round_active', round: this.currentRoundNumber });
        return { success: true };
    }

    startNextRound(io) {
        if (this.status !== 'intermission' && this.currentRoundNumber !== 1) return; // Basic check

        this.currentRoundNumber++;
        if (this.currentRoundNumber > 7) {
            // End Tournament
            io.to(this.id).emit('gameEnd', { scores: this.players }); // Simple end for now
            return;
        }

        // Reuse stored config
        this.startRound(io, {});
    }

    // --- Round Robin Helpers ---

    recordPairHistory(playerList) {
        // Record that these players played together
        for (let i = 0; i < playerList.length; i++) {
            for (let j = i + 1; j < playerList.length; j++) {
                const p1 = playerList[i].id;
                const p2 = playerList[j].id;
                // Sort IDs to ensure consistent key
                const key = [p1, p2].sort().join('_');
                const count = this.pairHistory.get(key) || 0;
                this.pairHistory.set(key, count + 1);
            }
        }
    }

    getWeightedShuffle(players, tableSizes) {
        // Goal: Minimize the sum of "pair history counts" for the new tables.
        // Heuristic: Randomized Greedy / Monte Carlo.

        let bestShuffle = [...players];
        let minCost = Infinity;
        const attempts = 50; // Try 50 random shuffles and pick the best

        for (let k = 0; k < attempts; k++) {
            const candidate = [...players].sort(() => 0.5 - Math.random());
            let currentCost = 0;
            let offset = 0;

            for (const size of tableSizes) {
                const tablePlayers = candidate.slice(offset, offset + size);
                offset += size;

                // Calculate cost for this table
                for (let i = 0; i < tablePlayers.length; i++) {
                    for (let j = i + 1; j < tablePlayers.length; j++) {
                        const key = [tablePlayers[i].id, tablePlayers[j].id].sort().join('_');
                        currentCost += (this.pairHistory.get(key) || 0);
                    }
                }
            }

            if (currentCost < minCost) {
                minCost = currentCost;
                bestShuffle = candidate;
            }

            // Perfect score? Stop early.
            if (minCost === 0) break;
        }

        console.log(`[Round Robin] Best Cost: ${minCost} (Attempts: ${attempts})`);
        return bestShuffle;
    }
}

// --- Helper Functions ---
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function findRandomPublicRoom() {
    const available = Object.values(rooms).find(r => r.isPublic && r.status === 'lobby' && r.players.length < r.maxPlayers);
    return available ? available.id : null;
}

// --- Socket Logic ---
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('createRoom', ({ username, options }) => {
        const roomId = generateRoomCode();
        const room = new Room(roomId, socket.id, options || {});

        if (room.addPlayer(socket, username)) {
            rooms[roomId] = room;
            socket.emit('roomCreated', { roomId, isHost: true });
            emitRoomUpdate(roomId);
        }
    });

    socket.on('joinRoom', ({ username, roomId }) => {
        roomId = roomId.toUpperCase();
        const room = rooms[roomId];

        if (room && room.status === 'lobby') {
            const result = room.addPlayer(socket, username);
            if (result === true) {
                socket.emit('roomJoined', { roomId, isHost: false });
                emitRoomUpdate(roomId);
            } else {
                socket.emit('error', result === 'locked' ? 'Room is locked' : 'Room is full');
            }
        } else {
            socket.emit('error', 'Room not found or already started');
        }
    });

    socket.on('joinRandom', ({ username }) => {
        let roomId = findRandomPublicRoom();
        let isHost = false;

        if (!roomId) {
            roomId = generateRoomCode();
            rooms[roomId] = new Room(roomId, socket.id, { isPublic: true });
            isHost = true;
        }

        const room = rooms[roomId];
        room.addPlayer(socket, username);
        socket.emit(isHost ? 'roomCreated' : 'roomJoined', { roomId, isHost });
        emitRoomUpdate(roomId);
    });

    socket.on('startGame', ({ roomId, config }) => {
        const room = rooms[roomId];
        if (room && room.hostId === socket.id) {
            config.isNewGame = true; // Flag to reset round number
            const result = room.startRound(io, config);
            if (result.error) {
                socket.emit('error', result.error);
            }
        }
    });

    socket.on('toggleLock', ({ roomId }) => {
        const room = rooms[roomId];
        if (room && room.hostId === socket.id) {
            room.isLocked = !room.isLocked;
            emitRoomUpdate(roomId);
        }
    });

    socket.on('lobbyChat', ({ roomId, message }) => {
        const room = rooms[roomId];
        if (room) {
            const chatMsg = { username: null, text: message, system: false };
            // find sender
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                chatMsg.username = player.username;
                room.chatHistory.push(chatMsg);
                io.to(roomId).emit('lobbyChat', chatMsg);
            }
        }
    });

    // Pass-through game events? 
    // Actually the Game instances should handle their own events if separate?
    // OR we route everything here.
    // For now, let's keep Game.js mostly handling logic but we need to route specific actions to the specific Game/Table.
    // simpler: If client emits 'gameAction', we find their room/table.

    // Standard: `socket.on('playCard', ...)` -> find which Game this socket is in.

    // ... Additional game event handlers (draw, discard, etc) mapped to correct room.table ...

    // --- Game Action Routing ---
    // Helper to find player's game instance
    function getPlayerGame(socketId) {
        // Inefficient O(N) lookup but fine for MVP. 
        // Better: Map<socketId, {room, table}>
        for (const room of Object.values(rooms)) {
            for (const table of room.tables) {
                if (table.players.some(p => p.id === socketId)) {
                    return table;
                }
            }
        }
        return null;
    }

    socket.on('drawCard', () => {
        const game = getPlayerGame(socket.id);
        if (game) game.drawCard(socket.id);
    });

    socket.on('drawDiscard', () => {
        const game = getPlayerGame(socket.id);
        if (game) game.drawDiscard(socket.id);
    });

    socket.on('requestBuy', () => {
        const game = getPlayerGame(socket.id);
        if (game) game.requestBuy(socket.id);
    });

    socket.on('startNextRound', ({ roomId }) => {
        const room = rooms[roomId];
        if (room && room.hostId === socket.id) {
            room.startNextRound(io);
        }
    });

    socket.on('chatMessage', ({ text }) => {
        // Dynamic Scope:
        // 1. Find Room
        const room = Object.values(rooms).find(r => r.players.some(p => p.id === socket.id));
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        const chatMsg = { username: player.username, text };

        // 2. Check Status
        if (room.status === 'active') {
            // Find which table player is in
            const table = room.tables.find(t => t.players.some(p => p.id === socket.id));
            // If table is active, send to table. If table finished, send to Room? 
            // Constraint: "During rounds... individual chat for each table... After table finished... back to room chat"

            // Check table status
            if (table && table.gameStatus !== 'game_end') {
                // Table Chat
                io.to(table.roomId).emit('chatMessage', { ...chatMsg, scope: 'Table' });
            } else {
                // Player is finished, so they are in "Intermission/Lobby" mode effectively (for chat)
                // Constraint: "chat with any other table that is ALSO finished"
                // Simplest way: Emit to `roomId` BUT clients need to filter? 
                // OR emit to a special 'intermission' room? 
                // Let's just emit to `roomId`. Active players will see it if we don't block it, 
                // BUT active players should be focused on Table chat.
                // Let's emit to `roomId` with scope 'Room'. Client decides display?
                // Wait, active players shouldn't be distracted.
                // Better: Join 'finished' players to a side-channel? 
                // OR: Just emit to `roomId`. Active clients filter out 'Room' scope messages if they are playing?
                // Let's do that.
                io.to(room.id).emit('chatMessage', { ...chatMsg, scope: 'Room' });
            }
        } else {
            // Lobby or Global Intermission -> Room Chat
            io.to(room.id).emit('chatMessage', { ...chatMsg, scope: 'Room' });
        }
    });

    socket.on('reorderHand', (newHand) => {
        const game = getPlayerGame(socket.id);
        if (game) game.reorderHand(socket.id, newHand);
    });

    socket.on('disconnect', () => {
        // Find room
        Object.values(rooms).forEach(room => {
            room.removePlayer(socket.id);
            emitRoomUpdate(room.id);
            if (room.players.length === 0) {
                delete rooms[room.id];
            }
        });
    });
});

function emitRoomUpdate(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    io.to(roomId).emit('roomUpdate', {
        players: room.players.map(p => ({
            id: p.id,
            username: p.username,
            isHost: p.id === room.hostId
        })),
        maxPlayers: room.maxWaitingPlayers,
        isLocked: room.isLocked,
        roomId: roomId
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
