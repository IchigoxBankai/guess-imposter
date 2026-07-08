const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Load words
let words = [];
try {
  const wordsData = fs.readFileSync(path.join(__dirname, 'words.json'), 'utf8');
  words = JSON.parse(wordsData);
} catch (err) {
  console.error("Error reading words.json, using default fallback list", err);
  words = [
    { word1: "Apple", word2: "Mango" },
    { word1: "Dog", word2: "Wolf" },
    { word1: "Pizza", word2: "Burger" }
  ];
}

// In-memory room state
const rooms = {};

// Helper to generate a unique room code
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (rooms[code]);
  return code;
}

// Helper to clean up room timers
function clearRoomTimer(room) {
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }
}

io.on('connection', (socket) => {
  let currentRoomCode = null;
  let currentPlayerName = null;

  console.log(`User connected: ${socket.id}`);

  // Create a room
  socket.on('createRoom', ({ playerName }) => {
    if (!playerName || playerName.trim() === '') {
      socket.emit('errorMsg', 'Name is required');
      return;
    }

    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      code: roomCode,
      players: [],
      gameStarted: false,
      timerInterval: null,
      timeLeft: 300, // 5 minutes
      imposterId: null,
      wordPair: null
    };

    const player = {
      id: socket.id,
      name: playerName.trim(),
      isHost: true,
      word: null
    };

    rooms[roomCode].players.push(player);
    currentRoomCode = roomCode;
    currentPlayerName = player.name;

    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode, player });
    io.to(roomCode).emit('roomStateUpdate', {
      code: roomCode,
      players: rooms[roomCode].players,
      gameStarted: false
    });
  });

  // Create a Demo Room with 3 Bots and start immediately
  socket.on('createDemoRoom', ({ playerName }) => {
    if (!playerName || playerName.trim() === '') {
      playerName = 'Player';
    }

    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      code: roomCode,
      players: [],
      gameStarted: false,
      timerInterval: null,
      timeLeft: 300,
      imposterId: null,
      wordPair: null
    };

    const player = {
      id: socket.id,
      name: playerName.trim(),
      isHost: true,
      word: null
    };

    // Add real player and 3 bots
    rooms[roomCode].players.push(player);
    rooms[roomCode].players.push({ id: 'bot1', name: 'Bot Alpha', isHost: false, word: null });
    rooms[roomCode].players.push({ id: 'bot2', name: 'Bot Beta', isHost: false, word: null });
    rooms[roomCode].players.push({ id: 'bot3', name: 'Bot Gamma', isHost: false, word: null });

    currentRoomCode = roomCode;
    currentPlayerName = player.name;
    socket.join(roomCode);

    // Immediately start the game for the demo room
    const room = rooms[roomCode];
    const wordPair = words[Math.floor(Math.random() * words.length)];
    room.wordPair = wordPair;

    // Pick random imposter (could be player or one of the bots)
    const imposterIndex = Math.floor(Math.random() * room.players.length);
    const imposter = room.players[imposterIndex];
    room.imposterId = imposter.id;

    const coinFlip = Math.random() < 0.5;
    const commonWord = coinFlip ? wordPair.word1 : wordPair.word2;
    const imposterWord = coinFlip ? wordPair.word2 : wordPair.word1;

    room.players.forEach(p => {
      p.word = (p.id === room.imposterId) ? imposterWord : commonWord;
    });

    room.gameStarted = true;
    room.timeLeft = 300;

    clearRoomTimer(room);
    room.timerInterval = setInterval(() => {
      room.timeLeft--;
      io.to(roomCode).emit('timerUpdate', { timeLeft: room.timeLeft });

      if (room.timeLeft <= 0) {
        clearRoomTimer(room);
        io.to(roomCode).emit('timeUp');
      }
    }, 1000);

    socket.emit('gameStarted', {
      word: player.word,
      players: room.players.map(pl => ({ name: pl.name, isHost: pl.isHost })),
      timeLeft: room.timeLeft
    });
  });

  // Join a room
  socket.on('joinRoom', ({ roomCode, playerName }) => {
    if (!roomCode || !playerName || playerName.trim() === '') {
      socket.emit('errorMsg', 'Room code and name are required');
      return;
    }

    const code = roomCode.toUpperCase().trim();
    const room = rooms[code];

    if (!room) {
      socket.emit('errorMsg', 'Room not found');
      return;
    }

    if (room.gameStarted) {
      socket.emit('errorMsg', 'Game has already started');
      return;
    }

    // Check if player name already taken in room
    const nameExists = room.players.some(p => p.name.toLowerCase() === playerName.trim().toLowerCase());
    if (nameExists) {
      socket.emit('errorMsg', 'Name already taken in this room');
      return;
    }

    const player = {
      id: socket.id,
      name: playerName.trim(),
      isHost: false,
      word: null
    };

    room.players.push(player);
    currentRoomCode = code;
    currentPlayerName = player.name;

    socket.join(code);
    socket.emit('roomJoined', { roomCode: code, player });
    io.to(code).emit('roomStateUpdate', {
      code: code,
      players: room.players,
      gameStarted: false
    });
  });

  // Start the game
  socket.on('startGame', () => {
    if (!currentRoomCode) return;
    const room = rooms[currentRoomCode];
    if (!room) return;

    // Verify requesting player is the host
    const requester = room.players.find(p => p.id === socket.id);
    if (!requester || !requester.isHost) {
      socket.emit('errorMsg', 'Only the host can start the game');
      return;
    }

    if (room.players.length < 3) {
      socket.emit('errorMsg', 'Need at least 3 players to start the game');
      return;
    }

    // Select random word pair
    const wordPair = words[Math.floor(Math.random() * words.length)];
    room.wordPair = wordPair;

    // Select random imposter
    const imposterIndex = Math.floor(Math.random() * room.players.length);
    const imposter = room.players[imposterIndex];
    room.imposterId = imposter.id;

    // Decide which word is common and which is imposter word
    const coinFlip = Math.random() < 0.5;
    const commonWord = coinFlip ? wordPair.word1 : wordPair.word2;
    const imposterWord = coinFlip ? wordPair.word2 : wordPair.word1;

    // Assign words
    room.players.forEach(p => {
      p.word = (p.id === room.imposterId) ? imposterWord : commonWord;
    });

    room.gameStarted = true;
    room.timeLeft = 300; // Reset timer to 5 minutes

    // Start server-side countdown
    clearRoomTimer(room);
    room.timerInterval = setInterval(() => {
      room.timeLeft--;
      io.to(currentRoomCode).emit('timerUpdate', { timeLeft: room.timeLeft });

      if (room.timeLeft <= 0) {
        clearRoomTimer(room);
        io.to(currentRoomCode).emit('timeUp');
      }
    }, 1000);

    // Notify clients of game start, sending target words to each client individually
    room.players.forEach(p => {
      io.to(p.id).emit('gameStarted', {
        word: p.word,
        players: room.players.map(pl => ({ name: pl.name, isHost: pl.isHost })),
        timeLeft: room.timeLeft
      });
    });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    if (!currentRoomCode) return;

    const room = rooms[currentRoomCode];
    if (!room) return;

    // Remove player
    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex !== -1) {
      const removedPlayer = room.players.splice(playerIndex, 1)[0];

      if (room.players.length === 0) {
        // Delete room if empty
        clearRoomTimer(room);
        delete rooms[currentRoomCode];
      } else {
        // If host disconnected, reassign host
        if (removedPlayer.isHost) {
          room.players[0].isHost = true;
        }
        
        // Update room state for remaining players
        io.to(currentRoomCode).emit('roomStateUpdate', {
          code: currentRoomCode,
          players: room.players,
          gameStarted: room.gameStarted
        });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
