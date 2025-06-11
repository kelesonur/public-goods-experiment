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
app.use(express.static('public'));
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('experiment_data.db');

// Create tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        player_id TEXT,
        group_id TEXT,
        participant_name TEXT,
        contribution INTEGER,
        decision_time INTEGER,
        payoff REAL,
        comprehension_q1 INTEGER,
        comprehension_q2 INTEGER,
        age INTEGER,
        gender TEXT,
        major TEXT,
        instructions_time INTEGER,
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
});

// Game state management
const rooms = new Map();
const players = new Map();

class GameRoom {
    constructor(id) {
        this.id = id;
        this.players = [];
        this.status = 'waiting'; // waiting, instructions, playing, comprehension, results
        this.contributions = new Map();
        this.decisionTimes = new Map();
        this.comprehensionAnswers = new Map();
        this.demographics = new Map();
        this.participantNames = new Map();
        this.instructionsTimes = new Map();
        this.timestamps = new Map();
        this.userAgents = new Map();
        this.ipAddresses = new Map();
        this.startTime = null;
        this.instructionsStartTime = null;
        this.createdAt = new Date().toISOString();
    }

    addPlayer(playerId, socket) {
        if (this.players.length < 4 && this.status === 'waiting') {
            this.players.push({ id: playerId, socket });
            return true;
        }
        return false;
    }

    removePlayer(playerId) {
        this.players = this.players.filter(p => p.id !== playerId);
        if (this.players.length === 0) {
            this.status = 'empty';
        }
    }

    isFull() {
        return this.players.length === 4;
    }

    allPlayersContributed() {
        return this.contributions.size === 4;
    }

    allPlayersAnsweredComprehension() {
        return this.comprehensionAnswers.size === 4;
    }

    calculatePayoffs() {
        const totalContribution = Array.from(this.contributions.values()).reduce((sum, c) => sum + c, 0);
        const doubledPool = totalContribution * 2;
        const equalShare = doubledPool / 4;

        const payoffs = new Map();
        this.players.forEach(player => {
            const contribution = this.contributions.get(player.id);
            const kept = 20 - contribution; // Each player starts with 20 TL
            const payoff = kept + equalShare;
            payoffs.set(player.id, {
                contribution,
                kept,
                equalShare,
                totalPayoff: payoff
            });
        });

        return payoffs;
    }

    broadcast(event, data) {
        this.players.forEach(player => {
            player.socket.emit(event, data);
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

io.on('connection', (socket) => {
    console.log('New player connected:', socket.id);

    socket.on('join-game', (playerData) => {
        const playerId = uuidv4();
        const room = findOrCreateRoom();

        if (room.addPlayer(playerId, socket)) {
            socket.join(room.id);
            players.set(socket.id, { playerId, roomId: room.id });

            // Store participant data
            room.participantNames.set(playerId, playerData.name || 'Anonymous');
            room.userAgents.set(playerId, socket.handshake.headers['user-agent'] || '');
            room.ipAddresses.set(playerId, socket.handshake.address || socket.conn.remoteAddress || '');
            room.timestamps.set(playerId, { joined: new Date().toISOString() });

            // Log interaction
            db.run(`INSERT INTO interactions (id, player_id, group_id, action_type, action_data) 
                    VALUES (?, ?, ?, ?, ?)`,
                [uuidv4(), playerId, room.id, 'join_game', JSON.stringify({
                    name: playerData.name,
                    userAgent: socket.handshake.headers['user-agent'],
                    ip: socket.handshake.address
                })]);

            console.log(`Player ${playerId} joined room ${room.id}. Players: ${room.players.length}/4`);

            // Send initial data to player
            socket.emit('joined-room', {
                playerId,
                roomId: room.id,
                playersCount: room.players.length,
                playerNumber: room.players.length
            });

            // Update all players in room about player count
            room.broadcast('player-count-update', {
                playersCount: room.players.length,
                status: room.status
            });

            // If room is full, start the game
            if (room.isFull()) {
                console.log(`Room ${room.id} is full. Starting game.`);
                room.status = 'instructions';
                room.instructionsStartTime = Date.now();
                
                // Update group start time
                db.run(`UPDATE groups SET start_time = ? WHERE id = ?`, 
                    [new Date().toISOString(), room.id]);
                
                room.broadcast('game-starting', {
                    message: 'Oyun başlıyor! Lütfen talimatları okuyun.'
                });
            }
        } else {
            socket.emit('room-full', { message: 'Oda dolu, yeni oda aranıyor...' });
        }
    });

    socket.on('ready-to-play', () => {
        const playerInfo = players.get(socket.id);
        if (!playerInfo) return;

        const room = rooms.get(playerInfo.roomId);
        if (!room) return;

        // Store instructions completion time
        const instructionsTime = Date.now() - room.instructionsStartTime;
        room.instructionsTimes.set(playerInfo.playerId, instructionsTime);
        
        // Log interaction
        db.run(`INSERT INTO interactions (id, player_id, group_id, action_type, action_data) 
                VALUES (?, ?, ?, ?, ?)`,
            [uuidv4(), playerInfo.playerId, room.id, 'ready_to_play', JSON.stringify({
                instructionsTime: instructionsTime
            })]);

        // Check if all players are ready
        room.status = 'playing';
        room.startTime = Date.now();
        
        room.broadcast('start-contribution-phase', {
            message: 'Katkı aşaması başlıyor!',
            startingAmount: 20
        });
    });

    socket.on('submit-contribution', (data) => {
        const playerInfo = players.get(socket.id);
        if (!playerInfo) return;

        const room = rooms.get(playerInfo.roomId);
        if (!room || room.status !== 'playing') return;

        const decisionTime = Date.now() - room.startTime;
        room.contributions.set(playerInfo.playerId, data.contribution);
        room.decisionTimes.set(playerInfo.playerId, decisionTime);
        
        // Store contribution timestamp
        const timestamps = room.timestamps.get(playerInfo.playerId) || {};
        timestamps.contribution = new Date().toISOString();
        room.timestamps.set(playerInfo.playerId, timestamps);

        // Log interaction
        db.run(`INSERT INTO interactions (id, player_id, group_id, action_type, action_data) 
                VALUES (?, ?, ?, ?, ?)`,
            [uuidv4(), playerInfo.playerId, room.id, 'submit_contribution', JSON.stringify({
                contribution: data.contribution,
                decisionTime: decisionTime,
                timestamp: new Date().toISOString()
            })]);

        console.log(`Player ${playerInfo.playerId} contributed ${data.contribution} TL in ${decisionTime}ms`);

        socket.emit('contribution-received', { success: true });
        
        room.broadcast('waiting-for-others', {
            completedPlayers: room.contributions.size,
            totalPlayers: 4
        });

        // If all players contributed, move to comprehension phase
        if (room.allPlayersContributed()) {
            room.status = 'comprehension';
            room.broadcast('start-comprehension', {
                message: 'Tüm oyuncular katkılarını yaptı. Şimdi anlama sorularına geçiyoruz.'
            });
        }
    });

    socket.on('submit-comprehension', (data) => {
        const playerInfo = players.get(socket.id);
        if (!playerInfo) return;

        const room = rooms.get(playerInfo.roomId);
        if (!room || room.status !== 'comprehension') return;

        room.comprehensionAnswers.set(playerInfo.playerId, {
            q1: data.q1, // What contribution level earns highest payoff for the group?
            q2: data.q2  // What contribution level earns highest payoff for you personally?
        });

        socket.emit('comprehension-received', { success: true });

        // If all players answered, show results
        if (room.allPlayersAnsweredComprehension()) {
            const payoffs = room.calculatePayoffs();
            room.status = 'results';

            // Save comprehensive data to database
            room.players.forEach(player => {
                const contribution = room.contributions.get(player.id);
                const decisionTime = room.decisionTimes.get(player.id);
                const payoff = payoffs.get(player.id);
                const comprehension = room.comprehensionAnswers.get(player.id);
                const participantName = room.participantNames.get(player.id);
                const instructionsTime = room.instructionsTimes.get(player.id);
                const timestamps = room.timestamps.get(player.id) || {};
                const userAgent = room.userAgents.get(player.id);
                const ipAddress = room.ipAddresses.get(player.id);
                
                // Calculate session duration
                const joinTime = new Date(timestamps.joined).getTime();
                const currentTime = Date.now();
                const sessionDuration = currentTime - joinTime;

                timestamps.comprehension = new Date().toISOString();
                room.timestamps.set(player.id, timestamps);

                db.run(`INSERT INTO sessions 
                    (id, player_id, group_id, participant_name, contribution, decision_time, payoff, 
                     comprehension_q1, comprehension_q2, instructions_time, contribution_timestamp, 
                     comprehension_timestamp, user_agent, ip_address, session_duration, browser_info)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [uuidv4(), player.id, room.id, participantName, contribution, decisionTime, 
                     payoff.totalPayoff, comprehension.q1, comprehension.q2, instructionsTime,
                     timestamps.contribution, timestamps.comprehension, userAgent, ipAddress, 
                     sessionDuration, JSON.stringify({userAgent, screen: 'unknown'})]
                );
            });

            // Update group completion data
            const avgDecisionTime = Array.from(room.decisionTimes.values()).reduce((a, b) => a + b, 0) / 4;
            db.run(`UPDATE groups SET end_time = ?, completion_rate = ?, avg_decision_time = ? WHERE id = ?`,
                [new Date().toISOString(), 1.0, avgDecisionTime, room.id]);

            // Send results to all players
            room.players.forEach(player => {
                const playerPayoff = payoffs.get(player.id);
                player.socket.emit('game-results', {
                    yourContribution: playerPayoff.contribution,
                    yourKept: playerPayoff.kept,
                    totalPool: Array.from(room.contributions.values()).reduce((sum, c) => sum + c, 0) * 2,
                    yourShare: playerPayoff.equalShare,
                    yourTotalPayoff: playerPayoff.totalPayoff,
                    allContributions: Array.from(room.contributions.values())
                });
            });
        }
    });

    socket.on('submit-demographics', (data) => {
        const playerInfo = players.get(socket.id);
        if (!playerInfo) return;

        const room = rooms.get(playerInfo.roomId);
        if (room) {
            // Store final completion timestamp
            const timestamps = room.timestamps.get(playerInfo.playerId) || {};
            timestamps.completion = new Date().toISOString();
            room.timestamps.set(playerInfo.playerId, timestamps);
        }

        // Log final interaction
        db.run(`INSERT INTO interactions (id, player_id, group_id, action_type, action_data) 
                VALUES (?, ?, ?, ?, ?)`,
            [uuidv4(), playerInfo.playerId, playerInfo.roomId, 'submit_demographics', JSON.stringify(data)]);

        // Update database with demographics and final completion timestamp
        db.run(`UPDATE sessions SET age = ?, gender = ?, major = ?, completion_timestamp = ? WHERE player_id = ?`,
            [data.age, data.gender, data.major, new Date().toISOString(), playerInfo.playerId]
        );

        socket.emit('experiment-complete', {
            message: 'Deney tamamlandı! Katılımınız için teşekkürler.'
        });
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        
        const playerInfo = players.get(socket.id);
        if (playerInfo) {
            const room = rooms.get(playerInfo.roomId);
            if (room) {
                room.removePlayer(playerInfo.playerId);
                
                if (room.status === 'empty') {
                    rooms.delete(room.id);
                } else {
                    room.broadcast('player-disconnected', {
                        playersCount: room.players.length,
                        message: 'Bir oyuncu ayrıldı.'
                    });
                }
            }
            players.delete(socket.id);
        }
    });
});

// API endpoints for data export and analysis
app.get('/api/export-data', (req, res) => {
    db.all('SELECT * FROM sessions ORDER BY created_at DESC', (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

app.get('/api/export-interactions', (req, res) => {
    db.all('SELECT * FROM interactions ORDER BY timestamp DESC', (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

app.get('/api/export-groups', (req, res) => {
    db.all('SELECT * FROM groups ORDER BY created_at DESC', (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

app.get('/api/stats', (req, res) => {
    db.all(`
        SELECT 
            COUNT(*) as total_sessions,
            AVG(contribution) as avg_contribution,
            AVG(decision_time) as avg_decision_time,
            AVG(payoff) as avg_payoff,
            AVG(instructions_time) as avg_instructions_time,
            AVG(session_duration) as avg_session_duration,
            COUNT(DISTINCT group_id) as total_groups
        FROM sessions WHERE contribution IS NOT NULL
    `, (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows[0]);
    });
});

app.get('/api/correlation-analysis', (req, res) => {
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

app.get('/api/group-analysis', (req, res) => {
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