// Public Goods Game - Client Side JavaScript
const socket = io();

// Game state
let gameState = {
    playerId: null,
    roomId: null,
    playerNumber: null,
    currentScreen: 'welcome',
    decisionStartTime: null
};

// DOM Elements
const screens = {
    welcome: document.getElementById('welcome-screen'),
    waiting: document.getElementById('waiting-screen'),
    instructions: document.getElementById('instructions-screen'),
    contribution: document.getElementById('contribution-screen'),
    waitingOthers: document.getElementById('waiting-others-screen'),
    comprehension: document.getElementById('comprehension-screen'),
    results: document.getElementById('results-screen'),
    demographics: document.getElementById('demographics-screen'),
    final: document.getElementById('final-screen')
};

// Utility functions
function showScreen(screenName) {
    // Hide all screens
    Object.values(screens).forEach(screen => {
        if (screen) screen.classList.remove('active');
    });
    
    // Show target screen
    if (screens[screenName]) {
        screens[screenName].classList.add('active');
        gameState.currentScreen = screenName;
    }
}

function updatePlayerCount(count) {
    const currentPlayersEl = document.getElementById('current-players');
    if (currentPlayersEl) {
        currentPlayersEl.textContent = count;
    }
}

function updateCompletedPlayers(count) {
    const completedPlayersEl = document.getElementById('completed-players');
    if (completedPlayersEl) {
        completedPlayersEl.textContent = count;
    }
}

// Socket event handlers
socket.on('joined-room', (data) => {
    gameState.playerId = data.playerId;
    gameState.roomId = data.roomId;
    gameState.playerNumber = data.playerNumber;
    
    document.getElementById('room-id').textContent = data.roomId.substring(0, 8);
    document.getElementById('player-number').textContent = data.playerNumber;
    
    updatePlayerCount(data.playersCount);
    showScreen('waiting');
});

socket.on('player-count-update', (data) => {
    updatePlayerCount(data.playersCount);
});

socket.on('game-starting', (data) => {
    showScreen('instructions');
});

socket.on('start-contribution-phase', (data) => {
    gameState.decisionStartTime = Date.now();
    showScreen('contribution');
});

socket.on('contribution-received', (data) => {
    if (data.success) {
        showScreen('waitingOthers');
    }
});

socket.on('waiting-for-others', (data) => {
    updateCompletedPlayers(data.completedPlayers);
});

socket.on('start-comprehension', (data) => {
    showScreen('comprehension');
});

socket.on('comprehension-received', (data) => {
    if (data.success) {
        // Stay on comprehension screen until all players finish
    }
});

socket.on('game-results', (data) => {
    displayResults(data);
    showScreen('results');
});

socket.on('experiment-complete', (data) => {
    showScreen('final');
});

socket.on('player-disconnected', (data) => {
    updatePlayerCount(data.playersCount);
    if (data.message) {
        alert(data.message);
    }
});

// Button event handlers
document.getElementById('join-btn').addEventListener('click', () => {
    const participantName = document.getElementById('participant-name').value.trim();
    socket.emit('join-game', { name: participantName });
});

document.getElementById('start-game-btn').addEventListener('click', () => {
    socket.emit('ready-to-play');
});

// Contribution slider functionality
const contributionSlider = document.getElementById('contribution-slider');
const contributionValue = document.getElementById('contribution-value');
const previewContribution = document.getElementById('preview-contribution');
const previewRemaining = document.getElementById('preview-remaining');

contributionSlider.addEventListener('input', (e) => {
    const contribution = parseInt(e.target.value);
    const remaining = 20 - contribution;
    
    contributionValue.textContent = contribution;
    previewContribution.textContent = contribution + ' TL';
    previewRemaining.textContent = remaining + ' TL';
});

document.getElementById('submit-contribution-btn').addEventListener('click', () => {
    const contribution = parseInt(contributionSlider.value);
    const decisionTime = Date.now() - gameState.decisionStartTime;
    
    socket.emit('submit-contribution', {
        contribution: contribution,
        decisionTime: decisionTime
    });
});

// Comprehension questions
document.getElementById('submit-comprehension-btn').addEventListener('click', () => {
    const q1 = document.querySelector('input[name="q1"]:checked');
    const q2 = document.querySelector('input[name="q2"]:checked');
    
    if (!q1 || !q2) {
        alert('Lütfen tüm soruları cevaplayın.');
        return;
    }
    
    socket.emit('submit-comprehension', {
        q1: parseInt(q1.value),
        q2: parseInt(q2.value)
    });
});

// Results display
function displayResults(data) {
    document.getElementById('result-contribution').textContent = data.yourContribution + ' TL';
    document.getElementById('result-kept').textContent = data.yourKept + ' TL';
    document.getElementById('result-share').textContent = data.yourShare.toFixed(2) + ' TL';
    document.getElementById('result-total').textContent = data.yourTotalPayoff.toFixed(2) + ' TL';
    
    const totalContribution = data.allContributions.reduce((sum, c) => sum + c, 0);
    document.getElementById('group-total-contribution').textContent = totalContribution + ' TL';
    document.getElementById('group-doubled-pool').textContent = data.totalPool + ' TL';
    
    // Display all contributions
    const contributionsList = document.getElementById('all-contributions-list');
    contributionsList.innerHTML = '';
    
    data.allContributions.forEach((contribution, index) => {
        const item = document.createElement('div');
        item.className = 'contribution-item';
        item.textContent = `Oyuncu ${index + 1}: ${contribution} TL`;
        contributionsList.appendChild(item);
    });
}

document.getElementById('continue-to-demo-btn').addEventListener('click', () => {
    showScreen('demographics');
});

// Demographics form
document.getElementById('submit-demographics-btn').addEventListener('click', () => {
    const age = document.getElementById('age').value;
    const gender = document.getElementById('gender').value;
    const major = document.getElementById('major').value;
    
    if (!age || !gender || !major) {
        alert('Lütfen tüm alanları doldurun.');
        return;
    }
    
    socket.emit('submit-demographics', {
        age: parseInt(age),
        gender: gender,
        major: major
    });
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    showScreen('welcome');
    
    // Initialize slider value
    const initialValue = contributionSlider.value;
    contributionValue.textContent = initialValue;
    previewContribution.textContent = initialValue + ' TL';
    previewRemaining.textContent = (20 - initialValue) + ' TL';
});

// Error handling
socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    alert('Sunucuya bağlanırken hata oluştu. Lütfen sayfayı yenileyin.');
});

socket.on('disconnect', (reason) => {
    console.log('Disconnected:', reason);
    if (reason === 'io server disconnect') {
        // Server disconnected the client, reconnect manually
        socket.connect();
    }
}); 