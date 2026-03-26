const socket = io('https://memory-battle.onrender.com/', {
     reconnection: true,
     reconnectionDelay: 1000,
     reconnectionDelayMax: 5000,
     reconnectionAttempts: 5,
     transports: ['websocket', 'polling']
   });

// State
let currentRoom = null;
let playerName = null;
let isHost = false;
let isMyTurn = false;
let ruleShowTimeout = null;

// Screen navigation
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
  });
  document.getElementById(screenId).classList.add('active');
}

// Home screen buttons
document.getElementById('createRoomBtn').addEventListener('click', () => {
  showScreen('createRoomScreen');
});

document.getElementById('joinRoomBtn').addEventListener('click', () => {
  showScreen('joinRoomScreen');
});

document.getElementById('backFromCreateBtn').addEventListener('click', () => {
  showScreen('homeScreen');
});

document.getElementById('backFromJoinBtn').addEventListener('click', () => {
  showScreen('homeScreen');
});

document.getElementById('homeBtn').addEventListener('click', () => {
  location.reload();
});

// Create room
document.getElementById('createRoomSubmitBtn').addEventListener('click', () => {
  const name = document.getElementById('createName').value.trim();
  if (!name) {
    alert('Please enter your name');
    return;
  }
  playerName = name; // ← SET PLAYERNAME!
  socket.emit('createRoom', { name });
});

// Join room
document.getElementById('joinRoomSubmitBtn').addEventListener('click', () => {
  const name = document.getElementById('joinName').value.trim();
  const roomCode = document.getElementById('roomCode').value.trim();
  if (!name || !roomCode) {
    alert('Please enter your name and room code');
    return;
  }
  playerName = name; // ← SET PLAYERNAME!
  socket.emit('joinRoom', { roomCode, name });
});

// Copy room code

document.getElementById('backFromLobbyBtn').addEventListener('click', () => {
  // simply go back to the home screen; reloading also clears state
  location.reload();
});

document.getElementById('backFromGameBtn').addEventListener('click', () => {
  // navigate back to lobby. we don't reload so the room remains available
  showScreen('lobbyScreen');
});
document.getElementById('copyCodeBtn').addEventListener('click', () => {
  const roomCode = document.getElementById('lobbyRoomCode').textContent;
  navigator.clipboard.writeText(roomCode);
  alert('Room code copied to clipboard!');
});

// Start game
document.getElementById('startGameBtn').addEventListener('click', () => {
  socket.emit('startGame', { roomCode: currentRoom });
});

// Player move
document.getElementById('submitBtn').addEventListener('click', () => {
  const input = document.getElementById('playerInput').value.trim();
  if (!input) {
    showHint('Please enter something', 'error');
    return;
  }
  socket.emit('playerMove', { roomCode: currentRoom, inputValue: input });
  document.getElementById('playerInput').value = '';
});

// Allow Enter key for input
document.getElementById('playerInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('submitBtn').click();
  }
});

// Rule type selection
document.querySelectorAll('.rule-type-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.rule-type-btn').forEach(b => {
      b.classList.remove('selected');
    });
    this.classList.add('selected');

    document.querySelectorAll('.rule-form').forEach(form => {
      form.style.display = 'none';
    });

    const ruleType = this.dataset.rule;
    if (ruleType === 'replace') {
      document.getElementById('replaceRuleForm').style.display = 'block';
    } else if (ruleType === 'swap') {
      document.getElementById('swapRuleForm').style.display = 'block';
    } else if (ruleType === 'reverse') {
      document.getElementById('reverseRuleForm').style.display = 'block';
    }
  });
});

// Replace rule submission
document.getElementById('submitReplaceBtn').addEventListener('click', () => {
  const pos = parseInt(document.getElementById('replacePos').value);
  const value = document.getElementById('replaceValue').value.trim();

  if (!pos || pos < 1 || pos > 10) {
    alert('Position must be between 1 and 10');
    return;
  }
  if (!value) {
    alert('Please enter a value');
    return;
  }

  const rule = {
    type: 'replace',
    position: pos,
    value: value,
    description: `Position ${pos} → "${value}"`
  };

  socket.emit('addRule', { roomCode: currentRoom, ruleData: rule });
  clearRuleForm();
});

// Swap rule submission
document.getElementById('submitSwapBtn').addEventListener('click', () => {
  const pos1 = parseInt(document.getElementById('swapPos1').value);
  const pos2 = parseInt(document.getElementById('swapPos2').value);

  if (!pos1 || pos1 < 1 || pos1 > 10 || !pos2 || pos2 < 1 || pos2 > 10) {
    alert('Positions must be between 1 and 10');
    return;
  }
  if (pos1 === pos2) {
    alert('Positions must be different');
    return;
  }

  const rule = {
    type: 'swap',
    pos1: pos1,
    pos2: pos2,
    description: `Swap positions ${pos1} and ${pos2}`
  };

  socket.emit('addRule', { roomCode: currentRoom, ruleData: rule });
  clearRuleForm();
});

// Reverse rule submission
document.getElementById('submitReverseBtn').addEventListener('click', () => {
  const rule = {
    type: 'reverse',
    description: '↩️ REVERSE the sequence!'
  };

  socket.emit('addRule', { roomCode: currentRoom, ruleData: rule });
  clearRuleForm();
});

// ================================================================
// SOCKET EVENTS
// ================================================================

socket.on('roomCreated', (data) => {
  currentRoom = data.roomCode;
  isHost = true;
  showScreen('lobbyScreen');
  document.getElementById('lobbyRoomCode').textContent = currentRoom;
  updatePlayersList([{ name: playerName, active: true }]);
  console.log('Room created. Your name:', playerName);
});

socket.on('roomJoined', (data) => {
  currentRoom = data.roomCode;
  showScreen('lobbyScreen');
  document.getElementById('lobbyRoomCode').textContent = currentRoom;
  updatePlayersList(data.players);
  console.log('Room joined. Your name:', playerName);
});

socket.on('playerListUpdated', (data) => {
  updatePlayersList(data.players);
});

socket.on('gameStarted', (data) => {
  showScreen('gameScreen');
  document.getElementById('roundNumber').textContent = '1';
  updateGamePlayersList(data.players);
  updateTurnInfo(data.currentPlayerName);
  document.getElementById('countingPhase').style.display = 'block';
  document.getElementById('ruleCreationPhase').style.display = 'none';
  checkIfMyTurn(data.currentPlayerName);
  console.log('Game started. Current player:', data.currentPlayerName, 'Your name:', playerName);
});

socket.on('updateTurn', (data) => {
  updateTurnInfo(data.currentPlayerName);
  updateGamePlayersList(data.players);
  checkIfMyTurn(data.currentPlayerName);
  document.getElementById('countingPhase').style.display = 'block';
  document.getElementById('ruleCreationPhase').style.display = 'none';
  console.log('Turn updated to:', data.currentPlayerName);
});

socket.on('ruleCreationTurn', (data) => {
  checkIfMyTurn(data.playerName);
  if (isMyTurn) {
    document.getElementById('countingPhase').style.display = 'none';
    document.getElementById('ruleCreationPhase').style.display = 'block';
    document.querySelectorAll('.rule-type-btn').forEach(btn => {
      btn.classList.remove('selected');
    });
    document.querySelectorAll('.rule-form').forEach(form => {
      form.style.display = 'none';
    });
  }
});

socket.on('ruleAdded', (data) => {
  console.log('🎉 ruleAdded EVENT RECEIVED');
  console.log('Rule:', data.rule.description);
  console.log('Current player:', data.currentPlayerName);
  console.log('Your name:', playerName);
  console.log('Round:', data.round);
  
  updateTurnInfo(data.currentPlayerName);
  document.getElementById('roundNumber').textContent = data.round;
  checkIfMyTurn(data.currentPlayerName);
  document.getElementById('countingPhase').style.display = 'block';
  document.getElementById('ruleCreationPhase').style.display = 'none';
  updateGamePlayersList(data.players);

  // Show rule popup for 5 seconds - THIS IS THE ONLY PLACE RULES ARE SHOWN
  showRulePopup(data.rule.description);
});

socket.on('playerEliminated', (data) => {
  const message = `❌ ${data.eliminatedPlayer} got it wrong!\nPosition ${data.position}: Said "${data.wrongAnswer}", should be "${data.correctAnswer}"\n\n🔄 NEW ROUND starts at 1!`;
  showPopup(message);
  updateGamePlayersList(data.players);
});

socket.on('gameOver', (data) => {
  showScreen('gameOverScreen');
  document.getElementById('gameOverMessage').textContent = `🏆 ${data.winner} wins!`;
});

socket.on('error', (message) => {
  alert('Error: ' + message);
});

// ================================================================
// HELPER FUNCTIONS
// ================================================================

function updatePlayersList(players) {
  const list = document.getElementById('playersList');
  list.innerHTML = '';
  players.forEach(player => {
    const li = document.createElement('li');
    li.textContent = player.name;
    list.appendChild(li);
  });

  // Check if we can start
  if (isHost && players.length >= 3) {
    document.getElementById('startGameContainer').style.display = 'block';
    document.getElementById('waitingMsg').style.display = 'none';
  } else if (isHost) {
    document.getElementById('startGameContainer').style.display = 'none';
    document.getElementById('waitingMsg').style.display = 'block';
  }
}

function updateGamePlayersList(players) {
  const list = document.getElementById('gamePlayersList');
  list.innerHTML = '';
  players.forEach(player => {
    const li = document.createElement('li');
    li.textContent = player.name;
    if (player.active) {
      li.classList.add('active');
    } else {
      li.classList.add('eliminated');
    }
    list.appendChild(li);
  });
}

function updateTurnInfo(currentPlayerName) {
  document.getElementById('currentPlayerName').textContent = currentPlayerName;
}

function checkIfMyTurn(currentPlayerName) {
  isMyTurn = currentPlayerName === playerName;
  const submitBtn = document.getElementById('submitBtn');
  const input = document.getElementById('playerInput');

  if (isMyTurn) {
    input.disabled = false;
    submitBtn.disabled = false;
    input.style.opacity = '1';
    submitBtn.style.opacity = '1';
    showHint('✓ Your turn! Enter your answer.');
  } else {
    input.disabled = true;
    submitBtn.disabled = true;
    input.style.opacity = '0.5';
    submitBtn.style.opacity = '0.5';
    showHint(`⏳ Waiting for ${currentPlayerName}...`);
  }
  
  console.log('Check turn - Current:', currentPlayerName, 'Me:', playerName, 'MyTurn:', isMyTurn);
}

function showHint(message, type = 'normal') {
  const hint = document.getElementById('inputHint');
  hint.textContent = message;
  hint.className = 'hint ' + type;
}

function showRulePopup(ruleText) {
  console.log('showRulePopup called with:', ruleText);
  const popup = document.getElementById('rulePopup');
  console.log('Popup element:', popup);
  document.getElementById('rulePopupText').textContent = ruleText;
  popup.classList.add('show');
  console.log('Popup classes:', popup.className);

  // Clear any previous timeout
  if (ruleShowTimeout) clearTimeout(ruleShowTimeout);

  // Hide after 5 seconds
  ruleShowTimeout = setTimeout(() => {
    console.log('Hiding rule popup');
    popup.classList.remove('show');
  }, 5000);
}

function showPopup(message) {
  alert(message);
}

function clearRuleForm() {
  document.getElementById('replacePos').value = '';
  document.getElementById('replaceValue').value = '';
  document.getElementById('swapPos1').value = '';
  document.getElementById('swapPos2').value = '';
  document.querySelectorAll('.rule-type-btn').forEach(btn => {
    btn.classList.remove('selected');
  });
  document.querySelectorAll('.rule-form').forEach(form => {
    form.style.display = 'none';
  });
}

// Initialize
showScreen('homeScreen');