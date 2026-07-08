const socket = io();

// Client State
let localRoomCode = null;
let localPlayerName = null;
let isHost = false;
let myPlayerId = null;

// DOM Elements
const errorBanner = document.getElementById('error-banner');

// Screens
const welcomeScreen = document.getElementById('welcome-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const timesUpScreen = document.getElementById('times-up-screen');

// Welcome Screen Inputs/Buttons
const playerNameInput = document.getElementById('player-name');
const roomCodeInput = document.getElementById('room-code-input');
const btnCreate = document.getElementById('btn-create');
const btnDemo = document.getElementById('btn-demo');
const btnJoin = document.getElementById('btn-join');

// Lobby Screen Elements
const displayRoomCode = document.getElementById('display-room-code');
const playerList = document.getElementById('player-list');
const playerCount = document.getElementById('player-count');
const lobbyStatusText = document.getElementById('lobby-status-text');
const btnStart = document.getElementById('btn-start');

// Game Screen Elements
const playerRoleIndicator = document.getElementById('player-role-indicator');
const timerText = document.getElementById('timer-text');
const secretWord = document.getElementById('secret-word');

// Time's Up Screen
const btnReset = document.getElementById('btn-reset');

// Helpers
function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.remove('hidden');
  setTimeout(() => {
    errorBanner.classList.add('hidden');
  }, 4000);
}

function showScreen(screen) {
  [welcomeScreen, lobbyScreen, gameScreen, timesUpScreen].forEach(s => {
    s.classList.add('hidden');
  });
  screen.classList.remove('hidden');
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// UI Event Listeners
btnCreate.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  if (!name) {
    showError('Please enter your name');
    return;
  }
  socket.emit('createRoom', { playerName: name });
});

btnDemo.addEventListener('click', () => {
  let name = playerNameInput.value.trim();
  if (!name) {
    name = 'Player';
  }
  socket.emit('createDemoRoom', { playerName: name });
});

btnJoin.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  const code = roomCodeInput.value.trim();
  if (!name) {
    showError('Please enter your name');
    return;
  }
  if (!code) {
    showError('Please enter a room code');
    return;
  }
  socket.emit('joinRoom', { roomCode: code, playerName: name });
});

btnStart.addEventListener('click', () => {
  socket.emit('startGame');
});

btnReset.addEventListener('click', () => {
  window.location.reload();
});

// Socket.IO Events
socket.on('connect', () => {
  myPlayerId = socket.id;
});

socket.on('errorMsg', (msg) => {
  showError(msg);
});

socket.on('roomCreated', ({ roomCode, player }) => {
  localRoomCode = roomCode;
  localPlayerName = player.name;
  isHost = player.isHost;
  displayRoomCode.textContent = roomCode;
  showScreen(lobbyScreen);
});

socket.on('roomJoined', ({ roomCode, player }) => {
  localRoomCode = roomCode;
  localPlayerName = player.name;
  isHost = player.isHost;
  displayRoomCode.textContent = roomCode;
  showScreen(lobbyScreen);
});

socket.on('roomStateUpdate', ({ code, players, gameStarted }) => {
  playerCount.textContent = players.length;
  playerList.innerHTML = '';

  // Determine if this socket is the host now
  const me = players.find(p => p.id === socket.id);
  if (me) {
    isHost = me.isHost;
  }

  players.forEach(p => {
    const li = document.createElement('li');
    li.textContent = p.name;
    if (p.id === socket.id) {
      li.classList.add('is-you');
      li.textContent += ' (You)';
    }
    if (p.isHost) {
      const badge = document.createElement('span');
      badge.className = 'host-badge';
      badge.textContent = 'Host';
      li.appendChild(badge);
    }
    playerList.appendChild(li);
  });

  if (isHost) {
    btnStart.classList.remove('hidden');
    lobbyStatusText.classList.add('hidden');
  } else {
    btnStart.classList.add('hidden');
    lobbyStatusText.classList.remove('hidden');
  }
});

socket.on('gameStarted', ({ word, players, timeLeft }) => {
  // Update role indicator as Host / Player (not revealing if Imposter)
  playerRoleIndicator.textContent = isHost ? 'Host' : 'Player';
  secretWord.textContent = word;
  timerText.textContent = formatTime(timeLeft);
  showScreen(gameScreen);
});

socket.on('timerUpdate', ({ timeLeft }) => {
  timerText.textContent = formatTime(timeLeft);
});

socket.on('timeUp', () => {
  showScreen(timesUpScreen);
});
