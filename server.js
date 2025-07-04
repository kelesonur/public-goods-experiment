const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

// Basic authentication middleware for admin routes
function basicAuth(req, res, next) {
    const auth = req.headers.authorization;
    
    if (!auth) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Admin Panel"');
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    const credentials = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':');
    const username = credentials[0];
    const password = credentials[1];
    
    if (username === 'admin' && password === '3cl2025') {
        next();
    } else {
        res.setHeader('WWW-Authenticate', 'Basic realm="Admin Panel"');
        return res.status(401).json({ error: 'Invalid credentials' });
    }
}

// Serve admin.html with authentication
app.get('/admin.html', basicAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve analytics.html with authentication
app.get('/analytics.html', basicAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'analytics.html'));
});

// Serve other static files normally
app.use(express.static('public'));

// Initialize SQLite database
const db = new sqlite3.Database('experiment_data.db');

// Create tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        player_id TEXT,
        group_id TEXT,
        participant_name TEXT,
        participant_email TEXT,
        condition TEXT,
        consent_given BOOLEAN,
        contribution INTEGER,
        intended_contribution INTEGER,
        timed_out BOOLEAN DEFAULT 0,
        decision_time INTEGER,
        credits_won INTEGER,
        lottery_tickets INTEGER,
        comprehension_q1 TEXT,
        comprehension_q2 TEXT,
        age INTEGER,
        gender TEXT,
        major TEXT,
        instructions_time INTEGER,
        consent_timestamp DATETIME,
        demographics_timestamp DATETIME,
        contribution_timestamp DATETIME,
        comprehension_timestamp DATETIME,
        completion_timestamp DATETIME,
        user_agent TEXT,
        ip_address TEXT,
        session_duration INTEGER,
        browser_info TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        status TEXT DEFAULT 'waiting',
        total_contribution INTEGER DEFAULT 0,
        total_credits_distributed INTEGER DEFAULT 0,
        start_time DATETIME,
        end_time DATETIME,
        completion_rate REAL,
        avg_decision_time INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS interactions (
        id TEXT PRIMARY KEY,
        player_id TEXT,
        group_id TEXT,
        action_type TEXT,
        action_data TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Add new columns to existing sessions table if they don't exist
    db.run(`ALTER TABLE sessions ADD COLUMN intended_contribution INTEGER`, (err) => {
        // Ignore error if column already exists
    });
    db.run(`ALTER TABLE sessions ADD COLUMN timed_out BOOLEAN DEFAULT 0`, (err) => {
        // Ignore error if column already exists
    });
});

// Game state management
const rooms = new Map();
const players = new Map(); // Map socket.id to player info
const persistentPlayers = new Map(); // Map email+roomId to persistent player data

class GameRoom {
    constructor(id) {
        this.id = id;
        this.players = [];
        this.status = 'waiting'; // waiting, consent, demographics, instructions, playing, comprehension, results
        this.consentGiven = new Map();
        this.demographics = new Map();
        this.conditions = new Map(); // 'time_pressure' or 'time_delay'
        this.contributions = new Map();
        this.intendedContributions = new Map(); // Track slider values before timeout
        this.timeoutStatus = new Map(); // Track which players timed out
        this.decisionTimes = new Map();
        this.comprehensionAnswers = new Map();
        this.comprehensionCompleted = new Map();
        this.participantNames = new Map();
        this.participantEmails = new Map();
        this.instructionsTimes = new Map();
        this.timestamps = new Map();
        this.userAgents = new Map();
        this.ipAddresses = new Map();
        this.startTime = null;
        this.instructionsStartTime = null;
        this.createdAt = new Date().toISOString();
        this.readyPlayers = new Set(); // Track who clicked Oyunu Başlat
        
        // NEW: Track player states and disconnections
        this.playerStates = new Map(); // playerId -> current phase/screen
        this.disconnectedPlayers = new Map(); // playerId -> disconnection timestamp
        this.disconnectionTimeouts = new Map(); // playerId -> timeout reference
    }

    addPlayer(playerId, socket, isReconnection = false) {
        if (!isReconnection && this.players.length < 4 && this.status === 'waiting') {
            this.players.push({ id: playerId, socket });
            this.playerStates.set(playerId, 'waiting');
            return true;
        } else if (isReconnection) {
            // Find and update existing player
            const existingPlayerIndex = this.players.findIndex(p => p.id === playerId);
            if (existingPlayerIndex !== -1) {
                this.players[existingPlayerIndex].socket = socket;
                this.disconnectedPlayers.delete(playerId);
                
                // Clear disconnection timeout
                if (this.disconnectionTimeouts.has(playerId)) {
                    clearTimeout(this.disconnectionTimeouts.get(playerId));
                    this.disconnectionTimeouts.delete(playerId);
                }
                return true;
            }
        }
        return false;
    }

    assignBalancedConditions() {
        // Assign 2 time_pressure and 2 time_delay randomly
        const shuffled = this.players.map(p => p.id).sort(() => Math.random() - 0.5);
        for (let i = 0; i < 4; i++) {
            this.conditions.set(shuffled[i], i < 2 ? 'time_pressure' : 'time_delay');
        }
    }

    markPlayerDisconnected(playerId) {
        // Mark as disconnected but don't remove immediately
        this.disconnectedPlayers.set(playerId, new Date().toISOString());
        
        // Set timeout to remove player after 5 minutes
        const timeout = setTimeout(() => {
            this.removePlayerPermanently(playerId);
        }, 5 * 60 * 1000); // 5 minutes
        
        this.disconnectionTimeouts.set(playerId, timeout);
        
        console.log(`Player ${playerId.substring(0, 8)} marked as disconnected in room ${this.id.substring(0, 8)}`);
    }

    removePlayerPermanently(playerId) {
        console.log(`Permanently removing player ${playerId.substring(0, 8)} from room ${this.id.substring(0, 8)}`);
        
        this.players = this.players.filter(p => p.id !== playerId);
        this.consentGiven.delete(playerId);
        this.demographics.delete(playerId);
        this.conditions.delete(playerId);
        this.contributions.delete(playerId);
        this.intendedContributions.delete(playerId);
        this.timeoutStatus.delete(playerId);
        this.decisionTimes.delete(playerId);
        this.comprehensionAnswers.delete(playerId);
        this.comprehensionCompleted.delete(playerId);
        this.participantNames.delete(playerId);
        this.participantEmails.delete(playerId);
        this.instructionsTimes.delete(playerId);
        this.timestamps.delete(playerId);
        this.userAgents.delete(playerId);
        this.ipAddresses.delete(playerId);
        this.playerStates.delete(playerId);
        this.disconnectedPlayers.delete(playerId);
        this.readyPlayers.delete(playerId);
        
        // Clear any timeout
        if (this.disconnectionTimeouts.has(playerId)) {
            clearTimeout(this.disconnectionTimeouts.get(playerId));
            this.disconnectionTimeouts.delete(playerId);
        }
        
        // Remove from persistent players map
        const email = this.participantEmails.get(playerId);
        if (email) {
            const persistentKey = `${email}_${this.id}`;
            persistentPlayers.delete(persistentKey);
        }
        
        if (this.players.length === 0) {
            this.status = 'empty';
        }
    }

    // Legacy method for compatibility
    removePlayer(playerId) {
        this.markPlayerDisconnected(playerId);
    }

    isFull() {
        return this.players.length === 4;
    }

    getConnectedPlayersCount() {
        return this.players.filter(p => !this.disconnectedPlayers.has(p.id)).length;
    }

    allPlayersConsented() {
        return this.consentGiven.size === 4 && Array.from(this.consentGiven.values()).every(consent => consent);
    }

    allPlayersDemographicsComplete() {
        return this.demographics.size === 4;
    }

    allPlayersContributed() {
        return this.contributions.size === 4;
    }

    allPlayersAnsweredComprehension() {
        return this.comprehensionCompleted.size === 4;
    }

    getConsentedPlayersCount() {
        return Array.from(this.consentGiven.values()).filter(consent => consent).length;
    }

    getDemographicsCompletedCount() {
        return this.demographics.size;
    }

    updatePlayerState(playerId, state) {
        this.playerStates.set(playerId, state);
        console.log(`Player ${playerId.substring(0, 8)} state updated to: ${state}`);
    }

    getPlayerState(playerId) {
        return this.playerStates.get(playerId) || 'waiting';
    }

    findPlayerByEmail(email) {
        for (let [playerId, playerEmail] of this.participantEmails.entries()) {
            if (playerEmail === email) {
                return this.players.find(p => p.id === playerId);
            }
        }
        return null;
    }

    calculatePayoffs() {
        const totalContribution = Array.from(this.contributions.values()).reduce((sum, c) => sum + c, 0);
        const doubledPool = totalContribution * 2;
        const equalShare = doubledPool / 4;

        const payoffs = new Map();
        this.players.forEach(player => {
            const contribution = this.contributions.get(player.id);
            const kept = 10 - contribution; // Each player starts with 10 credits
            const creditsWon = Math.floor(kept + equalShare);
            // Calculate lottery tickets based on credit ranges
            let lotteryTickets;
            if (creditsWon >= 21) {
                lotteryTickets = 3;
            } else if (creditsWon >= 15) {
                lotteryTickets = 2;
            } else if (creditsWon >= 10) {
                lotteryTickets = 1;
            } else {
                lotteryTickets = 0;
            }
            
            payoffs.set(player.id, {
                contribution,
                kept,
                equalShare,
                creditsWon,
                lotteryTickets
            });
        });

        return payoffs;
    }

    broadcast(event, data) {
        this.players.forEach(player => {
            player.socket.emit(event, data);
        });
    }

    broadcastConsentStatus() {
        const consentedCount = this.getConsentedPlayersCount();
        this.broadcast('consent-count-update', {
            consentedPlayers: consentedCount,
            totalPlayers: 4
        });
    }

    broadcastDemographicsStatus() {
        const completedCount = this.getDemographicsCompletedCount();
        this.broadcast('demographics-count-update', {
            completedPlayers: completedCount,
            totalPlayers: 4
        });
    }

    broadcastComprehensionStatus() {
        const completedCount = this.comprehensionCompleted.size;
        this.broadcast('comprehension-status', {
            completedPlayers: completedCount,
            totalPlayers: 4,
            waitingForOthers: completedCount < 4
        });
    }
}

function findOrCreateRoom() {
    // Find a room that's waiting and not full
    for (let room of rooms.values()) {
        if (room.status === 'waiting' && !room.isFull()) {
            return room;
        }
    }

    // Create new room
    const roomId = uuidv4();
    const room = new GameRoom(roomId);
    rooms.set(roomId, room);
    
    // Insert room into database
    db.run('INSERT INTO groups (id) VALUES (?)', [roomId]);
    
    return room;
}

function findExistingPlayerSession(email) {
    // Look for existing player session by email
    for (let [persistentKey, playerData] of persistentPlayers.entries()) {
        if (playerData.email === email) {
            const room = rooms.get(playerData.roomId);
            if (room && room.status !== 'empty') {
                return { room, playerId: playerData.playerId, playerData };
            }
        }
    }
    return null;
}

function findActiveRoomsWithDisconnectedPlayer(email) {
    // Find rooms where this email exists but player is disconnected
    for (let room of rooms.values()) {
        if (room.status !== 'empty') {
            const existingPlayer = room.findPlayerByEmail(email);
            if (existingPlayer && room.disconnectedPlayers.has(existingPlayer.id)) {
                return { room, playerId: existingPlayer.id };
            }
        }
    }
    return null;
}

io.on('connection', (socket) => {
    console.log('New player connected:', socket.id);

    socket.on('join-game', (playerData) => {
        const email = playerData.email || '';
        
        // Check for existing disconnected player first
        const existingDisconnected = findActiveRoomsWithDisconnectedPlayer(email);
        
        if (existingDisconnected) {
            // RECONNECTION CASE - player is reconnecting to existing game
            const { room, playerId } = existingDisconnected;
            
            console.log(`🔄 Reconnecting player ${playerId.substring(0, 8)} to room ${room.id.substring(0, 8)} (room status: ${room.status})`);
            
            // Reconnect the player
            if (room.addPlayer(playerId, socket, true)) {
                socket.join(room.id);
                players.set(socket.id, { playerId, roomId: room.id });
                
                // Get player's current state (default to room status if no specific state)
                let currentState = room.getPlayerState(playerId);
                if (!currentState || currentState === 'waiting') {
                    // Map room status to appropriate player state
                    switch (room.status) {
                        case 'waiting':
                            currentState = 'waiting';
                            break;
                        case 'consent':
                            currentState = 'consent';
                            break;
                        case 'demographics':
                            currentState = 'demographics';
                            break;
                        case 'instructions':
                            currentState = 'instructions';
                            break;
                        case 'playing':
                            currentState = 'contribution';
                            break;
                        case 'comprehension':
                            currentState = 'comprehension';
                            break;
                        case 'results':
                            currentState = 'results';
                            break;
                        default:
                            currentState = 'waiting';
                    }
                    room.updatePlayerState(playerId, currentState);
                }
                
                const playerNumber = room.players.findIndex(p => p.id === playerId) + 1;
                
                console.log(`📍 Player reconnected to state: ${currentState}`);
                
                // Send reconnection data
                socket.emit('player-reconnected', {
                    playerId,
                    roomId: room.id,
                    playerNumber,
                    playersCount: room.getConnectedPlayersCount(),
                    condition: room.conditions.get(playerId),
                    currentState,
                    roomStatus: room.status,
                    existingData: {
                        name: room.participantNames.get(playerId),
                        email: room.participantEmails.get(playerId),
                        consent: room.consentGiven.get(playerId),
                        demographics: room.demographics.get(playerId),
                        contribution: room.contributions.get(playerId),
                        comprehension: room.comprehensionAnswers.get(playerId)
                    }
                });
                
                // Notify other connected players about reconnection
                room.players.forEach(player => {
                    if (player.id !== playerId && !room.disconnectedPlayers.has(player.id)) {
                        player.socket.emit('player-reconnected-notification', {
                            message: 'Ayrılan oyuncu geri döndü!',
                            connectedPlayers: room.getConnectedPlayersCount()
                        });
                    }
                });
                
                // Update player counts for waiting screen
                if (room.status === 'waiting') {
                    room.broadcast('player-count-update', { playersCount: room.getConnectedPlayersCount() });
                }
                
                // Log reconnection
                db.run(`INSERT INTO interactions (id, player_id, group_id, action_type, action_data) 
                        VALUES (?, ?, ?, ?, ?)`,
                    [uuidv4(), playerId, room.id, 'player_reconnected', JSON.stringify({
                        reconnectionTime: new Date().toISOString(),
                        previousState: currentState,
                        roomStatus: room.status,
                        email: email
                    })]);
                
                console.log(`✅ Player ${playerId.substring(0, 8)} successfully reconnected to ${currentState}`);
                return; // Exit early for reconnection case
            } else {
                console.log(`❌ Failed to reconnect player ${playerId.substring(0, 8)} to room ${room.id.substring(0, 8)}`);
            }
        }
        
        // NEW PLAYER CASE - no existing session found
        const playerId = uuidv4();
        const room = findOrCreateRoom();

        if (room.addPlayer(playerId, socket)) {
            socket.join(room.id);
            players.set(socket.id, { playerId, roomId: room.id });

            // Store participant data
            room.participantNames.set(playerId, playerData.name || 'Anonymous');
            room.participantEmails.set(playerId, email);
            room.userAgents.set(playerId, socket.handshake.headers['user-agent'] || '');
            room.ipAddresses.set(playerId, socket.handshake.address || socket.conn.remoteAddress || '');
            room.timestamps.set(playerId, { joined: new Date().toISOString() });
            
            // Store in persistent players map
            const persistentKey = `${email}_${room.id}`;
            persistentPlayers.set(persistentKey, {
                playerId,
                roomId: room.id,
                email,
                name: playerData.name
            });

            // If room is now full, assign balanced conditions immediately
            if (room.isFull()) {
                console.log(`🎯 Room ${room.id.substring(0, 8)} is full! Assigning conditions...`);
                room.assignBalancedConditions();
                room.status = 'consent';
                
                // Debug: Show all assigned conditions
                console.log('🔍 Assigned conditions:');
                room.players.forEach(player => {
                    console.log(`  Player ${player.id.substring(0, 8)}: ${room.conditions.get(player.id)}`);
                });
                
                // Update all existing players with their newly assigned conditions
                room.players.forEach(player => {
                    console.log(`📤 Sending condition-assigned to Player ${player.id.substring(0, 8)}: ${room.conditions.get(player.id)}`);
                    player.socket.emit('condition-assigned', {
                        condition: room.conditions.get(player.id)
                    });
                });
            }

            // Log interaction (now with correct condition)
            db.run(`INSERT INTO interactions (id, player_id, group_id, action_type, action_data) 
                    VALUES (?, ?, ?, ?, ?)`,
                [uuidv4(), playerId, room.id, 'join_game', JSON.stringify({
                    name: playerData.name,
                    email: playerData.email,
                    condition: room.conditions.get(playerId),
                    userAgent: socket.handshake.headers['user-agent'],
                    ip: socket.handshake.address
                })]);

            console.log(`Player ${playerId.substring(0, 8)} joined room ${room.id.substring(0, 8)}. Players: ${room.players.length}/4. Condition: ${room.conditions.get(playerId)}`);

            // Send initial data to player (now with correct condition)
            socket.emit('joined-room', {
                playerId,
                roomId: room.id,
                playerNumber: room.players.length,
                playersCount: room.players.length,
                condition: room.conditions.get(playerId)
            });

            // Broadcast updated player count
            room.broadcast('player-count-update', { playersCount: room.players.length });

            // If room was just filled, start consent phase
            if (room.isFull() && room.status === 'consent') {
                console.log(`📋 Starting consent phase for room ${room.id.substring(0, 8)}`);
                setTimeout(() => {
                    room.broadcast('room-full-start-consent', {});
                }, 1000);
            }
        } else {
            socket.emit('room-full', { message: 'Oda dolu veya oyun başlamış.' });
        }
    });

    socket.on('submit-consent', (data) => {
        const playerInfo = players.get(socket.id);
        if (!playerInfo) return;

        const room = rooms.get(playerInfo.roomId);
        if (!room) return;

        room.consentGiven.set(playerInfo.playerId, data.consentGiven);
        room.updatePlayerState(playerInfo.playerId, 'demographics');
        
        // Update timestamp
        const timestamps = room.timestamps.get(playerInfo.playerId) || {};
        timestamps.consent = new Date().toISOString();
        room.timestamps.set(playerInfo.playerId, timestamps);

        // Log interaction
        db.run(`INSERT INTO interactions (id, player_id, group_id, action_type, action_data) 
                VALUES (?, ?, ?, ?, ?)`,
            [uuidv4(), playerInfo.playerId, room.id, 'submit_consent', JSON.stringify(data)]);

        // No group waiting, just acknowledge
        socket.emit('consent-received', { success: true });

        // If all players have finished demographics, move to instructions
        // (handled in demographics handler)
    });

    socket.on('submit-demographics', (data) => {
        const playerInfo = players.get(socket.id);
        if (!playerInfo) return;

        const room = rooms.get(playerInfo.roomId);
        if (!room) return;

        room.demographics.set(playerInfo.playerId, data);
        room.updatePlayerState(playerInfo.playerId, 'waiting-experiment');
        
        // Update timestamp
        const timestamps = room.timestamps.get(playerInfo.playerId) || {};
        timestamps.demographics = new Date().toISOString();
        room.timestamps.set(playerInfo.playerId, timestamps);

        // Log interaction
        db.run(`INSERT INTO interactions (id, player_id, group_id, action_type, action_data) 
                VALUES (?, ?, ?, ?, ?)`,
            [uuidv4(), playerInfo.playerId, room.id, 'submit_demographics', JSON.stringify(data)]);

        socket.emit('demographics-received', { success: true });

        // If all players have finished demographics, start instructions for all
        if (room.allPlayersDemographicsComplete()) {
            console.log(`📚 All players completed demographics! Starting instructions phase for room ${room.id.substring(0, 8)}`);
            room.status = 'instructions';
            setTimeout(() => {
                // Set instruction start timestamps for all players
                room.players.forEach(player => {
                    const timestamps = room.timestamps.get(player.id) || {};
                    timestamps.instructionsStart = new Date().toISOString();
                    room.timestamps.set(player.id, timestamps);
                    room.updatePlayerState(player.id, 'instructions');
                });
                console.log(`📝 Broadcasting start-instructions-phase to all players in room ${room.id.substring(0, 8)}`);
                room.broadcast('start-instructions-phase', {});
            }, 1000);
        } else {
            console.log(`📊 Demographics progress: ${room.demographics.size}/4 players completed`);
        }
    });

    socket.on('ready-to-play', () => {
        const playerInfo = players.get(socket.id);
        if (!playerInfo) {
            console.log('❌ ready-to-play: No player info found');
            return;
        }

        const room = rooms.get(playerInfo.roomId);
        if (!room) {
            console.log('❌ ready-to-play: No room found');
            return;
        }
        
        if (room.status !== 'instructions') {
            console.log(`❌ ready-to-play: Room status is '${room.status}', expected 'instructions'`);
            return;
        }

        // Mark this player as ready
        room.readyPlayers.add(playerInfo.playerId);
        room.updatePlayerState(playerInfo.playerId, 'waiting-group-start');
        
        console.log(`✅ Player ${playerInfo.playerId.substring(0, 8)} is ready. Total ready: ${room.readyPlayers.size}/4`);

        // Record instructions time
        const timestamps = room.timestamps.get(playerInfo.playerId) || {};
        const instructionsTime = timestamps.instructionsStart ? 
            Date.now() - new Date(timestamps.instructionsStart).getTime() : 0;
        room.instructionsTimes.set(playerInfo.playerId, instructionsTime);

        // Log interaction
        db.run(`INSERT INTO interactions (id, player_id, group_id, action_type, action_data) 
                VALUES (?, ?, ?, ?, ?)`,
            [uuidv4(), playerInfo.playerId, room.id, 'ready_to_play', JSON.stringify({ instructionsTime })]);

        // If all players are ready, start the contribution phase for all
        if (room.readyPlayers.size === 4) {
            console.log('🎮 All players ready! Starting contribution phase...');
            room.status = 'playing';
            room.players.forEach(player => {
                const condition = room.conditions.get(player.id);
                room.updatePlayerState(player.id, 'contribution');
                player.socket.emit('start-contribution-phase', { 
                    condition: condition,
                    timeLimit: condition === 'time_pressure' ? 10 : null,
                    minTime: condition === 'time_delay' ? 10 : null
                });
                // Set contribution start timestamp
                const timestamps = room.timestamps.get(player.id) || {};
                timestamps.contributionStart = new Date().toISOString();
                room.timestamps.set(player.id, timestamps);
                
                // Set up automatic submission for time_pressure players
                if (condition === 'time_pressure') {
                    setTimeout(() => {
                        // Check if player hasn't submitted yet
                        if (!room.contributions.has(player.id) && room.status === 'playing') {
                            console.log(`⏱️ Auto-submitting for time_pressure player ${player.id.substring(0, 8)} - time expired`);
                            
                            // Get intended contribution (slider value) or default to 0
                            const intendedContribution = room.intendedContributions.get(player.id) || 0;
                            
                            // Auto-submit with 0 contribution (policy), but track intended
                            room.contributions.set(player.id, 0);
                            room.intendedContributions.set(player.id, intendedContribution);
                            room.timeoutStatus.set(player.id, true); // Mark as timed out
                            room.decisionTimes.set(player.id, 10000); // Exactly 10 seconds
                            room.updatePlayerState(player.id, 'waiting-others');
                            
                            // Update timestamp
                            const timestamps = room.timestamps.get(player.id) || {};
                            timestamps.contribution = new Date().toISOString();
                            room.timestamps.set(player.id, timestamps);
                            
                            // Log the auto-submission
                            db.run(`INSERT INTO interactions (id, player_id, group_id, action_type, action_data) 
                                    VALUES (?, ?, ?, ?, ?)`,
                                [uuidv4(), player.id, room.id, 'auto_submit_contribution', JSON.stringify({
                                    contribution: 0,
                                    decisionTime: 10000,
                                    condition: condition,
                                    reason: 'time_expired'
                                })]);
                            
                            console.log(`Player ${player.id} auto-contributed 0 credits due to timeout (time_pressure) - intended: ${intendedContribution}`);
                            
                            // Notify the player
                            player.socket.emit('contribution-auto-submitted', { 
                                contribution: 0,
                                reason: 'Zaman doldu! Kararınız otomatik olarak gönderildi.' 
                            });
                            
                            // Update other players about progress
                            room.broadcast('waiting-for-others', { 
                                completedPlayers: room.contributions.size 
                            });
                            
                            // Check if all players have now contributed
                            if (room.allPlayersContributed()) {
                                room.status = 'comprehension';
                                room.players.forEach(p => room.updatePlayerState(p.id, 'comprehension'));
                                setTimeout(() => {
                                    room.broadcast('start-comprehension-phase', {});
                                }, 1000);
                            }
                        }
                    }, 10500); // 10.5 seconds to account for network delay
                }
            });
        } else {
            console.log(`📢 Broadcasting ready status: ${room.readyPlayers.size}/4 players ready`);
            // Not all ready, only notify the player who just clicked
            socket.emit('waiting-for-others-to-start', { readyCount: room.readyPlayers.size });
        }
    });

    // Track intended contribution (slider value changes)
    socket.on('update-intended-contribution', (data) => {
        const playerInfo = players.get(socket.id);
        if (!playerInfo) return;

        const room = rooms.get(playerInfo.roomId);
        if (!room || room.status !== 'playing') return;

        // Store the current slider value as intended contribution
        room.intendedContributions.set(playerInfo.playerId, data.intendedContribution);
    });

    socket.on('submit-contribution', (data) => {
        const playerInfo = players.get(socket.id);
        if (!playerInfo) return;

        const room = rooms.get(playerInfo.roomId);
        if (!room || room.status !== 'playing') return;

        const condition = room.conditions.get(playerInfo.playerId);
        const decisionTime = data.decisionTime;
        
        // Validate time constraints based on condition
        if (condition === 'time_pressure' && decisionTime > 10000) {
            socket.emit('contribution-rejected', { 
                reason: 'Zaman aşımı! Karar verme süreniz 10 saniyeyi aştı.' 
            });
            return;
        }
        
        if (condition === 'time_delay' && decisionTime < 10000) {
            socket.emit('contribution-rejected', { 
                reason: 'Lütfen en az 10 saniye düşünün!' 
            });
            return;
        }

        room.contributions.set(playerInfo.playerId, data.contribution);
        room.intendedContributions.set(playerInfo.playerId, data.contribution); // Same as actual for manual submissions
        room.timeoutStatus.set(playerInfo.playerId, false); // Not timed out
        room.decisionTimes.set(playerInfo.playerId, decisionTime);
        room.updatePlayerState(playerInfo.playerId, 'waiting-others');

        // Update timestamp
        const timestamps = room.timestamps.get(playerInfo.playerId) || {};
        timestamps.contribution = new Date().toISOString();
        room.timestamps.set(playerInfo.playerId, timestamps);

        // Log interaction
        db.run(`INSERT INTO interactions (id, player_id, group_id, action_type, action_data) 
                VALUES (?, ?, ?, ?, ?)`,
            [uuidv4(), playerInfo.playerId, room.id, 'submit_contribution', JSON.stringify({
                ...data,
                condition: condition
            })]);

        console.log(`Player ${playerInfo.playerId} contributed ${data.contribution} credits in ${decisionTime}ms (${condition})`);

        socket.emit('contribution-received', { success: true });

        // Update other players about progress
        room.broadcast('waiting-for-others', { 
            completedPlayers: room.contributions.size 
        });

        // Check if all players contributed
        if (room.allPlayersContributed()) {
            room.status = 'comprehension';
            room.players.forEach(p => room.updatePlayerState(p.id, 'comprehension'));
            setTimeout(() => {
                room.broadcast('start-comprehension-phase', {});
            }, 1000);
        }
    });

    socket.on('submit-comprehension', (data) => {
        const playerInfo = players.get(socket.id);
        if (!playerInfo) return;

        const room = rooms.get(playerInfo.roomId);
        if (!room || room.status !== 'comprehension') return;

        room.comprehensionAnswers.set(playerInfo.playerId, data);
        room.comprehensionCompleted.set(playerInfo.playerId, true);
        room.updatePlayerState(playerInfo.playerId, 'waiting-comprehension');

        // Update timestamp
        const timestamps = room.timestamps.get(playerInfo.playerId) || {};
        timestamps.comprehension = new Date().toISOString();
        room.timestamps.set(playerInfo.playerId, timestamps);

        // Log interaction
        db.run(`INSERT INTO interactions (id, player_id, group_id, action_type, action_data) 
                VALUES (?, ?, ?, ?, ?)`,
            [uuidv4(), playerInfo.playerId, room.id, 'submit_comprehension', JSON.stringify(data)]);

        console.log(`Player ${playerInfo.playerId} answered comprehension questions`);

        // Check comprehension answers and provide feedback
        const correctAnswers = {
            q1: '10',
            q2: 'depends'
        };
        
        const feedback = {
            q1: {
                userAnswer: data.q1,
                correct: data.q1 === correctAnswers.q1,
                correctAnswer: correctAnswers.q1,
                explanation: 'Herkes 10 kredi katkıda bulunursa grup geneli için en yüksek kazancı sağlar (toplam 80 kredi).'
            },
            q2: {
                userAnswer: data.q2,
                correct: data.q2 === correctAnswers.q2,
                correctAnswer: correctAnswers.q2,
                explanation: 'Kişisel olarak en yüksek kazancınız diğerlerinin katkısına bağlıdır - eğer herkes katkıda bulunur ama siz bulunmazsanız en fazla kazanırsınız.'
            }
        };

        socket.emit('comprehension-feedback', { feedback });

        // Broadcast status to all players
        room.broadcastComprehensionStatus();

        // Check if all players answered
        if (room.allPlayersAnsweredComprehension()) {
            room.status = 'results';
            setTimeout(() => {
                const payoffs = room.calculatePayoffs();
                
                // Send results to each player
                room.players.forEach(player => {
                    room.updatePlayerState(player.id, 'results');
                    const playerPayoff = payoffs.get(player.id);
                    const allContributions = Array.from(room.contributions.values());
                    
                    player.socket.emit('game-results', {
                        yourContribution: playerPayoff.contribution,
                        yourKept: playerPayoff.kept,
                        yourShare: playerPayoff.equalShare,
                        yourCreditsWon: playerPayoff.creditsWon,
                        yourLotteryTickets: playerPayoff.lotteryTickets,
                        allContributions: allContributions,
                        totalPool: allContributions.reduce((sum, c) => sum + c, 0) * 2
                    });
                });

                // Save session data to database
                saveSessionData(room, payoffs);
            }, 1000);
        }
    });

    socket.on('complete-experiment', () => {
        const playerInfo = players.get(socket.id);
        if (!playerInfo) return;

        const room = rooms.get(playerInfo.roomId);
        if (!room) return;

        room.updatePlayerState(playerInfo.playerId, 'final');

        // Update completion timestamp
        const timestamps = room.timestamps.get(playerInfo.playerId) || {};
        timestamps.completion = new Date().toISOString();
        room.timestamps.set(playerInfo.playerId, timestamps);

        // Log interaction
        db.run(`INSERT INTO interactions (id, player_id, group_id, action_type, action_data) 
                VALUES (?, ?, ?, ?, ?)`,
            [uuidv4(), playerInfo.playerId, room.id, 'complete_experiment', JSON.stringify({
                completionTime: timestamps.completion
            })]);

        socket.emit('experiment-complete', { 
            message: 'Deney tamamlandı! Teşekkürler.' 
        });
    });

    socket.on('disconnect', () => {
        const playerInfo = players.get(socket.id);
        if (playerInfo) {
            const room = rooms.get(playerInfo.roomId);
            if (room) {
                // Use graceful disconnection instead of immediate removal
                room.markPlayerDisconnected(playerInfo.playerId);
                
                // Notify other connected players
                const connectedCount = room.getConnectedPlayersCount();
                if (connectedCount > 0) {
                    room.players.forEach(player => {
                        if (!room.disconnectedPlayers.has(player.id)) {
                            player.socket.emit('player-disconnected', {
                                playersCount: connectedCount,
                                totalPlayers: room.players.length,
                                message: 'Bir oyuncu bağlantısı kesildi. 3 dakika içinde geri dönebilir.'
                            });
                        }
                    });
                }
                
                // Clean up empty rooms only if no players left at all
                if (room.status === 'empty') {
                    rooms.delete(playerInfo.roomId);
                    
                    // Clean up persistent players for this room
                    for (let [key, data] of persistentPlayers.entries()) {
                        if (data.roomId === playerInfo.roomId) {
                            persistentPlayers.delete(key);
                        }
                    }
                }
            }
            players.delete(socket.id);
        }
        console.log('Player disconnected:', socket.id);
    });
});

function saveSessionData(room, payoffs) {
    const sessionId = uuidv4();
    
    room.players.forEach(player => {
        const playerPayoff = payoffs.get(player.id);
        const demographics = room.demographics.get(player.id) || {};
        const timestamps = room.timestamps.get(player.id) || {};
        const consent = room.consentGiven.get(player.id);
        const condition = room.conditions.get(player.id);
        const comprehension = room.comprehensionAnswers.get(player.id) || {};
        
        const sessionDuration = timestamps.completion && timestamps.joined ? 
            new Date(timestamps.completion).getTime() - new Date(timestamps.joined).getTime() : null;

        db.run(`INSERT INTO sessions (
            id, player_id, group_id, participant_name, participant_email, condition, consent_given,
            contribution, intended_contribution, timed_out, decision_time, credits_won, lottery_tickets,
            comprehension_q1, comprehension_q2, age, gender, major,
            instructions_time, consent_timestamp, demographics_timestamp,
            contribution_timestamp, comprehension_timestamp, completion_timestamp,
            user_agent, ip_address, session_duration, browser_info, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            uuidv4(), player.id, room.id, 
            room.participantNames.get(player.id),
            room.participantEmails.get(player.id),
            condition,
            consent ? 1 : 0,
            room.contributions.get(player.id),
            room.intendedContributions.get(player.id),
            room.timeoutStatus.get(player.id) ? 1 : 0,
            room.decisionTimes.get(player.id),
            playerPayoff.creditsWon,
            playerPayoff.lotteryTickets,
            comprehension.q1, comprehension.q2,
            demographics.age, demographics.gender, demographics.major,
            room.instructionsTimes.get(player.id),
            timestamps.consent,
            timestamps.demographics,
            timestamps.contribution,
            timestamps.comprehension,
            timestamps.completion,
            room.userAgents.get(player.id),
            room.ipAddresses.get(player.id),
            sessionDuration,
            JSON.stringify({ userAgent: room.userAgents.get(player.id) }),
            new Date().toISOString()
        ]);
    });

    // Update group summary
    const totalContribution = Array.from(room.contributions.values()).reduce((sum, c) => sum + c, 0);
    const totalCredits = Array.from(payoffs.values()).reduce((sum, p) => sum + p.creditsWon, 0);
    const avgDecisionTime = Array.from(room.decisionTimes.values()).reduce((sum, t) => sum + t, 0) / room.decisionTimes.size;

    db.run(`UPDATE groups SET 
            status = 'completed',
            total_contribution = ?,
            total_credits_distributed = ?,
            end_time = CURRENT_TIMESTAMP,
            completion_rate = 1.0,
            avg_decision_time = ?
            WHERE id = ?`,
        [totalContribution, totalCredits, Math.round(avgDecisionTime), room.id]);

    console.log(`Session completed for room ${room.id}. Total contribution: ${totalContribution} credits`);
}

// API Routes for data export and admin functionality (protected with authentication)
app.get('/api/export-data', basicAuth, (req, res) => {
    db.all(`SELECT s.*, g.total_contribution, g.avg_decision_time, g.completion_rate, g.end_time as group_end_time
            FROM sessions s 
            LEFT JOIN groups g ON s.group_id = g.id 
            ORDER BY s.created_at DESC`, [], (err, rows) => {
        if (err) {
            console.error('Error exporting data:', err);
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

app.delete('/api/delete-all-data', basicAuth, (req, res) => {
    db.serialize(() => {
        db.run('DELETE FROM sessions');
        db.run('DELETE FROM groups');
        db.run('DELETE FROM interactions');
        db.run('VACUUM'); // Reclaim space
    });
    
    console.log('All experiment data deleted');
    res.json({ success: true, message: 'Tüm veriler silindi' });
});

// API endpoints for data export and analysis
app.get('/api/export-interactions', basicAuth, (req, res) => {
    db.all('SELECT * FROM interactions ORDER BY timestamp DESC', (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

app.get('/api/export-groups', basicAuth, (req, res) => {
    db.all('SELECT * FROM groups ORDER BY created_at DESC', (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

app.get('/api/stats', basicAuth, (req, res) => {
    db.all(`
        SELECT 
            COUNT(*) as totalSessions,
            AVG(contribution) as avgContribution,
            AVG(decision_time) as avgDecisionTime,
            AVG(credits_won) as avgCredits,
            AVG(instructions_time) as avgInstructionsTime,
            AVG(session_duration) as avgSessionDuration,
            COUNT(DISTINCT group_id) as totalGroups,
            AVG(lottery_tickets) as avgLotteryTickets
        FROM sessions WHERE contribution IS NOT NULL
    `, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows[0]);
    });
});

app.get('/api/correlation-analysis', basicAuth, (req, res) => {
    db.all(`
        SELECT 
            decision_time,
            contribution,
            age,
            gender,
            instructions_time,
            session_duration
        FROM sessions 
        WHERE contribution IS NOT NULL AND decision_time IS NOT NULL
    `, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

app.get('/api/group-analysis', basicAuth, (req, res) => {
    db.all(`
        SELECT 
            group_id,
            COUNT(*) as group_size,
            AVG(contribution) as avg_contribution,
            SUM(contribution) as total_contribution,
            AVG(decision_time) as avg_decision_time,
            AVG(payoff) as avg_payoff,
            MIN(created_at) as session_start,
            MAX(created_at) as session_end
        FROM sessions 
        WHERE contribution IS NOT NULL
        GROUP BY group_id
        ORDER BY session_start DESC
    `, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🎮 Public Goods Experiment Server running on http://localhost:${PORT}`);
    console.log('💾 Database: experiment_data.db');
    console.log('📊 Access data export at: http://localhost:3000/api/export-data');
}); 