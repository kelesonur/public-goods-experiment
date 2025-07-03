// Public Goods Game - Client Side JavaScript
const socket = io();

// Game state
let gameState = {
    playerId: null,
    roomId: null,
    playerNumber: null,
    condition: null,
    currentScreen: 'welcome',
    decisionStartTime: null,
    countdownInterval: null,
    waitTimerInterval: null,
    consentCompleted: false,
    demographicsCompleted: false
};

// DOM Elements
const screens = {
    welcome: document.getElementById('welcome-screen'),
    waiting: document.getElementById('waiting-screen'),
    consent: document.getElementById('consent-screen'),
    waitingConsent: document.getElementById('waiting-consent-screen'),
    demographics: document.getElementById('demographics-screen'),
    waitingDemographics: document.getElementById('waiting-demographics-screen'),
    waitingExperiment: document.getElementById('waiting-experiment-screen'),
    instructions: document.getElementById('instructions-screen'),
    contribution: document.getElementById('contribution-screen'),
    waitingOthers: document.getElementById('waiting-others-screen'),
    comprehension: document.getElementById('comprehension-screen'),
    results: document.getElementById('results-screen'),
    final: document.getElementById('final-screen'),
    waitingGroupStart: document.getElementById('waiting-group-start-screen')
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

    // Clear any running timers when switching screens
    if (gameState.countdownInterval) {
        clearInterval(gameState.countdownInterval);
        gameState.countdownInterval = null;
    }
    if (gameState.waitTimerInterval) {
        clearInterval(gameState.waitTimerInterval);
        gameState.waitTimerInterval = null;
    }

    // Reset contribution slider when showing contribution screen
    if (screenName === 'contribution') {
        const slider = document.getElementById('contribution-slider');
        if (slider) {
            slider.value = 0;
            const event = new Event('input');
            slider.dispatchEvent(event);
        }
        // Remove any previous auto-submit message
        const autoMsg = document.getElementById('auto-submit-msg');
        if (autoMsg) autoMsg.remove();
    }
}

function updatePlayerCount(count) {
    const currentPlayersEl = document.getElementById('current-players');
    if (currentPlayersEl) {
        currentPlayersEl.textContent = count;
    }
}

function updateConsentCount(count) {
    const consentPlayersEl = document.getElementById('consent-completed-players');
    if (consentPlayersEl) {
        consentPlayersEl.textContent = count;
    }
}

function updateDemographicsCount(count) {
    const demographicsPlayersEl = document.getElementById('demographics-completed-players');
    if (demographicsPlayersEl) {
        demographicsPlayersEl.textContent = count;
    }
}

function updateCompletedPlayers(count) {
    const completedPlayersEl = document.getElementById('completed-players');
    if (completedPlayersEl) {
        completedPlayersEl.textContent = count;
    }
}

function updateComprehensionStatus(data) {
    const statusDiv = document.getElementById('comprehension-status');
    const completedSpan = document.getElementById('comprehension-completed');
    
    if (statusDiv && completedSpan) {
        completedSpan.textContent = data.completedPlayers;
        
        if (data.waitingForOthers && data.completedPlayers > 0) {
            statusDiv.style.display = 'block';
        } else {
            statusDiv.style.display = 'none';
        }
    }
}

// Socket event handlers
socket.on('joined-room', (data) => {
    gameState.playerId = data.playerId;
    gameState.roomId = data.roomId;
    gameState.playerNumber = data.playerNumber;
    gameState.condition = data.condition;
    
    document.getElementById('room-id').textContent = data.roomId.substring(0, 8);
    document.getElementById('player-number').textContent = data.playerNumber;
    
    updatePlayerCount(data.playersCount);
    showScreen('waiting');
});

socket.on('player-count-update', (data) => {
    updatePlayerCount(data.playersCount);
});

socket.on('room-full-start-consent', () => {
    showScreen('consent');
});

socket.on('condition-assigned', (data) => {
    // Update the player's condition when it's assigned
    console.log('📥 Received condition-assigned:', data.condition);
    console.log('🔄 Updating gameState.condition from', gameState.condition, 'to', data.condition);
    gameState.condition = data.condition;
    console.log('✅ gameState.condition is now:', gameState.condition);
});

socket.on('consent-count-update', (data) => {
    updateConsentCount(data.consentedPlayers);
});

socket.on('consent-phase-complete', () => {
    // No longer needed, handled by client after submit
});

socket.on('demographics-count-update', (data) => {
    updateDemographicsCount(data.completedPlayers);
});

socket.on('demographics-phase-complete', () => {
    // No longer needed, handled by client after submit
});

socket.on('start-instructions-phase', () => {
    showScreen('instructions');
    gameState.instructionsStartTime = Date.now();
});

socket.on('waiting-for-others-to-start', (data) => {
    // Update the waiting screen to show how many players are ready
    showScreen('waitingGroupStart');
    
    // Update the ready player counter
    const readyPlayersEl = document.getElementById('ready-players');
    if (readyPlayersEl) {
        readyPlayersEl.textContent = data.readyCount;
    }
    
    // Update the waiting text
    const waitingText = document.querySelector('#waiting-group-start-screen .loading p');
    if (waitingText) {
        waitingText.textContent = `${data.readyCount}/4 oyuncu hazır. Diğer oyuncuların oyunu başlatması bekleniyor...`;
    }
});

socket.on('start-contribution-phase', (data) => {
    gameState.decisionStartTime = Date.now();
    gameState.condition = data.condition;
    showScreen('contribution');
    // Show condition-specific notice and setup timers
    const conditionNotice = document.getElementById('condition-notice');
    const timePressureNotice = conditionNotice.querySelector('.time-pressure-notice');
    const timeDelayNotice = conditionNotice.querySelector('.time-delay-notice');
    conditionNotice.style.display = 'block';
    if (data.condition === 'time_pressure') {
        timePressureNotice.style.display = 'block';
        timeDelayNotice.style.display = 'none';
        startCountdown(data.timeLimit || 10);
    } else if (data.condition === 'time_delay') {
        timePressureNotice.style.display = 'none';
        timeDelayNotice.style.display = 'block';
        startWaitTimer(data.minTime || 10);
    }
});

socket.on('contribution-received', (data) => {
    contributionSubmitted = true;
    if (gameState.countdownInterval) {
        clearInterval(gameState.countdownInterval);
        gameState.countdownInterval = null;
    }
    
    // Show confirmation message
    const submitBtn = document.getElementById('submit-contribution-btn');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Gönderildi ✓';
    submitBtn.disabled = true;
    
    // Show waiting message
    setTimeout(() => {
        showScreen('waitingOthers');
    }, 1000);
});

socket.on('contribution-auto-submitted', (data) => {
    // Handle server-side auto-submission due to timeout
    contributionSubmitted = true;
    if (gameState.countdownInterval) {
        clearInterval(gameState.countdownInterval);
        gameState.countdownInterval = null;
    }
    
    // Show the auto-submitted message
    const submitBtn = document.getElementById('submit-contribution-btn');
    submitBtn.textContent = 'Otomatik Gönderildi';
    submitBtn.disabled = true;
    
    // Show feedback message below the button
    const existingMessage = document.querySelector('.auto-submit-message');
    if (existingMessage) {
        existingMessage.remove();
    }
    
    const messageEl = document.createElement('p');
    messageEl.className = 'auto-submit-message';
    messageEl.style.color = '#e74c3c';
    messageEl.style.marginTop = '10px';
    messageEl.style.fontWeight = 'bold';
    messageEl.textContent = data.reason;
    submitBtn.parentNode.insertBefore(messageEl, submitBtn.nextSibling);
    
    console.log('Contribution auto-submitted by server:', data);
    
    // Show waiting message
    setTimeout(() => {
        showScreen('waitingOthers');
    }, 2000);
});

socket.on('contribution-rejected', (data) => {
    alert(data.reason);
    // Allow user to try again
});

socket.on('waiting-for-others', (data) => {
    updateCompletedPlayers(data.completedPlayers);
});

socket.on('start-comprehension-phase', () => {
    showScreen('comprehension');
});

socket.on('comprehension-received', (data) => {
    if (data.success) {
        // Show feedback that answers were submitted
        const submitBtn = document.getElementById('submit-comprehension-btn');
        submitBtn.textContent = 'Cevaplar Gönderildi ✓';
        submitBtn.disabled = true;
        submitBtn.style.backgroundColor = '#27ae60';
        
        // Show the comprehension status section to indicate waiting
        const statusDiv = document.getElementById('comprehension-status');
        if (statusDiv) {
            statusDiv.style.display = 'block';
        }
    }
});

socket.on('comprehension-status', (data) => {
    updateComprehensionStatus(data);
});

socket.on('game-results', (data) => {
    displayResults(data);
    showScreen('results');
});

socket.on('experiment-complete', (data) => {
    // Update final screen with final results
    const finalCredits = document.getElementById('final-credits-won');
    const finalTickets = document.getElementById('final-tickets-won');
    
    if (finalCredits && gameState.lastResults) {
        finalCredits.textContent = gameState.lastResults.yourCreditsWon + ' kredi';
    }
    if (finalTickets && gameState.lastResults) {
        finalTickets.textContent = gameState.lastResults.yourLotteryTickets + ' bilet';
    }
    
    showScreen('final');
});

socket.on('player-disconnected', (data) => {
    updatePlayerCount(data.playersCount);
    if (data.message) {
        // Show a more informative message about reconnection possibility
        const disconnectMessage = document.createElement('div');
        disconnectMessage.className = 'disconnect-notification';
        disconnectMessage.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #f39c12;
            color: white;
            padding: 15px;
            border-radius: 8px;
            z-index: 1000;
            max-width: 300px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        `;
        disconnectMessage.innerHTML = `
            <strong>Oyuncu Ayrıldı</strong><br>
            ${data.message}<br>
            <small>Bağlı oyuncular: ${data.playersCount}/${data.totalPlayers || 4}</small>
        `;
        document.body.appendChild(disconnectMessage);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (disconnectMessage.parentNode) {
                disconnectMessage.parentNode.removeChild(disconnectMessage);
            }
        }, 5000);
    }
});

// NEW RECONNECTION HANDLERS
socket.on('player-reconnected', (data) => {
    console.log('🔄 Reconnecting to existing session:', data);
    
    // Update game state with restored data
    gameState.playerId = data.playerId;
    gameState.roomId = data.roomId;
    gameState.playerNumber = data.playerNumber;
    gameState.condition = data.condition;
    
    // Update UI elements
    document.getElementById('room-id').textContent = data.roomId.substring(0, 8);
    document.getElementById('player-number').textContent = data.playerNumber;
    
    // Restore form data if available
    if (data.existingData) {
        if (data.existingData.name) {
            document.getElementById('participant-name').value = data.existingData.name;
        }
        if (data.existingData.email) {
            document.getElementById('participant-email').value = data.existingData.email;
        }
        if (data.existingData.demographics) {
            const demo = data.existingData.demographics;
            if (demo.age) document.getElementById('age').value = demo.age;
            if (demo.gender) document.getElementById('gender').value = demo.gender;
            if (demo.major) document.getElementById('major').value = demo.major;
        }
        if (data.existingData.consent) {
            document.getElementById('consent-checkbox').checked = data.existingData.consent;
        }
        if (data.existingData.contribution !== undefined) {
            const slider = document.getElementById('contribution-slider');
            if (slider) {
                slider.value = data.existingData.contribution;
                const event = new Event('input');
                slider.dispatchEvent(event);
            }
        }
    }
    
    // Show reconnection message
    const reconnectMessage = document.createElement('div');
    reconnectMessage.className = 'reconnect-notification';
    reconnectMessage.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #27ae60;
        color: white;
        padding: 15px 25px;
        border-radius: 8px;
        z-index: 1000;
        box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        text-align: center;
        font-weight: bold;
    `;
    reconnectMessage.textContent = '✓ Başarıyla yeniden bağlandınız!';
    document.body.appendChild(reconnectMessage);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        if (reconnectMessage.parentNode) {
            reconnectMessage.parentNode.removeChild(reconnectMessage);
        }
    }, 3000);
    
    // Restore to correct screen based on current state
    restorePlayerToCorrectScreen(data.currentState, data);
});

socket.on('player-reconnected-notification', (data) => {
    // Show notification to other players that disconnected player returned
    const welcomeBackMessage = document.createElement('div');
    welcomeBackMessage.className = 'player-return-notification';
    welcomeBackMessage.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #27ae60;
        color: white;
        padding: 15px;
        border-radius: 8px;
        z-index: 1000;
        max-width: 250px;
        box-shadow: 0 4px 8px rgba(0,0,0,0.3);
    `;
    welcomeBackMessage.innerHTML = `
        <strong>✓ Oyuncu Geri Döndü!</strong><br>
        ${data.message}<br>
        <small>Bağlı oyuncular: ${data.connectedPlayers}/4</small>
    `;
    document.body.appendChild(welcomeBackMessage);
    
    // Auto-remove after 4 seconds
    setTimeout(() => {
        if (welcomeBackMessage.parentNode) {
            welcomeBackMessage.parentNode.removeChild(welcomeBackMessage);
        }
    }, 4000);
    
    // Update player counts if elements exist
    updatePlayerCount(data.connectedPlayers);
});

// State restoration function for reconnection
function restorePlayerToCorrectScreen(currentState, data) {
    console.log(`🔄 Restoring player to state: ${currentState}`);
    
    switch (currentState) {
        case 'waiting':
        case 'waiting-players':
            showScreen('waiting');
            updatePlayerCount(data.playersCount);
            break;
            
        case 'consent':
            showScreen('consent');
            break;
            
        case 'demographics':
            showScreen('demographics');
            break;
            
        case 'waiting-experiment':
            showScreen('waitingExperiment');
            break;
            
        case 'instructions':
            showScreen('instructions');
            gameState.instructionsStartTime = Date.now();
            break;
            
        case 'waiting-group-start':
            showScreen('waitingGroupStart');
            break;
            
        case 'contribution':
            showScreen('contribution');
            gameState.decisionStartTime = Date.now();
            
            // Restore condition-specific UI
            const conditionNotice = document.getElementById('condition-notice');
            const timePressureNotice = conditionNotice.querySelector('.time-pressure-notice');
            const timeDelayNotice = conditionNotice.querySelector('.time-delay-notice');
            
            if (data.condition === 'time_pressure') {
                conditionNotice.style.display = 'block';
                timePressureNotice.style.display = 'block';
                timeDelayNotice.style.display = 'none';
                // Note: Don't restart timer on reconnection
            } else if (data.condition === 'time_delay') {
                conditionNotice.style.display = 'block';
                timePressureNotice.style.display = 'none';
                timeDelayNotice.style.display = 'block';
                // Enable the button since they've already waited
                const submitBtn = document.getElementById('submit-contribution-btn');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Kararımı Onayla';
                }
            }
            break;
            
        case 'waiting-others':
            showScreen('waitingOthers');
            // Mark contribution as submitted to prevent resubmission
            contributionSubmitted = true;
            
            // Disable contribution button if it exists
            const contribBtn = document.getElementById('submit-contribution-btn');
            if (contribBtn) {
                contribBtn.textContent = 'Gönderildi ✓';
                contribBtn.disabled = true;
            }
            break;
            
        case 'comprehension':
            showScreen('comprehension');
            break;
            
        case 'waiting-comprehension':
            showScreen('comprehension');
            
            // Mark comprehension as submitted and show status
            const compBtn = document.getElementById('submit-comprehension-btn');
            if (compBtn) {
                compBtn.textContent = 'Cevaplar Gönderildi ✓';
                compBtn.disabled = true;
                compBtn.style.backgroundColor = '#27ae60';
            }
            
            // Show the status section
            const statusDiv = document.getElementById('comprehension-status');
            if (statusDiv) {
                statusDiv.style.display = 'block';
            }
            break;
            
        case 'results':
            showScreen('results');
            // Results will be sent again by server if needed
            break;
            
        case 'final':
            showScreen('final');
            break;
            
        default:
            console.log(`⚠️ Unknown state: ${currentState}, defaulting to waiting`);
            showScreen('waiting');
            break;
    }
}

// Timer functions for conditions
let contributionSubmitted = false;

function startCountdown(seconds) {
    let timeLeft = seconds;
    const countdownEl = document.getElementById('countdown');
    const submitBtn = document.getElementById('submit-contribution-btn');
    contributionSubmitted = false;

    gameState.countdownInterval = setInterval(() => {
        countdownEl.textContent = timeLeft;

        if (timeLeft <= 0) {
            clearInterval(gameState.countdownInterval);
            countdownEl.textContent = 'Zaman Doldu!';
            countdownEl.style.color = 'red';
            
            // Auto-submit for time_pressure condition, but DON'T disable the button
            if (!contributionSubmitted && gameState.condition === 'time_pressure') {
                contributionSubmitted = true;
                const contribution = parseInt(document.getElementById('contribution-slider').value);
                const decisionTime = seconds * 1000;
                socket.emit('submit-contribution', {
                    contribution: contribution,
                    decisionTime: decisionTime
                });
                
                // Update button text to show auto-submission, but keep it enabled
                submitBtn.textContent = 'Otomatik Gönderildi';
                submitBtn.disabled = true; // Now disable since it's been submitted
                
                // Show auto-submit message
                let autoMsg = document.createElement('div');
                autoMsg.id = 'auto-submit-msg';
                autoMsg.style.color = 'red';
                autoMsg.style.marginTop = '10px';
                autoMsg.textContent = 'Süre doldu! Kararınız otomatik olarak gönderildi.';
                submitBtn.parentNode.appendChild(autoMsg);
            }
        }
        timeLeft--;
    }, 1000);
}

function startWaitTimer(minSeconds) {
    let timeElapsed = 0;
    const waitTimerEl = document.getElementById('wait-timer');
    const submitBtn = document.getElementById('submit-contribution-btn');
    
    // Initially disable the button
    submitBtn.disabled = true;
    submitBtn.textContent = `Lütfen ${minSeconds} saniye bekleyin...`;
    
    gameState.waitTimerInterval = setInterval(() => {
        timeElapsed++;
        waitTimerEl.textContent = timeElapsed;
        
        if (timeElapsed >= minSeconds) {
            clearInterval(gameState.waitTimerInterval);
            waitTimerEl.textContent = timeElapsed + ' (Artık karar verebilirsiniz)';
            waitTimerEl.style.color = 'green';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Kararımı Onayla';
        } else {
            submitBtn.textContent = `Lütfen ${minSeconds - timeElapsed} saniye daha bekleyin...`;
        }
    }, 1000);
}

// Button event handlers
document.getElementById('join-btn').addEventListener('click', () => {
    const participantName = document.getElementById('participant-name').value.trim();
    const participantEmail = document.getElementById('participant-email').value.trim();
    
    // Validate required fields
    if (!participantName) {
        alert('Lütfen adınızı giriniz.');
        return;
    }
    
    if (!participantEmail) {
        alert('Lütfen e-posta adresinizi giriniz.');
        return;
    }
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(participantEmail)) {
        alert('Lütfen geçerli bir e-posta adresi giriniz.');
        return;
    }
    
    socket.emit('join-game', { 
        name: participantName,
        email: participantEmail 
    });
});

// Consent form handling
document.getElementById('consent-checkbox').addEventListener('change', (e) => {
    const submitBtn = document.getElementById('submit-consent-btn');
    submitBtn.disabled = !e.target.checked;
});

document.getElementById('submit-consent-btn').addEventListener('click', () => {
    const consentGiven = document.getElementById('consent-checkbox').checked;
    if (consentGiven) {
        gameState.consentCompleted = true;
        socket.emit('submit-consent', { consentGiven });
        showScreen('demographics');
    }
});

// Demographics form handling
document.getElementById('submit-demographics-btn').addEventListener('click', () => {
    const age = document.getElementById('age').value;
    const gender = document.getElementById('gender').value;
    const major = document.getElementById('major').value.trim();
    
    if (!age || !gender || !major) {
        alert('Lütfen tüm alanları doldurun.');
        return;
    }
    
    gameState.demographicsCompleted = true;
    socket.emit('submit-demographics', {
        age: parseInt(age),
        gender: gender,
        major: major
    });
    // Show waiting screen while waiting for all players to complete demographics
    showScreen('waitingExperiment');
});

document.getElementById('start-game-btn').addEventListener('click', () => {
    console.log('🎯 Player clicked "Start Game" button');
    console.log('📋 Current gameState.condition:', gameState.condition);
    console.log('📤 Sending ready-to-play event');
    socket.emit('ready-to-play');
    // Show minimal waiting screen for group to start
    showScreen('waitingGroupStart');
});

// Contribution slider functionality
const contributionSlider = document.getElementById('contribution-slider');
const contributionValue = document.getElementById('contribution-value');
const previewContribution = document.getElementById('preview-contribution');
const previewRemaining = document.getElementById('preview-remaining');

contributionSlider.addEventListener('input', (e) => {
    const contribution = parseInt(e.target.value);
    const remaining = 10 - contribution; // Updated to 10 credits
    
    contributionValue.textContent = contribution;
    previewContribution.textContent = contribution + ' Kredi';
    previewRemaining.textContent = remaining + ' Kredi';
});

document.getElementById('submit-contribution-btn').addEventListener('click', () => {
    if (contributionSubmitted) return;
    contributionSubmitted = true;
    const contribution = parseInt(contributionSlider.value);
    const decisionTime = Date.now() - gameState.decisionStartTime;
    
    // Validate based on condition - ONLY validate time_delay condition
    if (gameState.condition === 'time_delay' && decisionTime < 10000) {
        alert('Lütfen en az 10 saniye düşünün!');
        contributionSubmitted = false; // Reset since we're not submitting
        return;
    }
    
    // For time_pressure: allow submission at any time (no time validation needed)
    // The countdown timer handles auto-submission if needed
    
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
    
    // Provide immediate feedback
    const submitBtn = document.getElementById('submit-comprehension-btn');
    submitBtn.textContent = 'Gönderiliyor...';
    submitBtn.disabled = true;
    
    socket.emit('submit-comprehension', {
        q1: q1.value, // Keep as string to handle 'varying', 'depends' etc.
        q2: q2.value
    });
});

// Results display
function displayResults(data) {
    // Store results for final screen
    gameState.lastResults = data;
    
    document.getElementById('result-contribution').textContent = data.yourContribution + ' Kredi';
    document.getElementById('result-kept').textContent = data.yourKept + ' Kredi';
    document.getElementById('result-share').textContent = data.yourShare.toFixed(2) + ' Kredi';
    document.getElementById('result-total').textContent = data.yourCreditsWon + ' Kredi';
    document.getElementById('result-tickets').textContent = data.yourLotteryTickets + ' Bilet';
    
    const totalContribution = data.allContributions.reduce((sum, c) => sum + c, 0);
    document.getElementById('group-total-contribution').textContent = totalContribution + ' Kredi';
    document.getElementById('group-doubled-pool').textContent = data.totalPool + ' Kredi';
    
    // Display all contributions
    const contributionsList = document.getElementById('all-contributions-list');
    contributionsList.innerHTML = '';
    
    data.allContributions.forEach((contribution, index) => {
        const item = document.createElement('div');
        item.className = 'contribution-item';
        item.textContent = `Oyuncu ${index + 1}: ${contribution} Kredi`;
        contributionsList.appendChild(item);
    });
}

document.getElementById('complete-experiment-btn').addEventListener('click', () => {
    socket.emit('complete-experiment');
});

// Initialize default slider value
document.addEventListener('DOMContentLoaded', () => {
    // Set initial slider value
    const slider = document.getElementById('contribution-slider');
    if (slider) {
        const event = new Event('input');
        slider.dispatchEvent(event);
    }
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