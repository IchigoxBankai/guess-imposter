const socket = io();

// State Variables
let sessionToken = localStorage.getItem('imposter_session');
if (!sessionToken) {
  sessionToken = 'sess_' + Math.random().toString(36).substr(2, 9);
  localStorage.setItem('imposter_session', sessionToken);
}

let currentRoomCode = null;
let myName = '';
let myAvatar = '🐱';
let isHost = false;
let roomPlayers = [];
let activeSpeakerId = null;
let currentPhase = 'LOBBY';
let selectedVoteToken = null;
let userStats = JSON.parse(localStorage.getItem('imposter_stats')) || { games: 0, wins: 0, streak: 0 };

const AVATARS = ["🐱", "🐶", "🦊", "🐯", "🐨", "🐼", "🦁", "🐸", "🐵", "🦄", "🐙", "🦖"];
let avatarIndex = 0;

// DOM Elements
const errorBanner = document.getElementById('error-banner');
const errorBannerText = document.getElementById('error-banner-text');

// Screens
const welcomeScreen = document.getElementById('welcome-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const roleRevealScreen = document.getElementById('role-reveal-screen');
const speakingScreen = document.getElementById('speaking-screen');
const votingScreen = document.getElementById('voting-screen');
const voteRevealScreen = document.getElementById('vote-reveal-screen');
const resultsScreen = document.getElementById('results-screen');

// Welcome screen
const nameInput = document.getElementById('player-name');
const avatarPreview = document.getElementById('avatar-preview');
const roomCodeInput = document.getElementById('room-code-input');
const btnCreate = document.getElementById('btn-create');
const btnDemo = document.getElementById('btn-demo');
const btnJoin = document.getElementById('btn-join');
const statsGames = document.getElementById('stats-games');
const statsWins = document.getElementById('stats-wins');
const statsStreak = document.getElementById('stats-streak');
const avatarUpload = document.getElementById('avatar-upload');
const btnBrowseAvatar = document.getElementById('btn-browse-avatar');

// Lobby Screen
const displayRoomCode = document.getElementById('display-room-code');
const btnCopyCode = document.getElementById('btn-copy-code');
const lobbyPlayersGrid = document.getElementById('lobby-players-grid');
const playerCount = document.getElementById('player-count');
const settingsToggleHeader = document.getElementById('settings-toggle-header');
const settingsContent = document.getElementById('settings-content');
const settingsArrow = document.getElementById('settings-arrow');
const btnReady = document.getElementById('btn-ready');
const btnStart = document.getElementById('btn-start');
const btnLeave = document.getElementById('btn-leave');
const btnBackNav = document.getElementById('btn-back-nav');

// Settings Elements
const settingSpeakingTime = document.getElementById('setting-speaking-time');
const settingVotingTime = document.getElementById('setting-voting-time');
const settingAnonVoting = document.getElementById('setting-anon-voting');
const settingTieBreak = document.getElementById('setting-tie-break');
const settingGameMode = document.getElementById('setting-game-mode');

// Role Reveal Screen
const revealCard = document.getElementById('reveal-card');
const revealBadgeContainer = document.getElementById('reveal-badge-container');
const revealSecretWord = document.getElementById('reveal-secret-word');
const revealCountdownText = document.getElementById('reveal-countdown-text');

// Speaking Screen
const speakingTurnProgress = document.getElementById('speaking-turn-progress');
const speakingQueueNodes = document.getElementById('speaking-queue-nodes');
const speakingTimerText = document.getElementById('speaking-timer-text');
const timerCircleIndicator = document.getElementById('timer-circle-indicator');
const timerRingWrapper = document.getElementById('timer-ring-wrapper');
const speakerAvatarBubble = document.getElementById('speaker-avatar-bubble');
const speakerNameDisplay = document.getElementById('speaker-name-display');
const btnPassTurn = document.getElementById('btn-pass-turn');
const btnStartVoting = document.getElementById('btn-start-voting');

// Voting Screen
const votingCardsContainer = document.getElementById('voting-cards-container');
const votingTimerDisplay = document.getElementById('voting-timer-display');
const votedCountRatio = document.getElementById('voted-count-ratio');

// Vote Reveal Screen
const voteRevealPlayers = document.getElementById('vote-reveal-players');
const eliminationAnnounceBox = document.getElementById('elimination-announce-box');

// Results Screen
const victoryTitle = document.getElementById('victory-title');
const victorySub = document.getElementById('victory-sub');
const scoreboardRows = document.getElementById('scoreboard-rows');
const btnLobbyReturn = document.getElementById('btn-lobby-return');
const btnPlayAgain = document.getElementById('btn-play-again');

// Load initial statistics
function updateStatsUI() {
  statsGames.textContent = userStats.games;
  statsWins.textContent = userStats.wins;
  statsStreak.textContent = userStats.streak;
}
updateStatsUI();

// Synthesized Audio Helper (Web Audio API)
function playSound(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'tick') {
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } else if (type === 'join') {
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } else if (type === 'start') {
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1); // E5
      osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.2); // G5
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } else if (type === 'victory') {
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880.00, ctx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
      osc.start();
      osc.stop(ctx.currentTime + 0.6);
    } else if (type === 'eliminate') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.4);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    }
  } catch (e) {
    console.error("Audio Context initialization blocked or failed", e);
  }
}

// Float floating emoji animations
function spawnFloatingEmoji(emoji, targetNode) {
  const container = document.getElementById('app-wrapper');
  const span = document.createElement('span');
  span.className = 'floating-emoji';
  span.textContent = emoji;

  // Position emoji over source element coordinates
  const rect = targetNode.getBoundingClientRect();
  span.style.left = `${rect.left + rect.width / 2 - 10}px`;
  span.style.top = `${rect.top}px`;

  container.appendChild(span);
  setTimeout(() => span.remove(), 1500);
}

function renderAvatar(element, avatarString) {
  if (!avatarString) return;
  if (avatarString.startsWith('data:image/') || avatarString.startsWith('http') || avatarString.length > 50) {
    element.textContent = '';
    element.style.backgroundImage = `url(${avatarString})`;
    element.style.backgroundSize = 'cover';
    element.style.backgroundPosition = 'center';
  } else {
    element.style.backgroundImage = 'none';
    element.textContent = avatarString;
  }
}

// Error Message Banner Display
function showError(msg) {
  errorBannerText.textContent = msg;
  errorBanner.classList.remove('hidden');
  playSound('eliminate');
  setTimeout(() => errorBanner.classList.add('hidden'), 4000);
}

// Screen Transition Helper
function showScreen(screen) {
  [welcomeScreen, lobbyScreen, roleRevealScreen, speakingScreen, votingScreen, voteRevealScreen, resultsScreen].forEach(s => {
    s.classList.add('hidden');
  });
  screen.classList.remove('hidden');

  // Toggle back button visibility (hide on welcome screen, show on all others)
  if (screen === welcomeScreen) {
    btnBackNav.classList.add('hidden');
  } else {
    btnBackNav.classList.remove('hidden');
  }
}

btnBackNav.addEventListener('click', () => {
  if (currentPhase === 'RESULTS') {
    socket.emit('returnToLobby');
  } else {
    socket.emit('leaveRoom');
  }
});

// Initial session handshake
socket.emit('registerSession', { sessionToken });

socket.on('sessionRegistered', ({ avatar }) => {
  myAvatar = avatar;
  renderAvatar(avatarPreview, avatar);
  avatarIndex = AVATARS.indexOf(avatar);
  
  if (welcomeScreen.classList.contains('hidden')) {
    showScreen(welcomeScreen);
    showError('Session lost. The room may have ended or the server restarted.');
  }
});

socket.on('sessionRestored', ({ roomCode, name, avatar, isHost: hostStatus, phase, word, settings }) => {
  currentRoomCode = roomCode;
  myName = name;
  myAvatar = avatar;
  isHost = hostStatus;
  currentPhase = phase;
  
  displayRoomCode.textContent = roomCode;

  // Restore current screen phase
  if (phase === 'LOBBY') {
    showScreen(lobbyScreen);
  } else if (phase === 'ROLE_REVEAL') {
    revealSecretWord.textContent = word;
    revealBadgeContainer.textContent = (word === 'IMPOSTER') ? 'IMPOSTER' : 'CIVILIAN';
    showScreen(roleRevealScreen);
  } else if (phase === 'SPEAKING') {
    showScreen(speakingScreen);
  } else if (phase === 'VOTING') {
    showScreen(votingScreen);
  }
});

// Avatar Change interaction
avatarPreview.addEventListener('click', () => {
  avatarIndex = (avatarIndex + 1) % AVATARS.length;
  myAvatar = AVATARS[avatarIndex];
  avatarPreview.style.backgroundImage = 'none';
  avatarPreview.textContent = myAvatar;
  playSound('tick');
});

// Trigger Browse File Click
btnBrowseAvatar.addEventListener('click', (e) => {
  e.stopPropagation();
  avatarUpload.click();
});

// Read and Preview Custom File Upload
avatarUpload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target.result;
      myAvatar = dataUrl;
      
      avatarPreview.textContent = '';
      avatarPreview.style.backgroundImage = `url(${dataUrl})`;
      avatarPreview.style.backgroundSize = 'cover';
      avatarPreview.style.backgroundPosition = 'center';
      playSound('tick');
    };
    reader.readAsDataURL(file);
  }
});

// Welcome Screen Controls
btnCreate.addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) {
    showError('Please enter a name');
    return;
  }
  myName = name;
  socket.emit('createRoom', { sessionToken, name, avatar: myAvatar });
});

btnDemo.addEventListener('click', () => {
  const name = nameInput.value.trim() || 'Player';
  myName = name;
  socket.emit('createDemoRoom', { sessionToken, name, avatar: myAvatar });
});

btnJoin.addEventListener('click', () => {
  const name = nameInput.value.trim();
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!name) {
    showError('Please enter a name');
    return;
  }
  if (!code) {
    showError('Please enter a room code');
    return;
  }
  myName = name;
  socket.emit('joinRoom', { sessionToken, roomCode: code, name, avatar: myAvatar });
});

// Lobby settings controls (host only)
function getSettingsFromUI() {
  return {
    gameMode: settingGameMode.value,
    speakingTime: parseInt(settingSpeakingTime.value),
    votingTime: parseInt(settingVotingTime.value),
    anonVoting: settingAnonVoting.value,
    tieBreak: settingTieBreak.value
  };
}

function updateSettingsOnServer() {
  if (isHost) {
    socket.emit('updateSettings', { settings: getSettingsFromUI() });
  }
}

[settingGameMode, settingSpeakingTime, settingVotingTime, settingAnonVoting, settingTieBreak].forEach(el => {
  el.addEventListener('change', updateSettingsOnServer);
});

// Ready / Start room actions
btnReady.addEventListener('click', () => {
  socket.emit('toggleReady', { sessionToken });
});

btnStart.addEventListener('click', () => {
  socket.emit('startGame');
});

btnLeave.addEventListener('click', () => {
  socket.emit('leaveRoom');
});

btnCopyCode.addEventListener('click', () => {
  navigator.clipboard.writeText(currentRoomCode).then(() => {
    btnCopyCode.textContent = 'Copied!';
    setTimeout(() => btnCopyCode.textContent = 'Copy Code', 2000);
  });
});

settingsToggleHeader.addEventListener('click', () => {
  settingsContent.classList.toggle('hidden');
  settingsArrow.textContent = settingsContent.classList.contains('hidden') ? '▼' : '▲';
});

// Pass Speaking Turn Action
btnPassTurn.addEventListener('click', () => {
  socket.emit('passSpeakingTurn');
});

// Handlers for room state updates
socket.on('roomJoinedSuccess', ({ roomCode, isHost: hostStatus }) => {
  currentRoomCode = roomCode;
  isHost = hostStatus;
  displayRoomCode.textContent = roomCode;
  showScreen(lobbyScreen);
  playSound('join');
});

socket.on('errorMsg', (msg) => {
  showError(msg);
});

socket.on('kicked', () => {
  showScreen(welcomeScreen);
  showError('You have been kicked from the room.');
});

socket.on('leftRoomSuccess', () => {
  currentRoomCode = null;
  showScreen(welcomeScreen);
});

socket.on('roomStateUpdate', ({ code, players, phase, settings }) => {
  roomPlayers = players;
  playerCount.textContent = players.length;

  // Build Lobby players list
  lobbyPlayersGrid.innerHTML = '';
  players.forEach(p => {
    const card = document.createElement('div');
    card.className = `player-lobby-card${p.isReady ? ' is-ready' : ''}${p.id === socket.id ? ' is-you' : ''}`;
    
    // Status Indicator
    const indicator = document.createElement('div');
    indicator.className = `status-indicator ${p.isOnline ? 'status-online' : 'status-offline'}`;
    card.appendChild(indicator);

    // Kick button (only for Host targeting other players)
    if (isHost && p.id !== socket.id) {
      const kickBtn = document.createElement('div');
      kickBtn.className = 'kick-btn-overlay';
      kickBtn.innerHTML = '×';
      kickBtn.onclick = (e) => {
        e.stopPropagation();
        socket.emit('kickPlayer', { targetToken: p.id });
      };
      card.appendChild(kickBtn);
    }

    const avatar = document.createElement('div');
    avatar.className = 'player-avatar';
    renderAvatar(avatar, p.avatar);
    card.appendChild(avatar);

    const name = document.createElement('div');
    name.className = 'player-name';
    name.textContent = p.name;
    card.appendChild(name);

    if (p.isHost) {
      const badge = document.createElement('span');
      badge.className = 'player-badge badge-host';
      badge.textContent = 'Host';
      card.appendChild(badge);
    } else {
      const badge = document.createElement('span');
      badge.className = `player-badge ${p.isReady ? 'badge-ready' : 'badge-waiting'}`;
      badge.textContent = p.isReady ? 'Ready' : 'Waiting';
      card.appendChild(badge);
    }

    lobbyPlayersGrid.appendChild(card);
  });

  // UI host visibility
  const me = players.find(p => p.id === socket.id);
  if (me) {
    isHost = me.isHost;
  }

  // Update Settings from server state
  settingGameMode.value = settings.gameMode || 'normal';
  settingSpeakingTime.value = settings.speakingTime;
  settingVotingTime.value = settings.votingTime;
  settingAnonVoting.value = settings.anonVoting;
  settingTieBreak.value = settings.tieBreak;

  // Toggle dropdown edit permissions based on host status
  [settingGameMode, settingSpeakingTime, settingVotingTime, settingAnonVoting, settingTieBreak].forEach(el => {
    el.disabled = !isHost;
  });

  if (isHost) {
    btnStart.classList.remove('hidden');
    // Hide Ready button for host since they are ready by default
    btnReady.classList.add('hidden');
  } else {
    btnStart.classList.add('hidden');
    btnReady.classList.remove('hidden');
    btnReady.textContent = me && me.isReady ? 'Unready' : 'Ready Up';
  }
});

// Handlers for game progression phases
socket.on('roleRevealInit', ({ word, role, timeLeft }) => {
  revealSecretWord.textContent = word;
  
  const isImposter = (role === 'IMPOSTER');
  revealBadgeContainer.textContent = role;
  revealBadgeContainer.className = `role-title-reveal ${isImposter ? 'imposter-win-reveal' : 'civilians-win-reveal'}`;

  // Reset card state
  revealCard.classList.remove('flipped');
  revealCountdownText.textContent = `Speaking turns start in ${timeLeft}s...`;
  
  showScreen(roleRevealScreen);
  playSound('start');

  if ('vibrate' in navigator) {
    navigator.vibrate([100, 50, 100]);
  }
});

revealCard.addEventListener('click', () => {
  revealCard.classList.toggle('flipped');
  playSound('tick');
});

socket.on('timerUpdate', ({ timeLeft }) => {
  // Update current active phase timer displays
  if (currentPhase === 'ROLE_REVEAL') {
    revealCountdownText.textContent = `Speaking turns start in ${timeLeft}s...`;
  } else if (currentPhase === 'SPEAKING') {
    speakingTimerText.textContent = timeLeft;
    
    // Calculate circular timer stroke dashoffset
    const circleRadius = 52;
    const circumference = 2 * Math.PI * circleRadius;
    const maxTime = parseInt(settingSpeakingTime.value) || 15;
    const offset = circumference - (timeLeft / maxTime) * circumference;
    timerCircleIndicator.style.strokeDashoffset = offset;

    // Pulse red border on low time
    if (timeLeft <= 5) {
      timerRingWrapper.classList.add('timer-warning');
      playSound('tick');
    } else {
      timerRingWrapper.classList.remove('timer-warning');
    }
  } else if (currentPhase === 'VOTING') {
    votingTimerDisplay.textContent = `${timeLeft}s`;
  }
});

// Update active speaker turn
socket.on('speakingTurnUpdate', ({ activeSpeakerId: speakerId, timeLeft, index, total }) => {
  currentPhase = 'SPEAKING';
  showScreen(speakingScreen);

  const isZen = (settingGameMode.value === 'zen');
  
  if (isZen) {
    speakingTurnProgress.textContent = 'Zen Mode: Free Discussion';
    timerRingWrapper.classList.add('hidden');
    speakingQueueNodes.innerHTML = '';
    
    // Customize Speaker box to show general discussion info
    speakerAvatarBubble.style.backgroundImage = 'none';
    speakerAvatarBubble.textContent = '💬';
    speakerNameDisplay.textContent = 'Free Discussion';
    speakingSubtext.textContent = 'Discuss the words. Anyone can call a vote when ready.';
    
    btnPassTurn.classList.add('hidden');
    btnStartVoting.classList.remove('hidden');
  } else {
    timerRingWrapper.classList.remove('hidden');
    btnStartVoting.classList.add('hidden');
    
    activeSpeakerId = speakerId;
    speakingTurnProgress.textContent = `Player ${index} of ${total}`;
    speakingTimerText.textContent = timeLeft;

    // Initialize ring circle stroke progress
    const circleRadius = 52;
    const circumference = 2 * Math.PI * circleRadius;
    timerCircleIndicator.style.strokeDasharray = `${circumference} ${circumference}`;
    timerCircleIndicator.style.strokeDashoffset = 0;

    // Render queue list progress dots
    speakingQueueNodes.innerHTML = '';
    roomPlayers.filter(p => !p.isEliminated).forEach((p, idx) => {
      const node = document.createElement('div');
      node.className = `queue-node${idx === (index - 1) ? ' active' : ''}${idx < (index - 1) ? ' done' : ''}`;
      renderAvatar(node, p.avatar);
      speakingQueueNodes.appendChild(node);
    });

    // Render speaker details
    const currentSpeaker = roomPlayers.find(p => p.id === speakerId || p.sessionToken === speakerId);
    if (currentSpeaker) {
      renderAvatar(speakerAvatarBubble, currentSpeaker.avatar);
      speakerNameDisplay.textContent = currentSpeaker.name;
      
      const isMeSpeaking = (currentSpeaker.id === socket.id || currentSpeaker.sessionToken === sessionToken);
      btnPassTurn.classList.toggle('hidden', !isMeSpeaking);
      
      if (isMeSpeaking) {
        speakingSubtext.textContent = 'Speak now! Click Pass Turn when done.';
        if ('vibrate' in navigator) {
          navigator.vibrate(100);
        }
      } else {
        speakingSubtext.textContent = 'Please listen to the active player.';
      }
    }
  }
});

socket.on('phaseTransition', ({ phase, timeLeft, players }) => {
  currentPhase = phase;
  if (phase === 'VOTING') {
    selectedVoteToken = null;
    votedCountRatio.textContent = `0/${players.length}`;
    votingTimerDisplay.textContent = `${timeLeft}s`;
    showScreen(votingScreen);

    // Check if local player is eliminated
    const me = roomPlayers.find(pl => pl.sessionToken === sessionToken || pl.id === socket.id);
    if (me && me.isEliminated) {
      votingCardsContainer.innerHTML = '<p style="text-align: center; color: var(--accent-danger); font-size: 1.1rem; padding: 20px; grid-column: span 2;">You are eliminated and cannot vote.</p>';
      return;
    }

    // Render player vote option buttons
    votingCardsContainer.innerHTML = '';
    players.forEach(p => {
      const isMe = (p.id === socket.id || p.id === sessionToken);
      if (isMe) return; // Cannot vote self
      if (p.isEliminated) return; // Cannot vote for eliminated players

      const card = document.createElement('div');
      card.className = 'vote-card';
      card.dataset.token = p.id;
      
      const avatar = document.createElement('div');
      avatar.className = 'player-avatar';
      renderAvatar(avatar, p.avatar);
      card.appendChild(avatar);

      const name = document.createElement('div');
      name.className = 'player-name';
      name.textContent = p.name;
      card.appendChild(name);

      card.addEventListener('click', () => {
        document.querySelectorAll('.vote-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedVoteToken = p.id;
        socket.emit('castVote', { targetToken: selectedVoteToken });
        playSound('tick');
      });

      votingCardsContainer.appendChild(card);
    });
  }
});

socket.on('voteProgressUpdate', ({ votedCount, totalCount }) => {
  votedCountRatio.textContent = `${votedCount}/${totalCount}`;
});

// Announce tie-breakers
socket.on('announceTie', ({ tiedPlayerTokens }) => {
  showScreen(voteRevealScreen);
  eliminationAnnounceBox.innerHTML = `
    <h3 style="color: var(--accent-warning); margin-bottom: 8px;">It's a Tie!</h3>
    <p>A tie occurred between players. Setting up a Sudden-Death Re-vote!</p>
  `;
  playSound('eliminate');
});

// Reveal vote results
socket.on('voteReveal', ({ votes, tallies, votesReceived, eliminatedPlayerName, isImposterEliminated, winner, scoreboard }) => {
  currentPhase = 'VOTE_REVEAL';
  showScreen(voteRevealScreen);

  // Build grid of voting results
  voteRevealPlayers.innerHTML = '';
  roomPlayers.filter(p => !p.isEliminated).forEach(p => {
    const card = document.createElement('div');
    card.className = 'vote-card';
    
    const avatar = document.createElement('div');
    avatar.className = 'player-avatar';
    renderAvatar(avatar, p.avatar);
    card.appendChild(avatar);

    const name = document.createElement('div');
    name.className = 'player-name';
    name.textContent = p.name;
    card.appendChild(name);

    // List of players who voted for this target
    const voters = votesReceived[p.sessionToken] || [];
    const votersList = document.createElement('div');
    votersList.className = 'voters-container';

    if (voters.length > 0) {
      voters.forEach(vName => {
        const voterBadge = document.createElement('div');
        voterBadge.className = 'voter-mini-avatar';
        // Get first character of target's name as mini representation
        voterBadge.textContent = vName.substring(0, 1);
        voterBadge.title = `Voted by ${vName}`;
        votersList.appendChild(voterBadge);
      });
    } else {
      votersList.style.height = '20px';
    }
    card.appendChild(votersList);

    const tally = document.createElement('span');
    tally.style.marginTop = '8px';
    tally.style.fontWeight = 'bold';
    tally.textContent = `Votes: ${tallies[p.sessionToken] || 0}`;
    card.appendChild(tally);

    voteRevealPlayers.appendChild(card);
  });

  // Display elimination card details
  eliminationAnnounceBox.innerHTML = `
    <h3 style="font-size: 1.6rem; color: var(--accent-danger); margin-bottom: 8px;">${eliminatedPlayerName}</h3>
    <p>${eliminatedPlayerName === 'Nobody' ? 'No one was eliminated this round.' : 'Has been eliminated by vote.'}</p>
    ${eliminatedPlayerName !== 'Nobody' ? `<p style="font-weight: bold; margin-top: 4px;">Role was: ${isImposterEliminated ? '🕵️‍♂️ IMPOSTER' : 'Civilian'}</p>` : ''}
  `;
  playSound('eliminate');

  if (winner) {
    setTimeout(() => {
      showScoreboardScreen(winner, scoreboard);
    }, 5000);
  }
});

// Render final scoreboards & results
function showScoreboardScreen(winner, scoreboard) {
  currentPhase = 'RESULTS';
  showScreen(resultsScreen);
  playSound('victory');

  victoryTitle.textContent = winner === 'CIVILIANS' ? 'Civilians Win!' : 'Imposter Wins!';
  victoryTitle.className = winner === 'CIVILIANS' ? 'civilians-win-reveal' : 'imposter-win-reveal';
  victorySub.textContent = winner === 'CIVILIANS' ? 'The Imposter was successfully detected.' : 'The Imposter successfully hid their identity!';

  scoreboardRows.innerHTML = '';
  scoreboard.forEach(p => {
    const row = document.createElement('tr');
    
    // Player cell with avatar
    const nameCell = document.createElement('td');
    const avatarSpan = document.createElement('span');
    avatarSpan.style.display = 'inline-block';
    avatarSpan.style.width = '24px';
    avatarSpan.style.height = '24px';
    avatarSpan.style.borderRadius = '50%';
    avatarSpan.style.verticalAlign = 'middle';
    avatarSpan.style.marginRight = '8px';
    renderAvatar(avatarSpan, p.avatar);
    nameCell.appendChild(avatarSpan);
    nameCell.appendChild(document.createTextNode(` ${p.name}`));
    row.appendChild(nameCell);

    // Role cell
    const roleCell = document.createElement('td');
    roleCell.textContent = p.isImposter ? 'Imposter' : 'Civilian';
    row.appendChild(roleCell);

    // Secret Word cell
    const wordCell = document.createElement('td');
    wordCell.textContent = p.word;
    row.appendChild(wordCell);

    // Win status cell
    const statusCell = document.createElement('td');
    const playerWon = (winner === 'CIVILIANS' && !p.isImposter) || (winner === 'IMPOSTER' && p.isImposter);
    statusCell.textContent = playerWon ? '🏆 Win' : 'Defeat';
    statusCell.style.color = playerWon ? 'var(--accent-success)' : 'var(--accent-danger)';
    row.appendChild(statusCell);

    scoreboardRows.appendChild(row);

    // Save statistics for local user
    if (p.name === myName) {
      userStats = p.stats;
      localStorage.setItem('imposter_stats', JSON.stringify(userStats));
      updateStatsUI();
    }
  });

  // Return to Lobby & Play Again buttons visibility
  btnPlayAgain.classList.toggle('hidden', !isHost);
  btnLobbyReturn.classList.toggle('hidden', !isHost);
}

btnLobbyReturn.addEventListener('click', () => {
  socket.emit('returnToLobby');
});

btnPlayAgain.addEventListener('click', () => {
  socket.emit('playAgain');
});

// Reaction Broadcasting
window.sendReaction = function(emoji) {
  socket.emit('triggerReaction', { emoji });
  
  // Find local player node card
  const cards = document.querySelectorAll('.player-lobby-card');
  let myCard = null;
  cards.forEach(c => {
    if (c.classList.contains('is-you')) myCard = c;
  });

  if (myCard) {
    spawnFloatingEmoji(emoji, myCard.querySelector('.player-avatar') || myCard);
  }
};

socket.on('receiveReaction', ({ senderId, emoji }) => {
  // Find sender avatar
  const selector = currentPhase === 'LOBBY' ? '.player-lobby-card' : '.vote-card';
  const cards = document.querySelectorAll(selector);
  
  let target = null;
  cards.forEach(c => {
    if (c.dataset.token === senderId || c.querySelector('.player-name')?.textContent.includes(roomPlayers.find(p => p.sessionToken === senderId)?.name)) {
      target = c;
    }
  });

  if (target) {
    spawnFloatingEmoji(emoji, target.querySelector('.player-avatar') || target);
  }
});

btnStartVoting.addEventListener('click', () => {
  socket.emit('callVote');
});

socket.on('cooldownUpdate', ({ cooldownLeft }) => {
  if (cooldownLeft > 0) {
    btnStartVoting.disabled = true;
    btnStartVoting.textContent = `Start Voting (${cooldownLeft}s)`;
    btnStartVoting.style.opacity = '0.5';
  } else {
    btnStartVoting.disabled = false;
    btnStartVoting.textContent = 'Start Voting';
    btnStartVoting.style.opacity = '1';
  }
});
