const socket = io();

// State
let myId = null;
let currentRoom = null;
let isHost = false;
let selectedCards = new Set();
// Duplicate vars removed
let lastRound = 0; // Track round for animation

// DOM Elements
const screens = {
    welcome: document.getElementById('welcome-screen'),
    menu: document.getElementById('main-menu'),
    createConfig: document.getElementById('create-config-screen'),
    joinCode: document.getElementById('join-code-screen'),
    lobby: document.getElementById('lobby-screen'),
    game: document.getElementById('game-screen')
};

const ui = {
    // Welcome
    usernameInput: document.getElementById('username-input'),
    btnEnter: document.getElementById('btn-enter-app'),
    btnRulesWelcome: document.getElementById('btn-rules-welcome'),

    // Menu
    btnMenuCreate: document.getElementById('btn-menu-create'),
    btnMenuJoinCode: document.getElementById('btn-menu-join-code'),
    btnMenuJoinCode: document.getElementById('btn-menu-join-code'),
    displayUsername: document.getElementById('display-username'),

    // Create Config
    configMaxInput: document.getElementById('config-max-input'),
    configMaxVal: document.getElementById('config-max-val'),
    configPublicInput: document.getElementById('config-public-input'),
    btnConfigStart: document.getElementById('btn-config-start'),
    btnConfigCancel: document.getElementById('btn-config-cancel'),

    // Join Code
    joinCodeInput: document.getElementById('join-code-input'),
    btnJoinSubmit: document.getElementById('btn-join-submit'),
    btnJoinCancel: document.getElementById('btn-join-cancel'),

    // Lobby
    lobbyRoomId: document.getElementById('lobby-room-id'),
    hostControls: document.getElementById('host-controls'),
    btnToggleOpen: document.getElementById('btn-toggle-open'),
    lobbyPlayers: document.getElementById('lobby-players'),
    lobbyChatMsgs: document.getElementById('lobby-chat-messages'),
    lobbyChatInput: document.getElementById('lobby-chat-input'),
    btnLobbySend: document.getElementById('btn-lobby-send'),
    btnLeave: document.getElementById('btn-leave-lobby'),
    btnStartGame: document.getElementById('start-game-btn'),
    playerCount: document.getElementById('player-count'),

    // Modal
    modal: document.getElementById('start-modal'),
    tableConfigOptions: document.getElementById('table-config-options'),
    btnCancelStart: document.getElementById('cancel-start-btn'),

    // Rules
    rulesModal: document.getElementById('rules-modal'),
    closeModal: document.querySelector('.close-modal'),
    // Opponent Melds View
    meldView: {
        modal: document.getElementById('opponent-meld-modal'),
        close: document.querySelector('.close-meld-view'),
        title: document.getElementById('opp-view-name'),
        container: document.getElementById('opp-melds-container')
    }
};

let username = localStorage.getItem('shanghai_username') || '';
if (username) ui.usernameInput.value = username;

// --- Navigation ---
function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.add('hidden'));
    if (screens[name]) screens[name].classList.remove('hidden');
}

// 1. Welcome Flow
ui.usernameInput.addEventListener('input', (e) => {
    ui.btnEnter.disabled = e.target.value.trim().length === 0;
});
ui.btnEnter.disabled = ui.usernameInput.value.trim().length === 0;

ui.btnEnter.onclick = () => {
    username = ui.usernameInput.value.trim();
    if (!username) return;
    localStorage.setItem('shanghai_username', username);
    ui.displayUsername.textContent = `Logged in as: ${username}`;
    showScreen('menu');
};
ui.btnRulesWelcome.onclick = () => toggleRules(true);

// 2. Menu Flow
ui.btnMenuCreate.onclick = () => showScreen('createConfig');
ui.btnMenuJoinCode.onclick = () => showScreen('joinCode');

// 3. Create Flow
ui.configMaxInput.oninput = (e) => ui.configMaxVal.textContent = e.target.value;
ui.btnConfigCancel.onclick = () => showScreen('menu');
ui.btnConfigStart.onclick = () => {
    socket.emit('createRoom', {
        username: username,
        options: {
            maxWaitingPlayers: parseInt(ui.configMaxInput.value),
            isPublic: ui.configPublicInput.checked
        }
    });
};

// 4. Join Flow
ui.btnJoinCancel.onclick = () => showScreen('menu');
ui.btnJoinSubmit.onclick = () => {
    const code = ui.joinCodeInput.value.trim();
    if (!code) return;
    socket.emit('joinRoom', { username, roomId: code });
};

// 5. Lobby Flow
ui.btnToggleOpen.onclick = () => {
    socket.emit('toggleLock', { roomId: currentRoomId });
};

ui.btnLobbySend.onclick = sendLobbyChat;
ui.lobbyChatInput.onkeydown = (e) => {
    if (e.key === 'Enter') sendLobbyChat();
};

function sendLobbyChat() {
    const text = ui.lobbyChatInput.value.trim();
    if (!text) return;
    socket.emit('lobbyChat', { roomId: currentRoomId, message: text });
    ui.lobbyChatInput.value = '';
}

ui.btnLeave.onclick = () => {
    location.reload(); // Simple leave
};

// --- Start Game Logic ---
ui.btnStartGame.onclick = () => {
    if (currentPlayers.length < 5) return;
    ui.modal.classList.remove('hidden');
    generateTableOptions();
};

ui.btnCancelStart.onclick = () => ui.modal.classList.add('hidden');

function generateTableOptions() {
    const container = ui.tableConfigOptions;
    container.innerHTML = '';
    const count = currentPlayers.length;
    const options = [];

    // Logic: 5-12 players per table
    // 1 Table
    if (count <= 12 && count >= 5) {
        options.push({ label: `1 Table of ${count}`, sizes: [count] });
    }
    // 2 Tables (Min 10 players)
    if (count >= 10) {
        // Best split: Halves
        const half = Math.floor(count / 2);
        options.push({ label: `2 Tables (${half} & ${count - half})`, sizes: [half, count - half] });
    }
    // 3 Tables (Min 15 players)
    if (count >= 15) {
        const third = Math.floor(count / 3);
        const rem = count - (third * 3); // Distribute remainder
        // e.g. 16 -> 5, 5, 6
        options.push({ label: `3 Tables (~${third} each)`, sizes: [third, third, third + rem] });
    }

    if (options.length === 0) {
        container.textContent = "Not enough players (Min 5).";
        return;
    }

    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'config-btn'; // styling needed
        btn.textContent = opt.label;
        btn.onclick = () => {
            const shuffleType = document.querySelector('input[name="shuffle-type"]:checked').value;
            socket.emit('startGame', {
                roomId: currentRoomId,
                config: {
                    tableSizes: opt.sizes,
                    randomizerType: shuffleType
                }
            });
            ui.modal.classList.add('hidden');
        };
        container.appendChild(btn);
    });
}

const gameDisplay = {
    round: document.getElementById('round-display'),
    turn: document.getElementById('turn-display'),
    opponents: document.getElementById('opponents-area'),
    discardPile: document.getElementById('discard-pile'),
    myHand: document.getElementById('my-hand'),
    btns: {
        // draw/meld removed
        buy: document.getElementById('btn-buy'),
        discard: document.getElementById('btn-discard'),
        sortRank: document.getElementById('btn-sort-rank'),
        sortSuit: document.getElementById('btn-sort-suit'),
        scoreboard: document.getElementById('btn-scoreboard')
    },
    // Deck Interaction
    deck: document.getElementById('draw-deck'),
    // Chat & Scoreboard
    chat: {
        widget: document.getElementById('chat-widget'),
        header: document.getElementById('chat-header'),
        toggle: document.getElementById('chat-toggle'),
        messages: document.getElementById('chat-messages'),
        input: document.getElementById('chat-input'),
        send: document.getElementById('btn-send-chat')
    },
    scoreboard: {
        modal: document.getElementById('scoreboard-modal'),
        close: document.querySelector('.close-scoreboard'),
        body: document.getElementById('scoreboard-body')
    }
};

// Rules
function toggleRules(show) {
    if (show) ui.rulesModal.classList.remove('hidden');
    else ui.rulesModal.classList.add('hidden');
}
ui.closeModal.onclick = () => toggleRules(false);
window.onclick = (e) => {
    if (e.target == ui.rulesModal) toggleRules(false);
    if (e.target == gameDisplay.scoreboard.modal) gameDisplay.scoreboard.modal.classList.add('hidden');
    if (e.target == ui.meldView.modal) ui.meldView.modal.classList.add('hidden');
};

// --- Socket Events ---
socket.on('roomCreated', (data) => {
    enterLobby(data.roomId, true);
});

socket.on('roomJoined', (data) => {
    enterLobby(data.roomId, data.isHost);
});

socket.on('roomUpdate', (data) => {
    ui.lobbyRoomId.textContent = `Room: ${data.roomId}`;
    ui.playerCount.textContent = data.players.length;

    // Render Players
    ui.lobbyPlayers.innerHTML = data.players.map(p =>
        `<div class="player-tag ${p.id === myId ? 'me' : ''}">
            ${p.username} ${p.isHost ? '👑' : ''}
        </div>`
    ).join('');

    // Host Controls
    const me = data.players.find(p => p.id === myId);
    if (me) {
        // Sync global host status
        isHost = me.isHost;

        if (me.isHost) {
            ui.hostControls.classList.remove('hidden');
            ui.btnStartGame.classList.remove('hidden');
            ui.btnStartGame.disabled = data.players.length < 5;

            ui.btnToggleOpen.textContent = data.isLocked ? "Room: CLOSED (Locked)" : "Room: OPEN";
            ui.btnToggleOpen.className = data.isLocked ? "toggle-btn closed" : "toggle-btn open";
        } else {
            ui.hostControls.classList.add('hidden');
            ui.btnStartGame.classList.add('hidden');
        }
    }

    currentPlayers = data.players;
});

socket.on('lobbyChat', (msg) => {
    const div = document.createElement('div');
    div.innerHTML = `<b>${msg.username}:</b> ${msg.text}`;
    ui.lobbyChatMsgs.appendChild(div);
    ui.lobbyChatMsgs.scrollTop = ui.lobbyChatMsgs.scrollHeight;
});

function enterLobby(roomId, hostStatus) {
    currentRoomId = roomId;
    isHost = hostStatus; // Update global
    showScreen('lobby');
}

// --- Game Actions ---
gameDisplay.deck.onclick = () => {
    // Only allow draw if my turn AND awaiting draw
    if (isMyTurn && window.lastGameState.turnStatus === 'awaiting_draw') {
        socket.emit('drawCard');
    }
};

gameDisplay.btns.buy.onclick = () => {
    socket.emit('requestBuy');
};

gameDisplay.discardPile.onclick = () => {
    // If it's my turn, picking up discard is a Draw move
    // If NOT my turn, it's a Buy request
    if (isMyTurn) {
        if (window.lastGameState.turnStatus === 'awaiting_draw') {
            socket.emit('drawDiscard');
        }
    } else {
        // Optional: Trigger buy on click? Or stick to button?
        // User said "do the discard pile", implies interaction.
        // Let's allow click to buy as well for fluid play.
        socket.emit('requestBuy');
    }
};

gameDisplay.btns.discard.onclick = () => {
    if (selectedCards.size !== 1) return;
    const index = [...selectedCards][0];
    socket.emit('discardCard', { cardIndex: index });
    selectedCards.clear();
};

// Meld Button Logic
document.getElementById('btn-meld').onclick = () => {
    if (selectedCards.size < 3) {
        alert("Select at least 3 cards to meld.");
        return;
    }
    // We send a single meld group of the selected cards
    const indices = [...selectedCards];
    // Backend expects array of arrays
    socket.emit('meld', { melds: [indices] });

    selectedCards.clear();
};

// --- Sorting & UI Features ---
gameDisplay.btns.sortRank.onclick = () => {
    if (!window.localHand) return;
    const valueOrder = {
        '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
        'J': 11, 'Q': 12, 'K': 13, 'A': 14, '2': 15, 'Joker': 16
    };
    window.localHand.sort((a, b) => {
        const valA = valueOrder[a.value] || 0;
        const valB = valueOrder[b.value] || 0;
        if (valA !== valB) return valA - valB;
        return a.suit.localeCompare(b.suit);
    });
    // Trigger re-render
    if (window.lastGameState) renderGame(window.lastGameState);
    // Persist
    socket.emit('reorderHand', window.localHand);
};

gameDisplay.btns.sortSuit.onclick = () => {
    if (!window.localHand) return;
    const valueOrder = {
        '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
        'J': 11, 'Q': 12, 'K': 13, 'A': 14, '2': 15, 'Joker': 16
    };
    window.localHand.sort((a, b) => {
        if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
        const valA = valueOrder[a.value] || 0;
        const valB = valueOrder[b.value] || 0;
        return valA - valB;
    });
    if (window.lastGameState) renderGame(window.lastGameState);
    // Persist
    socket.emit('reorderHand', window.localHand);
};

// Chat
gameDisplay.chat.header.onclick = () => {
    gameDisplay.chat.widget.classList.toggle('collapsed');
    gameDisplay.chat.toggle.textContent = gameDisplay.chat.widget.classList.contains('collapsed') ? '▲' : '▼';
};

const sendChat = () => {
    const text = gameDisplay.chat.input.value.trim();
    if (!text) return;
    socket.emit('chatMessage', { text });
    gameDisplay.chat.input.value = '';
};

gameDisplay.chat.send.onclick = sendChat;
gameDisplay.chat.input.onkeydown = (e) => {
    if (e.key === 'Enter') sendChat();
};

// Scoreboard
gameDisplay.btns.scoreboard.onclick = () => {
    gameDisplay.scoreboard.modal.classList.remove('hidden');
    updateScoreboard();
};
gameDisplay.scoreboard.close.onclick = () => {
    gameDisplay.scoreboard.modal.classList.add('hidden');
};

// Opponent Meld View
ui.meldView.close.onclick = () => {
    ui.meldView.modal.classList.add('hidden');
};

function updateScoreboard() {
    if (!window.lastGameState) return;
    const players = window.lastGameState.players;
    gameDisplay.scoreboard.body.innerHTML = players.map(p => `
        <tr>
            <td>${p.username} ${p.id === window.lastGameState.currentTurn ? '(Turn)' : ''}</td>
            <td>${p.score}</td>
        </tr>
    `).join('');
}

// --- Socket Events ---

socket.on('connect', () => {
    myId = socket.id;
});

// Replaces old roomUpdate/roomJoined logic (handled above)

socket.on('roomStatus', (status) => {
    if (status.status === 'round_active') {
        // Prepare for game view
        showScreen('game');
        document.getElementById('intermission-overlay').classList.add('hidden');
    } else if (status.status === 'intermission_local') {
        // Show Intermission Overlay (Waiting)
        showIntermission(status.message, false);
    } else if (status.status === 'intermission_global') {
        // Show Global Intermission (Host can start)
        const isHost = currentPlayers.find(p => p.id === myId)?.isHost;
        showIntermission(`Round ${status.round} Complete! Chat with the room.`, isHost);
    }
});

function showIntermission(msg, isHost) {
    const overlay = document.getElementById('intermission-overlay');
    overlay.classList.remove('hidden');
    document.getElementById('intermission-msg').textContent = msg;

    const btn = document.getElementById('btn-next-round');
    if (isHost) {
        btn.classList.remove('hidden');
        btn.onclick = () => {
            socket.emit('startNextRound', { roomId: currentRoomId });
        };
    } else {
        btn.classList.add('hidden');
    }
}

socket.on('tableAssigned', (data) => {
    console.log('Assigned to table:', data.tableId);
    showScreen('game');
    // We are now "in game" at a specific table
});

socket.on('error', (msg) => {
    alert(msg);
});

// Reuse existing game logic
socket.on('gameState', (gameState) => {
    // Hide intermission overlay if we get game state (means round started)
    document.getElementById('intermission-overlay').classList.add('hidden');
    renderGame(gameState);
});

socket.on('roomStatus', (data) => {
    const overlay = document.getElementById('intermission-overlay');
    const msg = document.getElementById('intermission-msg');
    const bNext = document.getElementById('btn-next-round');

    if (data.status === 'intermission_local') {
        overlay.classList.remove('hidden');
        msg.textContent = data.message || "Waiting for other tables...";
        bNext.classList.add('hidden');
    } else if (data.status === 'intermission_global') {
        overlay.classList.remove('hidden');
        msg.textContent = `Round ${data.round} Complete! Intermission.`;
        // Show Next Round button only for Host
        if (isHost) {
            bNext.classList.remove('hidden');
            bNext.onclick = () => {
                socket.emit('startNextRound', { roomId: currentRoomId });
            };
        }
    } else if (data.status === 'round_active') {
        overlay.classList.add('hidden');
    }
});

socket.on('gameEnd', (data) => {
    // Show final scoreboard
    const scoreBody = gameDisplay.scoreboard.body;
    scoreBody.innerHTML = '';
    // Sort buy score?
    const sorted = [...data.scores].sort((a, b) => a.score - b.score);

    sorted.forEach((s, i) => {
        const row = document.createElement('tr');
        row.innerHTML = `<td>${s.username} ${i === 0 ? '🏆' : ''}</td><td>${s.score}</td>`;
        scoreBody.appendChild(row);
    });

    gameDisplay.scoreboard.modal.classList.remove('hidden');
    alert("Game Over! Final Scores displayed.");
});

socket.on('buyRequest', (data) => {
    const modal = document.getElementById('buy-request-modal');
    const text = document.getElementById('buy-request-text');
    const preview = document.getElementById('buy-card-preview');

    modal.classList.remove('hidden');
    text.textContent = `${data.requesterName} wants to buy the top discard.`;

    // Play Alert Sound
    SoundManager.playAlert();

    preview.innerHTML = '';
    if (data.card) {
        preview.appendChild(renderCard(data.card));
    }

    document.getElementById('btn-allow-buy').onclick = () => {
        socket.emit('resolveBuyRequest', { allowed: true });
        modal.classList.add('hidden');
    };

    document.getElementById('btn-deny-buy').onclick = () => {
        socket.emit('resolveBuyRequest', { allowed: false });
        modal.classList.add('hidden');
    };
});

socket.on('chatMessage', (data) => {
    // Chat Filtering Logic
    if (data.scope === 'Room') {
        // block room chat if I am actively playing
        if (window.lastGameState && window.lastGameState.turnStatus !== 'game_end') {
            // We are in a game. Ignore room chat.
            return;
        }
    }

    const div = document.createElement('div');
    const scopeLabel = data.scope ? `[${data.scope}] ` : '';
    // Styling for scope?
    const scopeHtml = data.scope === 'Room' ? '<span style="color: #f1c40f">[Room]</span> ' : '';

    div.innerHTML = `${scopeHtml}<strong>${data.username}:</strong> ${data.text}`;
    div.scrollIntoView();
    gameDisplay.chat.messages.appendChild(div);
    gameDisplay.chat.messages.scrollTop = gameDisplay.chat.messages.scrollHeight;
});

// Utility
function animateValue(obj, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

// --- Utils (Reused) ---
function showScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.add('hidden'));
    screens[screenName].classList.remove('hidden');
}

function renderCard(card) {
    const el = document.createElement('div');
    el.className = `card ${['Hearts', 'Diamonds'].includes(card.suit) ? 'red' : 'black'}`;
    el.innerHTML = `
        <div class="card-top">${card.value} ${getSuitSymbol(card.suit)}</div>
        <div class="card-center">${getSuitSymbol(card.suit)}</div>
        <div class="card-bottom">${card.value} ${getSuitSymbol(card.suit)}</div>
    `;
    el.dataset.suit = card.suit;
    el.dataset.value = card.value;
    return el;
}

function getSuitSymbol(suit) {
    switch (suit) {
        case 'Hearts': return '♥';
        case 'Diamonds': return '♦';
        case 'Clubs': return '♣';
        case 'Spades': return '♠';
        case 'None': return '★';
        default: return '';
    }
}


// --- Game Rendering (Reused) ---
function renderGame(state) {
    gameDisplay.round.textContent = `Round ${state.round}: ${state.contract.contract}`;
    isMyTurn = state.currentTurn === myId;
    gameDisplay.turn.textContent = isMyTurn ? "YOUR TURN" : "Opponent's Turn";
    updateControls(state);

    gameDisplay.discardPile.innerHTML = '';
    if (state.discardTop) {
        gameDisplay.discardPile.appendChild(renderCard(state.discardTop));
    }

    const me = state.players.find(p => p.id === myId);
    if (me) {
        // Only update hand reference if first render or cards changed count
        // OR simply re-render always for now to ensure position updates
        gameDisplay.myHand.innerHTML = '';

        // Use local hand if available (for optimistic UI on swap), otherwise state
        const handToRender = window.localHand || me.hand;
        window.localHand = me.hand; // Sync

        handToRender.forEach((card, index) => {
            const cardEl = renderCard(card);

            // Click Handler (Exclusive Selection)
            cardEl.onclick = () => handleCardClick(index, card);

            // Drag and Drop Attributes
            cardEl.setAttribute('draggable', true);
            cardEl.ondragstart = (e) => handleDragStart(e, index);
            cardEl.ondragover = handleDragOver;
            cardEl.ondrop = (e) => handleDropHand(e, index);
            cardEl.ondragend = handleDragEnd;

            if (selectedCards.has(index)) cardEl.classList.add('selected');
            gameDisplay.myHand.appendChild(cardEl);
        });
    }

    gameDisplay.opponents.innerHTML = '';
    const opponents = state.players.filter(p => p.id !== myId);
    opponents.forEach((p, i) => {
        const el = document.createElement('div');
        el.className = 'opponent';
        // Circular position logic
        // 8 positions max. 
        // i=0 is Top-Left, then clockwise.
        // Actually, lets assume 'top' is center. 
        // We can just use style transform to rotate a container or absolute positions.
        // Simple Absolute Map for 8 players:
        const positions = [
            { top: '10%', left: '50%', transform: 'translate(-50%, -50%)' }, // Top Center
            { top: '20%', left: '80%', transform: 'translate(-50%, -50%)' }, // Top Right
            { top: '50%', left: '90%', transform: 'translate(-50%, -50%)' }, // Right
            { top: '80%', left: '80%', transform: 'translate(-50%, -50%)' }, // Bottom Right
            { top: '80%', left: '20%', transform: 'translate(-50%, -50%)' }, // Bottom Left
            { top: '50%', left: '10%', transform: 'translate(-50%, -50%)' }, // Left
            { top: '20%', left: '20%', transform: 'translate(-50%, -50%)' }, // Top Left
        ];

        const pos = positions[i % positions.length];
        Object.assign(el.style, pos);

        el.innerHTML = `
            <div><strong>${p.username}</strong></div>
            <div style="font-size: 0.9em">Cards: ${p.handCount}</div>
            <div style="font-size: 0.9em">Score: ${p.score}</div>
            <div>${p.down ? 'DOWN' : ''}</div>
        `;
        gameDisplay.opponents.appendChild(el);
    });
}

function updateControls(state) {
    // Logic:
    // If My Turn:
    //   - awaiting_draw: Enable Deck/Discard Draw. Disable Discard button.
    //   - playing: Disable Deck/Discard Draw. Enable Discard button.
    // If Not My Turn:
    //   - Enable Buy (Discard Click). Discard button disabled.

    const canDiscard = isMyTurn && state.turnStatus === 'playing' && selectedCards.size === 1;
    gameDisplay.btns.discard.disabled = !canDiscard;

    // Meld Button: Enabled if playing phase
    const canMeld = isMyTurn && state.turnStatus === 'playing';
    document.getElementById('btn-meld').disabled = !canMeld;
    document.getElementById('btn-meld').className = canMeld ? 'primary-btn' : 'secondary-btn';

    gameDisplay.btns.buy.disabled = isMyTurn || state.pendingBuy; // Buy only off-turn AND if no one else is buying

    // Visual indicator for locked buy?
    if (state.pendingBuy) {
        gameDisplay.btns.buy.textContent = "Buying...";
    } else {
        gameDisplay.btns.buy.textContent = "Buy";
    }

    // Deck/Pile visual cues?
    if (isMyTurn && state.turnStatus === 'awaiting_draw') {
        gameDisplay.deck.classList.add('action-available');
        gameDisplay.discardPile.classList.add('action-available');
    } else {
        gameDisplay.deck.classList.remove('action-available');
        gameDisplay.discardPile.classList.remove('action-available');
    }
}

const handleCardClick = (index, card) => {
    // Exclusive Selection Logic (No Swapping on Click)
    if (selectedCards.has(index)) {
        selectedCards.delete(index);
    } else {
        // Clear others to enforce single selection (for Discard/Meld ease)
        // Multi-select needed for Melds? Yes.
        // But user said: "click one card... lights up... discard it"
        // Let's allow multi-select for Melds, but maybe clear if clicking a new one?
        // Actually, for Melds we need multiple.
        // Let's just toggle. User can click multiple to Meld.
        // But for Discard button, we check size === 1.
        selectedCards.add(index);
    }
    if (window.lastGameState) renderGame(window.lastGameState);
};

// --- Drag and Drop Logic ---
let draggedCardIndex = null;

function handleDragStart(e, index) {
    draggedCardIndex = index;
    e.dataTransfer.effectAllowed = 'move';
    e.target.classList.add('dragging');
    // Hide ghost slightly or custom drag image? Default is okay.
}

function handleDragOver(e) {
    e.preventDefault(); // Allow Drop
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDropHand(e, targetIndex) {
    e.stopPropagation();
    e.preventDefault(); // Stop redirect

    if (draggedCardIndex === null || draggedCardIndex === targetIndex) return;

    // Perform Reorder
    if (window.localHand) {
        const item = window.localHand.splice(draggedCardIndex, 1)[0];
        window.localHand.splice(targetIndex, 0, item);

        // Persist
        socket.emit('reorderHand', window.localHand);

        // Re-render
        if (window.lastGameState) renderGame(window.lastGameState);
    }
    draggedCardIndex = null;
}

function handleDropDiscard(e) {
    e.stopPropagation();
    e.preventDefault();

    if (draggedCardIndex === null) return;

    // Check if valid discard state
    if (!isMyTurn || window.lastGameState.turnStatus !== 'playing') {
        // Maybe show error or shake?
        return;
    }

    // Trigger Discard
    const card = window.localHand[draggedCardIndex];
    // We need to know the index relative to server state? 
    // If localHand is reordered, we send the updated hand to server first? 
    // Actually, 'discardCard' likely takes an index. 
    // If our localHand order doesn't match server, we might discard wrong card.
    // BUT 'reorderHand' sends the whole clean hand.
    // So we should trust 'window.localHand' IS the hand.
    // The server 'discardCard' might expect an index based on its stored hand.
    // CRITICAL: We must ensure server has latest order or we send the CARD Content?
    // Game.js `discardCard(playerId, cardIndex)` uses index.
    // We should probably sync order before discarding if we just dragged-to-reorder?
    // Actually, if we drag-to-discard, we haven't reordered yet (we just dragged OUT).
    // So the index `draggedCardIndex` refers to the CURRENT `window.localHand`.
    // Does server know this order? 
    // If we reordered previously, yes. 
    // If we just dragged from index 3 to discard, index 3 is correct.

    socket.emit('discard', { cardIndex: draggedCardIndex });
    draggedCardIndex = null;
}

function handleDragEnd(e) {
    e.target.classList.remove('dragging');
    draggedCardIndex = null;
}

// --- Guidance Logic ---
let helpEnabled = true;

function updateGuidance(state) {
    const banner = document.getElementById('guidance-banner');
    const text = document.getElementById('guidance-text');
    if (!banner || !text) return;

    if (!helpEnabled) {
        banner.classList.add('hidden');
        return;
    }
    banner.classList.remove('hidden');

    if (!state) {
        text.textContent = "Waiting for game data...";
        return;
    }

    const isMyTurn = state.currentTurn === myId;

    if (state.gameStatus !== 'active') {
        text.textContent = "Game Status: " + state.gameStatus;
        return;
    }

    if (isMyTurn) {
        if (state.pendingBuy) {
            text.textContent = "✋ STOP! Someone wants to buy the discard using a timeout. Allow it?";
            banner.style.background = "#e74c3c"; // Red warning
        } else if (state.turnStatus === 'awaiting_draw') {
            text.textContent = "👇 YOUR TURN! Draw a card from the Deck or the Discard Pile.";
            banner.style.background = "#27ae60"; // Green go
        } else if (state.turnStatus === 'playing') {
            text.textContent = "👉 Play! Select cards to Meld, OR Drag a card to the Discard Pile to end turn.";
            banner.style.background = "#2980b9"; // Blue
        }
    } else {
        // Not my turn
        const currentName = state.players.find(p => p.id === state.currentTurn)?.username || 'Unknown';
        text.textContent = `⌛ Waiting for ${currentName} to move...`;
        banner.style.background = "#7f8c8d"; // Grey
    }
}

// --- Game Rendering ---
function renderGame(state) {
    updateGuidance(state);
    // Store last state for re-renders (sorting/swapping)
    window.lastGameState = state;

    gameDisplay.round.textContent = `Round ${state.round}: ${state.contract.contract}`;
    isMyTurn = state.currentTurn === myId;
    gameDisplay.turn.textContent = isMyTurn ? "YOUR TURN" : "Opponent's Turn";
    updateControls(state);

    gameDisplay.discardPile.innerHTML = '';
    if (state.discardTop) {
        gameDisplay.discardPile.appendChild(renderCard(state.discardTop));
    }

    const me = state.players.find(p => p.id === myId);
    if (me) {
        // Hand Persistence Logic:
        // Always prioritize state.myHand which is the authoritative source for "My Cards"
        let handToRender = [];

        if (state.myHand && state.myHand.length > 0) {
            handToRender = state.myHand;
            // Update local storage for sorting overlap
            if (!window.localHand || window.localHand.length !== state.myHand.length) {
                window.localHand = state.myHand;
            } else {
                // If lengths match, usage localHand to preserve sort order
                handToRender = window.localHand;
            }
        } else if (window.localHand) {
            handToRender = window.localHand;
        }

        gameDisplay.myHand.innerHTML = '';
        if (handToRender && handToRender.length > 0) {
            handToRender.forEach((card, index) => {
                const cardEl = renderCard(card);
                cardEl.onclick = () => handleCardClick(index, card, handToRender);
                if (selectedCards.has(index)) cardEl.classList.add('selected');
                gameDisplay.myHand.appendChild(cardEl);
            });
        }
    }

    // Opponents
    gameDisplay.opponents.innerHTML = '';
    // Store positions for animation
    window.opponentPositions = {}; // { playerId: {top, left...} }

    // Start Animation if New Round
    if (state.round > lastRound) {
        lastRound = state.round;
        // Logic to identifying dealer
        // Dealer is player BEFORE current starts? 
        // Logic: currentTurn is (dealer + 1). So dealer is (currentTurn + N - 1) % N.

        // Find index of current turn player
        const turnIdx = state.players.findIndex(p => p.id === state.currentTurn);
        if (turnIdx !== -1) {
            const dealerIdx = (turnIdx - 1 + state.players.length) % state.players.length;
            const dealerId = state.players[dealerIdx].id;

            // Trigger Animation
            setTimeout(() => {
                playDealAnimation(dealerId, state.players.map(p => p.id));
            }, 500);
        }
    }

    const opponents = state.players.filter(p => p.id !== myId);
    opponents.forEach((p, i) => {
        const el = document.createElement('div');
        el.className = `opponent ${p.id === state.currentTurn ? 'active-turn' : ''}`;
        el.id = `opp-box-${p.id}`; // Add ID for tracking

        // Fixed positions for up to 7 opponents + Me (bottom) = 8
        const positions = [
            { top: '15%', left: '50%', transform: 'translate(-50%, -50%)' }, // Top Center
            { top: '25%', left: '80%', transform: 'translate(-50%, -50%)' }, // Top Right
            { top: '50%', left: '85%', transform: 'translate(-50%, -50%)' }, // Right
            { top: '75%', left: '75%', transform: 'translate(-50%, -50%)' }, // Bottom Right
            { top: '75%', left: '25%', transform: 'translate(-50%, -50%)' }, // Bottom Left
            { top: '50%', left: '15%', transform: 'translate(-50%, -50%)' }, // Left
            { top: '25%', left: '20%', transform: 'translate(-50%, -50%)' }, // Top Left
        ];

        const pos = positions[i % positions.length];
        Object.assign(el.style, pos);

        // Generate Card Backs
        let cardsHtml = '<div class="opponent-hand-container">';
        for (let c = 0; c < p.handCount; c++) {
            cardsHtml += '<div class="small-card-back"></div>';
        }
        cardsHtml += '</div>';

        const scoreDiv = document.createElement('div');
        scoreDiv.style.fontSize = '0.9em';

        // Animated Score
        if (!window.lastScores) window.lastScores = {};
        const prevScore = window.lastScores[p.id] || 0;

        if (prevScore !== p.score) {
            scoreDiv.textContent = `Score: ${prevScore}`; // Start at prev
            // Extract number node to animate? 
            // animateValue replaces innerHTML. 
            // Let's just animate the number.
            const label = document.createTextNode('Score: ');
            const numSpan = document.createElement('span');
            scoreDiv.innerHTML = '';
            scoreDiv.appendChild(label);
            scoreDiv.appendChild(numSpan);
            animateValue(numSpan, prevScore, p.score, 1000);
            window.lastScores[p.id] = p.score;
        } else {
            scoreDiv.textContent = `Score: ${p.score}`;
        }

        el.innerHTML = `
            <div><strong>${p.username}</strong></div>
            ${cardsHtml}
            <div style="font-size: 0.9em">Cards: ${p.handCount}</div>
        `;
        el.appendChild(scoreDiv); // Append Score

        const downDiv = document.createElement('div');
        if (p.down) downDiv.textContent = 'DOWN';
        el.appendChild(downDiv);

        // Add click handler for viewing melds
        el.style.cursor = 'pointer';
        el.onclick = () => showOpponentMelds(p);

        gameDisplay.opponents.appendChild(el);
    });
}

// Music Toggle
document.addEventListener('DOMContentLoaded', () => {
    const btnMusic = document.getElementById('btn-music-toggle');
    if (btnMusic) {
        btnMusic.onclick = () => {
            const playing = SoundManager.toggleMusic();
            btnMusic.textContent = playing ? "Music: On" : "Music: Off";
            btnMusic.classList.toggle('primary-sm', playing);
            btnMusic.classList.toggle('secondary-sm', !playing);
        };
    }
});
// --- Animation Logic ---
function getPlayerCenter(playerId) {
    if (playerId === myId) {
        // My hand center (approx)
        const rect = gameDisplay.myHand.getBoundingClientRect();
        return {
            left: rect.left + rect.width / 2,
            top: rect.top + rect.height / 2
        };
    } else {
        // Opponent
        const el = document.getElementById(`opp-box-${playerId}`);
        if (el) {
            const rect = el.getBoundingClientRect();
            return {
                left: rect.left + rect.width / 2,
                top: rect.top + rect.height / 2
            };
        }
    }
    // Fallback: Center screen
    return { left: window.innerWidth / 2, top: window.innerHeight / 2 };
}

function playDealAnimation(dealerId, allPlayerIds) {
    // Determine order: Start from dealer+1, rotate, do 11 rounds
    const dealerIdx = allPlayerIds.indexOf(dealerId);
    if (dealerIdx === -1) return;

    // Create a sequence of targets
    // We deal 11 cards to N players.
    // Order: (dealer+1), (dealer+2)... wrapping around.
    const startPos = getPlayerCenter(dealerId);

    let delay = 0;
    const interval = 50; // ms between cards

    // Total cards = 11 * numPlayers
    // We want to animate "rounds" of dealing? Or just stream them?
    // "Putting the cards out clockwise... until each player has 11"

    for (let round = 0; round < 11; round++) {
        for (let i = 1; i <= allPlayerIds.length; i++) {
            const targetIdx = (dealerIdx + i) % allPlayerIds.length;
            const targetId = allPlayerIds[targetIdx];

            setTimeout(() => {
                spawnFlyingCard(startPos, getPlayerCenter(targetId));
            }, delay);
            delay += interval;
        }
    }
}

// --- Sound Manager ---
const SoundManager = {
    ctx: null,
    musicOsc: null,
    musicGain: null,
    musicInterval: null,
    isMusicPlaying: false,

    init: function () {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    },
    playTone: function (freq, type, duration, vol = 0.1) {
        if (!this.ctx) this.init();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    },
    playDraw: function () { this.playTone(300, 'sine', 0.1); },
    playDiscard: function () { this.playTone(200, 'triangle', 0.1); },
    playBuy: function () {
        this.playTone(400, 'square', 0.1);
        setTimeout(() => this.playTone(600, 'square', 0.2), 100);
    },
    playAlert: function () {
        this.playTone(800, 'sine', 0.1);
        setTimeout(() => this.playTone(800, 'sine', 0.1), 150);
    },
    playClick: function () { this.playTone(1200, 'sine', 0.05, 0.05); },
    playHover: function () { this.playTone(800, 'triangle', 0.02, 0.02); },

    toggleMusic: function () {
        if (this.isMusicPlaying) this.stopMusic();
        else this.startMusic();
        return this.isMusicPlaying;
    },

    startMusic: function () {
        if (!this.ctx) this.init();
        if (this.isMusicPlaying) return;
        this.isMusicPlaying = true;

        // Simple ambient loop
        // Play a soft chord every few seconds
        const playChord = () => {
            if (!this.isMusicPlaying) return;
            const now = this.ctx.currentTime;

            // Root
            const o1 = this.ctx.createOscillator();
            const g1 = this.ctx.createGain();
            o1.frequency.value = 220; // A3
            o1.type = 'sine';
            g1.gain.setValueAtTime(0.02, now);
            g1.gain.linearRampToValueAtTime(0, now + 4);
            o1.connect(g1); g1.connect(this.ctx.destination);
            o1.start(); o1.stop(now + 4);

            // Fifth
            const o2 = this.ctx.createOscillator();
            const g2 = this.ctx.createGain();
            o2.frequency.value = 330; // E4
            o2.type = 'sine';
            g2.gain.setValueAtTime(0.01, now);
            g2.gain.linearRampToValueAtTime(0, now + 4);
            o2.connect(g2); g2.connect(this.ctx.destination);
            o2.start(); o2.stop(now + 4);
        };

        playChord();
        this.musicInterval = setInterval(playChord, 5000);
    },

    stopMusic: function () {
        this.isMusicPlaying = false;
        if (this.musicInterval) clearInterval(this.musicInterval);
    }
};

// Hook up global button sounds
document.addEventListener('DOMContentLoaded', () => {
    document.body.addEventListener('mouseover', (e) => {
        if (e.target.tagName === 'BUTTON') SoundManager.playHover();
    });
    document.body.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') SoundManager.playClick();
    });
});

// Global Animation Handler (Updated with Sound)
socket.on('animateAction', (action) => {
    // ... (existing geometry logic) ...
    const startDeckBase = gameDisplay.deck.getBoundingClientRect();
    const startDiscardBase = gameDisplay.discardPile.getBoundingClientRect();
    const getCenter = (rect) => ({ left: rect.left + rect.width / 2, top: rect.top + rect.height / 2 });
    const deckPos = getCenter(startDeckBase);
    const discardPos = getCenter(startDiscardBase);
    let playerPos = { left: 0, top: 0 };
    if (action.playerId) playerPos = getPlayerCenter(action.playerId);

    if (action.type === 'draw') {
        spawnFlyingCard(deckPos, playerPos);
        SoundManager.playDraw();
    } else if (action.type === 'drawDiscard') {
        spawnFlyingCard(discardPos, playerPos, action.card);
        SoundManager.playDraw();
    } else if (action.type === 'discard') {
        spawnFlyingCard(playerPos, discardPos, action.card);
        SoundManager.playDiscard();
    } else if (action.type === 'buy') {
        spawnFlyingCard(discardPos, playerPos, action.card);
        setTimeout(() => spawnFlyingCard(deckPos, playerPos), 150);
        setTimeout(() => spawnFlyingCard(deckPos, playerPos), 300);
        SoundManager.playBuy();
    }
});

// Initialize Sound on first interaction & Play Click for buttons
document.body.addEventListener('click', (e) => {
    SoundManager.init();
    if (e.target.tagName === 'BUTTON') {
        SoundManager.playClick();
    }
});

// Setup Discard Drop Zone
document.addEventListener('DOMContentLoaded', () => {
    const discardPile = document.getElementById('discard-pile');
    if (discardPile) {
        discardPile.ondragover = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            discardPile.classList.add('drag-over');
        };
        discardPile.ondragleave = () => {
            discardPile.classList.remove('drag-over');
        };
        discardPile.ondrop = (e) => {
            discardPile.classList.remove('drag-over');
            handleDropDiscard(e);
        };
    }

    // Help Toggle
    const btnHelp = document.getElementById('btn-help-toggle');
    if (btnHelp) {
        btnHelp.onclick = () => {
            helpEnabled = !helpEnabled;
            btnHelp.textContent = helpEnabled ? "Help: On" : "Help: Off";
            btnHelp.className = helpEnabled ? 'secondary-sm' : 'secondary-sm'; // Keep style or toggle?
            // Update immediately
            const banner = document.getElementById('guidance-banner');
            if (banner) {
                if (helpEnabled) banner.classList.remove('hidden');
                else banner.classList.add('hidden');
            }
        };
    }
});

function spawnFlyingCard(start, end, cardContent = null) {
    const card = document.createElement('div');
    if (cardContent) {
        // Face Up
        const isRed = ['Hearts', 'Diamonds'].includes(cardContent.suit);
        card.className = `card flying-card ${isRed ? 'red' : 'black'}`;
        card.innerHTML = `
            <div class="card-top">${cardContent.value} ${getSuitSymbol(cardContent.suit)}</div>
            <div class="card-center">${getSuitSymbol(cardContent.suit)}</div>
            <div class="card-bottom">${cardContent.value} ${getSuitSymbol(cardContent.suit)}</div>
        `;
    } else {
        // Face Down
        card.className = 'card-back flying-card';
    }

    document.body.appendChild(card);

    // Initial Pos (Centered on Start Point)
    // We assume .flying-card has transform: translate(-50%, -50%) in CSS
    card.style.left = `${start.left}px`;
    card.style.top = `${start.top}px`;

    // Force layout
    // (trigger reflow for transition)
    card.offsetHeight;

    // Target Pos
    card.style.left = `${end.left}px`;
    card.style.top = `${end.top}px`;

    // Remove after animation (0.6s match CSS)
    setTimeout(() => {
        if (card.parentNode) card.parentNode.removeChild(card);
    }, 650);
}

function getSuitSymbol(suit) {
    switch (suit) {
        case 'Hearts': return '♥';
        case 'Diamonds': return '♦';
        case 'Clubs': return '♣';
        case 'Spades': return '♠';
        case 'None': return '★';
        default: return '';
    }
}

// --- Admin / Mock Data ---
window.setupMockGame = function () {
    // Dummy State
    const mockState = {
        round: 1,
        contract: { contract: '2 Sets' },
        currentTurn: 'mock-me',
        turnStatus: 'playing',
        discardTop: { suit: 'Hearts', value: 'A' },
        players: [
            {
                id: 'mock-me', username: 'Admin', handCount: 11, score: 0, down: false, hand: [
                    { suit: 'Hearts', value: '2' }, { suit: 'Hearts', value: '3' }, { suit: 'Hearts', value: '4' },
                    { suit: 'Spades', value: '10' }, { suit: 'Spades', value: 'J' }, { suit: 'Spades', value: 'Q' }, { suit: 'Spades', value: 'K' },
                    { suit: 'Diamonds', value: '5' }, { suit: 'Clubs', value: '8' }, { suit: 'Clubs', value: '9' }, { suit: 'Joker', value: 'Joker' }
                ]
            },
            { id: 'op1', username: 'Bot 1', handCount: 10, score: 50, down: false, hand: [] },
            { id: 'op2', username: 'Bot 2', handCount: 8, score: 20, down: true, hand: [] },
            { id: 'op3', username: 'Bot 3', handCount: 11, score: 0, down: false, hand: [] }
        ],
        pendingBuy: false,
        myHand: []
    };

    myId = 'mock-me';
    mockState.myHand = mockState.players[0].hand;

    showScreen('game');
    renderGame(mockState);
    console.log("Mock Game Loaded");
};


function showOpponentMelds(player) {
    ui.meldView.modal.classList.remove('hidden');
    ui.meldView.title.textContent = `${player.username}'s Melds`;
    ui.meldView.container.innerHTML = '';

    if (!player.melds || player.melds.length === 0) {
        ui.meldView.container.innerHTML = '<div class="empty-msg">No cards laid down yet.</div>';
        return;
    }

    player.melds.forEach(meld => {
        const meldGroup = document.createElement('div');
        meldGroup.className = 'meld-group';
        meld.forEach(card => {
            meldGroup.appendChild(renderCard(card, true));
        });
        ui.meldView.container.appendChild(meldGroup);
    });
}
