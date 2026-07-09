const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Words database loading
let words = [];
try {
  const wordsData = fs.readFileSync(path.join(__dirname, 'words.json'), 'utf8');
  words = JSON.parse(wordsData);
} catch (err) {
  words = [
    { word1: "Apple", word2: "Mango" },
    { word1: "Dog", word2: "Wolf" },
    { word1: "Pizza", word2: "Burger" },
    { word1: "Coffee", word2: "Tea" }
  ];
}

const AVATARS = ["🐱", "🐶", "🦊", "🐯", "🐨", "🐼", "🦁", "🐸", "🐵", "🦄", "🐙", "🦖"];

// AUTHORITATIVE STATE DB
const rooms = {};
// sessionToken -> { roomCode, name, avatar, isHost }
const sessions = {};

// Helper: Generate a unique room code
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

// Broadcast game state to a room
function broadcastRoomUpdate(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  io.to(roomCode).emit('roomStateUpdate', {
    code: roomCode,
    players: room.players.map(p => ({
      id: p.id,
      sessionToken: p.sessionToken,
      name: p.name,
      avatar: p.avatar,
      isHost: p.isHost,
      isReady: p.isReady,
      isOnline: p.isOnline,
      isEliminated: p.isEliminated
    })),
    phase: room.phase,
    settings: room.settings
  });
}

// Clean up timers
function stopRoomTimer(room) {
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }
}

// Helper: safe interval setter to avoid duplicates
function startRoomTimer(room, duration, onTick, onComplete) {
  stopRoomTimer(room);
  room.timeLeft = duration;
  
  // Initial tick update
  onTick(room.timeLeft);

  room.timerInterval = setInterval(() => {
    room.timeLeft--;
    onTick(room.timeLeft);

    if (room.timeLeft <= 0) {
      stopRoomTimer(room);
      onComplete();
    }
  }, 1000);
}

// Handle speaking turn progression
function nextSpeakingTurn(room) {
  stopRoomTimer(room);

  // Filter for active (not eliminated) players in the speaking queue
  let nextIndex = room.speakingIndex + 1;
  while (nextIndex < room.speakingOrder.length) {
    const nextPlayerId = room.speakingOrder[nextIndex];
    const player = room.players.find(p => p.sessionToken === nextPlayerId || p.id === nextPlayerId);
    if (player && !player.isEliminated && player.isOnline) {
      room.speakingIndex = nextIndex;
      startSpeakerTimer(room, player);
      return;
    }
    nextIndex++;
  }

  // If we reach the end of the speaking queue, move to voting
  startVotingPhase(room);
}

// Start timer for a speaker
function startSpeakerTimer(room, player) {
  room.activeSpeakerId = player.sessionToken || player.id;
  
  io.to(room.code).emit('speakingTurnUpdate', {
    activeSpeakerId: room.activeSpeakerId,
    timeLeft: room.settings.speakingTime,
    index: room.speakingIndex + 1,
    total: room.players.filter(p => !p.isEliminated).length
  });

  // Simulated bot response: auto-advance bot after 2.5s
  if (player.id.startsWith('bot') || player.sessionToken.startsWith('bot')) {
    setTimeout(() => {
      if (room.phase === 'SPEAKING' && room.activeSpeakerId === (player.sessionToken || player.id)) {
        nextSpeakingTurn(room);
      }
    }, 2500);
  }

  startRoomTimer(room, room.settings.speakingTime, 
    (timeLeft) => {
      io.to(room.code).emit('timerUpdate', { timeLeft });
    },
    () => {
      nextSpeakingTurn(room);
    }
  );
}

// Start Voting Phase
function startVotingPhase(room) {
  room.phase = 'VOTING';
  room.votes = {}; // voterId -> votedTargetId
  stopRoomTimer(room);
  broadcastRoomUpdate(room.code);

  io.to(room.code).emit('phaseTransition', {
    phase: room.phase,
    timeLeft: room.settings.votingTime,
    players: room.players.map(p => ({
      id: p.sessionToken || p.id,
      name: p.name,
      avatar: p.avatar,
      isEliminated: p.isEliminated
    }))
  });

  startRoomTimer(room, room.settings.votingTime,
    (timeLeft) => {
      io.to(room.code).emit('timerUpdate', { timeLeft });
    },
    () => {
      endVotingPhase(room);
    }
  );
}

// Complete voting calculation and elimination
function endVotingPhase(room) {
  stopRoomTimer(room);
  room.phase = 'VOTE_REVEAL';

  // Tally votes
  const tallies = {}; // targetToken -> count
  const activePlayers = room.players.filter(p => !p.isEliminated);

  activePlayers.forEach(p => {
    const token = p.sessionToken;
    tallies[token] = 0;
  });

  // Calculate votes received
  const votesReceived = {}; // targetToken -> Array of voter names
  activePlayers.forEach(p => {
    const target = room.votes[p.sessionToken];
    if (target) {
      if (!votesReceived[target]) votesReceived[target] = [];
      votesReceived[target].push(p.name);
      tallies[target] = (tallies[target] || 0) + 1;
    }
  });

  // Find player(s) with highest votes
  let highestVoteCount = -1;
  let tiedPlayers = [];

  Object.keys(tallies).forEach(token => {
    if (tallies[token] > highestVoteCount) {
      highestVoteCount = tallies[token];
      tiedPlayers = [token];
    } else if (tallies[token] === highestVoteCount && highestVoteCount > 0) {
      tiedPlayers.push(token);
    }
  });

  let eliminatedToken = null;
  let wasTie = false;

  if (highestVoteCount > 0) {
    if (tiedPlayers.length > 1) {
      wasTie = true;
      if (room.settings.tieBreak === 'revote' && !room.isRevoteActive) {
        // Run a re-vote between the tied players
        room.isRevoteActive = true;
        io.to(room.code).emit('announceTie', { tiedPlayerTokens: tiedPlayers });
        setTimeout(() => {
          room.speakingOrder = [...tiedPlayers];
          room.speakingIndex = 0;
          room.phase = 'SPEAKING';
          const firstSpeaker = room.players.find(p => p.sessionToken === tiedPlayers[0]);
          if (firstSpeaker) {
            startSpeakerTimer(room, firstSpeaker);
          } else {
            startVotingPhase(room);
          }
        }, 3000);
        return;
      }
      // If skip or second tie, skip elimination
    } else {
      eliminatedToken = tiedPlayers[0];
    }
  }

  room.isRevoteActive = false;
  let isImposterEliminated = false;
  let winner = null; // 'CIVILIANS' or 'IMPOSTER'
  let eliminatedPlayerName = 'Nobody';

  if (eliminatedToken) {
    const p = room.players.find(p => p.sessionToken === eliminatedToken);
    if (p) {
      p.isEliminated = true;
      eliminatedPlayerName = p.name;
      if (p.id === room.imposterId || p.sessionToken === room.imposterToken) {
        isImposterEliminated = true;
        winner = 'CIVILIANS';
      }
    }
  }

  // Check victory conditions
  const remainingPlayers = room.players.filter(p => !p.isEliminated);
  const remainingCivilians = remainingPlayers.filter(p => p.id !== room.imposterId && p.sessionToken !== room.imposterToken);
  
  if (!winner) {
    if (remainingCivilians.length <= 1) {
      winner = 'IMPOSTER';
    }
  }

  // Update statistics for this match
  if (winner) {
    room.players.forEach(p => {
      if (!p.stats) p.stats = { games: 0, wins: 0, streak: 0 };
      p.stats.games++;
      const isImposter = (p.id === room.imposterId || p.sessionToken === room.imposterToken);
      if ((winner === 'CIVILIANS' && !isImposter) || (winner === 'IMPOSTER' && isImposter)) {
        p.stats.wins++;
        p.stats.streak++;
      } else {
        p.stats.streak = 0;
      }
    });
  }

  io.to(room.code).emit('voteReveal', {
    votes: room.settings.anonVoting === 'yes' ? null : room.votes,
    tallies,
    votesReceived,
    eliminatedPlayerName,
    isImposterEliminated,
    winner,
    scoreboard: winner ? room.players.map(p => ({
      name: p.name,
      avatar: p.avatar,
      isImposter: (p.id === room.imposterId || p.sessionToken === room.imposterToken),
      word: p.word,
      stats: p.stats
    })) : null
  });

  if (winner) {
    room.phase = 'RESULTS';
  } else {
    // Start next round of speaking after 6 seconds delay
    setTimeout(() => {
      startSpeakingTurns(room);
    }, 6000);
  }
}

// Start Speaking Turns Phase
function startSpeakingTurns(room) {
  room.phase = 'SPEAKING';
  broadcastRoomUpdate(room.code);
  
  // Randomize speaking order for all uneliminated players
  const activePlayers = room.players.filter(p => !p.isEliminated && p.isOnline);
  room.speakingOrder = activePlayers.map(p => p.sessionToken).sort(() => Math.random() - 0.5);
  room.speakingIndex = 0;

  const firstSpeaker = room.players.find(p => p.sessionToken === room.speakingOrder[0]);
  if (firstSpeaker) {
    startSpeakerTimer(room, firstSpeaker);
  } else {
    startVotingPhase(room);
  }
}

function startGameAuthoritative(room) {
  room.phase = 'ROLE_REVEAL';
  const wordPair = words[Math.floor(Math.random() * words.length)];
  room.wordPair = wordPair;

  const imposterIndex = Math.floor(Math.random() * room.players.length);
  const imposter = room.players[imposterIndex];
  room.imposterId = imposter.id;
  room.imposterToken = imposter.sessionToken;

  const coinFlip = Math.random() < 0.5;
  const commonWord = coinFlip ? wordPair.word1 : wordPair.word2;
  const imposterWord = coinFlip ? wordPair.word2 : wordPair.word1;

  room.players.forEach(p => {
    p.isEliminated = false;
    p.word = (p.sessionToken === room.imposterToken) ? imposterWord : commonWord;
  });

  broadcastRoomUpdate(room.code);

  room.players.forEach(p => {
    io.to(p.id).emit('roleRevealInit', {
      word: p.word,
      role: (p.sessionToken === room.imposterToken) ? 'IMPOSTER' : 'CIVILIAN',
      timeLeft: 5
    });
  });

  startRoomTimer(room, 5,
    (timeLeft) => {
      io.to(room.code).emit('timerUpdate', { timeLeft });
    },
    () => {
      startSpeakingTurns(room);
    }
  );
}

io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  // Reconnection or Session Registration
  socket.on('registerSession', ({ sessionToken, name, avatar }) => {
    let session = sessions[sessionToken];
    if (session) {
      // Reconnecting to existing active session
      const room = rooms[session.roomCode];
      if (room) {
        const player = room.players.find(p => p.sessionToken === sessionToken);
        if (player) {
          player.id = socket.id;
          player.isOnline = true;
          socket.join(session.roomCode);

          // Broadcast state update
          broadcastRoomUpdate(session.roomCode);

          // Restore private state
          socket.emit('sessionRestored', {
            roomCode: session.roomCode,
            name: player.name,
            avatar: player.avatar,
            isHost: player.isHost,
            phase: room.phase,
            word: player.word,
            settings: room.settings
          });

          // Sync timer if in speaking or voting phase
          if (room.phase === 'SPEAKING') {
            socket.emit('speakingTurnUpdate', {
              activeSpeakerId: room.activeSpeakerId,
              timeLeft: room.timeLeft,
              index: room.speakingIndex + 1,
              total: room.players.filter(p => !p.isEliminated).length
            });
          } else if (room.phase === 'VOTING') {
            socket.emit('phaseTransition', {
              phase: room.phase,
              timeLeft: room.timeLeft,
              players: room.players.map(p => ({
                id: p.sessionToken,
                name: p.name,
                avatar: p.avatar,
                isEliminated: p.isEliminated
              }))
            });
          }
          return;
        }
      }
    }

    // New Session
    const selectedAvatar = avatar || AVATARS[Math.floor(Math.random() * AVATARS.length)];
    sessions[sessionToken] = {
      roomCode: null,
      name: name || 'Player',
      avatar: selectedAvatar,
      isHost: false
    };
    socket.emit('sessionRegistered', { avatar: selectedAvatar });
  });

  // Create Room
  socket.on('createRoom', ({ sessionToken, name, avatar, settings }) => {
    const code = generateRoomCode();
    rooms[code] = {
      code,
      players: [],
      phase: 'LOBBY',
      settings: settings || {
        speakingTime: 15,
        votingTime: 20,
        anonVoting: 'yes',
        tieBreak: 'revote'
      },
      timerInterval: null,
      timeLeft: 0,
      imposterId: null,
      imposterToken: null,
      wordPair: null,
      speakingOrder: [],
      speakingIndex: 0,
      activeSpeakerId: null,
      votes: {},
      isRevoteActive: false
    };

    const player = {
      id: socket.id,
      sessionToken,
      name,
      avatar,
      isHost: true,
      isReady: true,
      isOnline: true,
      isEliminated: false,
      word: null,
      stats: { games: 0, wins: 0, streak: 0 }
    };

    rooms[code].players.push(player);
    sessions[sessionToken].roomCode = code;
    sessions[sessionToken].isHost = true;

    socket.join(code);
    socket.emit('roomJoinedSuccess', { roomCode: code, isHost: true });
    broadcastRoomUpdate(code);
  });

  // Join Room
  socket.on('joinRoom', ({ sessionToken, roomCode, name, avatar }) => {
    const code = roomCode.toUpperCase().trim();
    const room = rooms[code];

    if (!room) {
      socket.emit('errorMsg', 'Room not found');
      return;
    }

    if (room.players.length >= 6) {
      socket.emit('errorMsg', 'Room is full (max 6 players)');
      return;
    }

    if (room.phase !== 'LOBBY') {
      socket.emit('errorMsg', 'Game has already started');
      return;
    }

    // Name duplication check
    if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      socket.emit('errorMsg', 'Name already taken in this room');
      return;
    }

    const player = {
      id: socket.id,
      sessionToken,
      name,
      avatar,
      isHost: false,
      isReady: false,
      isOnline: true,
      isEliminated: false,
      word: null,
      stats: { games: 0, wins: 0, streak: 0 }
    };

    room.players.push(player);
    sessions[sessionToken].roomCode = code;

    socket.join(code);
    socket.emit('roomJoinedSuccess', { roomCode: code, isHost: false });
    broadcastRoomUpdate(code);
  });

  // Host change settings
  socket.on('updateSettings', ({ settings }) => {
    const session = Object.values(sessions).find(s => s.roomCode && rooms[s.roomCode] && rooms[s.roomCode].players.some(p => p.id === socket.id && p.isHost));
    if (!session) return;

    const room = rooms[session.roomCode];
    room.settings = { ...room.settings, ...settings };
    broadcastRoomUpdate(room.code);
  });

  // Toggle ready status
  socket.on('toggleReady', ({ sessionToken }) => {
    const session = sessions[sessionToken];
    if (!session || !session.roomCode) return;

    const room = rooms[session.roomCode];
    if (!room) return;

    const player = room.players.find(p => p.sessionToken === sessionToken);
    if (player) {
      player.isReady = !player.isReady;
      broadcastRoomUpdate(room.code);
    }
  });

  // Kick player (Host action)
  socket.on('kickPlayer', ({ targetToken }) => {
    const session = Object.values(sessions).find(s => s.roomCode && rooms[s.roomCode] && rooms[s.roomCode].players.some(p => p.id === socket.id && p.isHost));
    if (!session) return;

    const room = rooms[session.roomCode];
    const targetPlayer = room.players.find(p => p.sessionToken === targetToken);
    if (targetPlayer) {
      io.to(targetPlayer.id).emit('kicked');
      const idx = room.players.indexOf(targetPlayer);
      room.players.splice(idx, 1);
      
      broadcastRoomUpdate(room.code);
    }
  });

  // Play Demo (with 3 bots)
  socket.on('createDemoRoom', ({ sessionToken, name, avatar }) => {
    const code = generateRoomCode();
    rooms[code] = {
      code,
      players: [],
      phase: 'LOBBY',
      settings: {
        speakingTime: 15,
        votingTime: 20,
        anonVoting: 'yes',
        tieBreak: 'revote'
      },
      timerInterval: null,
      timeLeft: 0,
      imposterId: null,
      imposterToken: null,
      wordPair: null,
      speakingOrder: [],
      speakingIndex: 0,
      activeSpeakerId: null,
      votes: {},
      isRevoteActive: false
    };

    const player = {
      id: socket.id,
      sessionToken,
      name,
      avatar,
      isHost: true,
      isReady: true,
      isOnline: true,
      isEliminated: false,
      word: null,
      stats: { games: 0, wins: 0, streak: 0 }
    };

    rooms[code].players.push(player);
    // Add 3 bots
    rooms[code].players.push({ id: 'bot1', sessionToken: 'bot1', name: 'Bot Alpha', avatar: '🦊', isHost: false, isReady: true, isOnline: true, isEliminated: false, word: null, stats: { games: 0, wins: 0, streak: 0 } });
    rooms[code].players.push({ id: 'bot2', sessionToken: 'bot2', name: 'Bot Beta', avatar: '🐨', isHost: false, isReady: true, isOnline: true, isEliminated: false, word: null, stats: { games: 0, wins: 0, streak: 0 } });
    rooms[code].players.push({ id: 'bot3', sessionToken: 'bot3', name: 'Bot Gamma', avatar: '🐙', isHost: false, isReady: true, isOnline: true, isEliminated: false, word: null, stats: { games: 0, wins: 0, streak: 0 } });

    sessions[sessionToken].roomCode = code;
    sessions[sessionToken].isHost = true;

    socket.join(code);
    socket.emit('roomJoinedSuccess', { roomCode: code, isHost: true });
    broadcastRoomUpdate(code);
  });

  // Start the Game
  socket.on('startGame', () => {
    const session = Object.values(sessions).find(s => s.roomCode && rooms[s.roomCode] && rooms[s.roomCode].players.some(p => p.id === socket.id && p.isHost));
    if (!session) return;

    const room = rooms[session.roomCode];
    if (room.players.length < 2) {
      socket.emit('errorMsg', 'Need at least 2 players to start');
      return;
    }

    // Check if all players are ready
    const unreadyPlayers = room.players.filter(p => !p.isReady);
    if (unreadyPlayers.length > 0) {
      socket.emit('errorMsg', `Cannot start. Waiting for players to ready: ${unreadyPlayers.map(p => p.name).join(', ')}`);
      return;
    }

    startGameAuthoritative(room);
  });

  // Play Again (directly start new match from Results, Host only)
  socket.on('playAgain', () => {
    const session = Object.values(sessions).find(s => s.roomCode && rooms[s.roomCode] && rooms[s.roomCode].players.some(p => p.id === socket.id && p.isHost));
    if (!session) return;

    const room = rooms[session.roomCode];
    if (room.players.length < 2) {
      socket.emit('errorMsg', 'Need at least 2 players to start');
      return;
    }

    startGameAuthoritative(room);
  });

  // Pass active speaking turn
  socket.on('passSpeakingTurn', () => {
    const session = Object.values(sessions).find(s => s.roomCode && rooms[s.roomCode]);
    if (!session) return;

    const room = rooms[session.roomCode];
    const player = room.players.find(p => p.id === socket.id);
    if (player && (player.sessionToken === room.activeSpeakerId || player.id === room.activeSpeakerId)) {
      nextSpeakingTurn(room);
    }
  });

  // Submit Vote
  socket.on('castVote', ({ targetToken }) => {
    const session = Object.values(sessions).find(s => s.roomCode && rooms[s.roomCode]);
    if (!session) return;

    const room = rooms[session.roomCode];
    const player = room.players.find(p => p.id === socket.id);
    if (player && !player.isEliminated && room.phase === 'VOTING') {
      room.votes[player.sessionToken] = targetToken;

      // Broadcast voting progression ratio
      const activePlayers = room.players.filter(p => !p.isEliminated);
      const votedCount = Object.keys(room.votes).length;

      io.to(room.code).emit('voteProgressUpdate', {
        votedCount,
        totalCount: activePlayers.length
      });

      // If all uneliminated players have voted, move to reveal immediately
      if (votedCount >= activePlayers.length) {
        endVotingPhase(room);
      }
    }
  });

  // Return to Lobby after Results (Allowed by anyone if phase is RESULTS)
  socket.on('returnToLobby', () => {
    const session = Object.values(sessions).find(s => s.roomCode && rooms[s.roomCode] && rooms[s.roomCode].players.some(p => p.id === socket.id));
    if (!session) return;

    const room = rooms[session.roomCode];
    if (!room || room.phase !== 'RESULTS') return;

    room.phase = 'LOBBY';
    room.players.forEach(p => {
      p.isReady = p.isHost; // Host stays ready, guests need to ready up again
      p.isEliminated = false;
      p.word = null;
    });

    broadcastRoomUpdate(room.code);
  });

  // Emoji Reaction Trigger
  socket.on('triggerReaction', ({ emoji }) => {
    const session = Object.values(sessions).find(s => s.roomCode && rooms[s.roomCode]);
    if (!session) return;

    const room = rooms[session.roomCode];
    const sender = room.players.find(p => p.id === socket.id);
    if (sender) {
      socket.to(room.code).emit('receiveReaction', {
        senderId: sender.sessionToken,
        emoji
      });
    }
  });

  // Leave Room explicitly
  socket.on('leaveRoom', () => {
    const session = Object.values(sessions).find(s => s.roomCode && rooms[s.roomCode] && rooms[s.roomCode].players.some(p => p.id === socket.id));
    if (!session) return;

    const code = session.roomCode;
    const room = rooms[code];
    if (!room) return;

    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex !== -1) {
      const removedPlayer = room.players.splice(playerIndex, 1)[0];
      
      // Clear session room code reference
      const token = removedPlayer.sessionToken;
      if (sessions[token]) {
        sessions[token].roomCode = null;
        sessions[token].isHost = false;
      }

      socket.leave(code);
      socket.emit('leftRoomSuccess');

      if (room.players.length === 0) {
        stopRoomTimer(room);
        delete rooms[code];
      } else {
        // Re-elect Host if host left
        if (removedPlayer.isHost) {
          const newHost = room.players[0];
          newHost.isHost = true;
          if (sessions[newHost.sessionToken]) {
            sessions[newHost.sessionToken].isHost = true;
          }
        }

        // Adjust game phase if active player left
        if (room.phase === 'SPEAKING' && room.activeSpeakerId === removedPlayer.sessionToken) {
          nextSpeakingTurn(room);
        } else if (room.phase === 'VOTING') {
          delete room.votes[removedPlayer.sessionToken];
          const activePlayers = room.players.filter(p => !p.isEliminated);
          const votedCount = Object.keys(room.votes).length;
          io.to(code).emit('voteProgressUpdate', {
            votedCount,
            totalCount: activePlayers.length
          });
          if (votedCount >= activePlayers.length) {
            endVotingPhase(room);
          }
        }

        broadcastRoomUpdate(code);
      }
    }
  });

  // Handle Disconnect with Offline grace period
  socket.on('disconnect', () => {
    console.log(`Disconnected: ${socket.id}`);
    const session = Object.values(sessions).find(s => s.roomCode && rooms[s.roomCode]);
    if (!session) return;

    const room = rooms[session.roomCode];
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.isOnline = false;
      broadcastRoomUpdate(room.code);

      // Start 15s grace period to reconnect
      setTimeout(() => {
        const checkRoom = rooms[room.code];
        if (!checkRoom) return;

        const checkPlayer = checkRoom.players.find(p => p.sessionToken === player.sessionToken);
        if (checkPlayer && !checkPlayer.isOnline) {
          // Permanently remove player
          const idx = checkRoom.players.indexOf(checkPlayer);
          checkRoom.players.splice(idx, 1);

          if (checkRoom.players.length === 0) {
            stopRoomTimer(checkRoom);
            delete rooms[room.code];
          } else {
            // Re-elect Host if host left
            if (checkPlayer.isHost) {
              const newHost = checkRoom.players[0];
              newHost.isHost = true;
              sessions[newHost.sessionToken].isHost = true;
            }

            // Adjust game phase if active player left
            if (checkRoom.phase === 'SPEAKING' && checkRoom.activeSpeakerId === checkPlayer.sessionToken) {
              nextSpeakingTurn(checkRoom);
            } else if (checkRoom.phase === 'VOTING') {
              // Delete their vote if any
              delete checkRoom.votes[checkPlayer.sessionToken];
              const activePlayers = checkRoom.players.filter(p => !p.isEliminated);
              const votedCount = Object.keys(checkRoom.votes).length;
              io.to(checkRoom.code).emit('voteProgressUpdate', {
                votedCount,
                totalCount: activePlayers.length
              });
              if (votedCount >= activePlayers.length) {
                endVotingPhase(checkRoom);
              }
            }

            broadcastRoomUpdate(room.code);
          }
        }
      }, 15000);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
