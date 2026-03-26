const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));

let gameState = 'LOBBY'; // LOBBY or PLAYING
let wave = 0;
let players = {};
let apples = [];
let enemyBullets = [];

// Game Constants
const BASE_X = 400;
const BASE_Y = 300;
const BASE_RADIUS = 80;

io.on('connection', (socket) => {
    // 1. Player Joins
    players[socket.id] = { id: socket.id, x: 400, y: 300, hp: 100, name: "Orange" };
    socket.emit('init', { id: socket.id, state: gameState, wave: wave });

    // 2. Admin Starts the Game
    socket.on('tryStart', (code) => {
        if (code === 'ORANGE123' && gameState === 'LOBBY') {
            gameState = 'PLAYING';
            wave = 1;
            spawnWave();
            io.emit('gameStarted', wave);
        }
    });

    // 3. Movement & Healing
    socket.on('move', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            
            // Healing Mechanic: If inside the base, heal slowly
            const distToBase = Math.hypot(data.x - BASE_X, data.y - BASE_Y);
            if (distToBase < BASE_RADIUS && players[socket.id].hp < 100) {
                players[socket.id].hp += 0.5; // Heal rate
            }
        }
    });

    // 4. Player Shooting
    socket.on('shoot', (data) => {
        // Broadcast player bullet to everyone to draw it
        socket.broadcast.emit('playerBullet', data);
    });

    // 5. Apple takes damage
    socket.on('hitApple', (appleId) => {
        const index = apples.findIndex(a => a.id === appleId);
        if (index !== -1) {
            apples[index].hp -= 25;
            if (apples[index].hp <= 0) apples.splice(index, 1);
            
            // Next Wave Check
            if (apples.length === 0 && gameState === 'PLAYING') {
                wave++;
                setTimeout(spawnWave, 3000); // 3 second rest between waves
                io.emit('updateWave', wave);
            }
        }
    });

    socket.on('disconnect', () => delete players[socket.id]);
});

// --- SERVER AI LOOP (Runs 20 times a second) ---
function spawnWave() {
    apples = [];
    const numApples = wave * 5; // Gets harder every wave
    for (let i = 0; i < numApples; i++) {
        // Spawn randomly along the edges
        const isVertical = Math.random() > 0.5;
        apples.push({
            id: Math.random().toString(),
            x: isVertical ? Math.random() * 800 : (Math.random() > 0.5 ? 0 : 800),
            y: isVertical ? (Math.random() > 0.5 ? 0 : 600) : Math.random() * 600,
            hp: 50
        });
    }
}

setInterval(() => {
    if (gameState !== 'PLAYING') return;

    // Move Apples toward the Base
    apples.forEach(apple => {
        const angle = Math.atan2(BASE_Y - apple.y, BASE_X - apple.x);
        apple.x += Math.cos(angle) * 1.5; // Apple speed
        apple.y += Math.sin(angle) * 1.5;

        // Apples Shoot at random
        if (Math.random() < 0.01) { 
            enemyBullets.push({
                x: apple.x, y: apple.y,
                vx: Math.cos(angle) * 5, vy: Math.sin(angle) * 5
            });
        }
    });

    // Move Enemy Bullets
    enemyBullets.forEach(b => {
        b.x += b.vx;
        b.y += b.vy;
        
        // Check if bullet hits any player
        Object.values(players).forEach(p => {
            if (Math.hypot(b.x - p.x, b.y - p.y) < 20) {
                p.hp -= 10;
                b.dead = true;
            }
        });
    });
    enemyBullets = enemyBullets.filter(b => !b.dead);

    // Sync state to all clients
    io.emit('syncState', { players, apples, enemyBullets });
}, 50);

server.listen(process.env.PORT || 3000, () => console.log("Orange Swarm Server Running"));