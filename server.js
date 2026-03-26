const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
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

// ================================================================
// GAME STATE
// ================================================================

// Store rooms: { roomCode: { players, sequence, rules, gameStarted, ... } }
const rooms = {};

// Generate random room code
function generateRoomCode() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

// ================================================================
// SOCKET EVENTS
// ================================================================

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // CREATE ROOM
  socket.on('createRoom', (data) => {
    const roomCode = generateRoomCode();
    const room = {
      code: roomCode,
      host: socket.id,
      players: [{ id: socket.id, name: data.name, active: true }],
      sequence: [1, 2, 3, 4, 5],
      rules: [],
      gameStarted: false,
      currentPlayerIndex: 0,
      round: 1
    };

    rooms[roomCode] = room;
    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode });
    console.log(`Room ${roomCode} created by ${data.name}`);
  });

  // JOIN ROOM
  socket.on('joinRoom', (data) => {
    const { roomCode, name } = data;
    const room = rooms[roomCode];

    if (!room) {
      socket.emit('error', 'Room not found');
      return;
    }

    if (room.gameStarted) {
      socket.emit('error', 'Game already started');
      return;
    }

    // Add player to room
    room.players.push({ id: socket.id, name, active: true });
    socket.join(roomCode);

    socket.emit('roomJoined', { roomCode, players: room.players });
    io.to(roomCode).emit('playerListUpdated', { players: room.players });
    console.log(`${name} joined room ${roomCode}`);
  });

  // START GAME
  socket.on('startGame', (data) => {
    const { roomCode } = data;
    const room = rooms[roomCode];

    if (!room || socket.id !== room.host) {
      socket.emit('error', 'Not authorized');
      return;
    }

    if (room.players.length < 2) {
      socket.emit('error', 'Need at least 2 players');
      return;
    }

    room.gameStarted = true;
    room.currentPlayerIndex = 0;
    room.round = 1;
    room.sequence = [1, 2, 3, 4, 5];
    room.rules = [];

    const currentPlayer = room.players[room.currentPlayerIndex];
    io.to(roomCode).emit('gameStarted', {
      players: room.players,
      currentPlayerName: currentPlayer.name,
      round: room.round
    });

    console.log(`Game started in room ${roomCode}`);
  });

  // PLAYER MOVE (during counting phase)
  socket.on('playerMove', (data) => {
    const { roomCode, inputValue } = data;
    const room = rooms[roomCode];

    if (!room || !room.gameStarted) {
      socket.emit('error', 'Game not active');
      return;
    }

    const currentPlayer = room.players[room.currentPlayerIndex];
    if (currentPlayer.id !== socket.id) {
      socket.emit('error', 'Not your turn');
      return;
    }

    // Get the expected answer from sequence
    const expectedAnswer = String(room.sequence[room.rules.length] || '?');
    const playerAnswer = inputValue.toLowerCase().trim();

    if (playerAnswer === expectedAnswer.toLowerCase()) {
      // Correct! Move to rule creation or next player
      if (room.rules.length < room.sequence.length - 1) {
        // Player creates a rule
        io.to(roomCode).emit('ruleCreationTurn', {
          playerName: currentPlayer.name
        });
      } else {
        // Sequence complete, move to next player
        moveToNextPlayer(room, roomCode);
      }
    } else {
      // Wrong answer - eliminate player
      currentPlayer.active = false;

      const activePlayers = room.players.filter(p => p.active);
      if (activePlayers.length === 1) {
        // Game over!
        room.gameStarted = false;
        io.to(roomCode).emit('gameOver', {
          winner: activePlayers[0].name
        });
        console.log(`Game over in ${roomCode}. Winner: ${activePlayers[0].name}`);
      } else {
        // Announce elimination and restart round
        io.to(roomCode).emit('playerEliminated', {
          eliminatedPlayer: currentPlayer.name,
          position: room.rules.length + 1,
          wrongAnswer: inputValue,
          correctAnswer: expectedAnswer,
          players: room.players
        });

        // Start new round
        room.sequence = [1, 2, 3, 4, 5];
        room.rules = [];
        room.round++;

        moveToNextPlayer(room, roomCode);
      }
    }
  });

  // ADD RULE (after correct answer)
  socket.on('addRule', (data) => {
    const { roomCode, ruleData } = data;
    const room = rooms[roomCode];

    if (!room || !room.gameStarted) {
      socket.emit('error', 'Game not active');
      return;
    }

    // Add rule
    room.rules.push(ruleData);
    applyRule(room, ruleData);

    // Move to next player
    moveToNextPlayer(room, roomCode);

    // Broadcast rule and new turn
    const nextPlayer = room.players[room.currentPlayerIndex];
    io.to(roomCode).emit('ruleAdded', {
      rule: ruleData,
      currentPlayerName: nextPlayer.name,
      players: room.players,
      round: room.round
    });
  });

  // DISCONNECT
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    // Remove player from all rooms
    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      const playerIndex = room.players.findIndex(p => p.id === socket.id);

      if (playerIndex !== -1) {
        const playerName = room.players[playerIndex].name;
        room.players.splice(playerIndex, 1);

        if (room.players.length === 0) {
          // Delete empty room
          delete rooms[roomCode];
          console.log(`Room ${roomCode} deleted`);
        } else {
          // Update players list
          io.to(roomCode).emit('playerListUpdated', { players: room.players });
          console.log(`${playerName} removed from room ${roomCode}`);
        }
      }
    }
  });
});

// ================================================================
// HELPER FUNCTIONS
// ================================================================

function moveToNextPlayer(room, roomCode) {
  // Find next active player
  let nextIndex = room.currentPlayerIndex + 1;
  while (nextIndex < room.players.length && !room.players[nextIndex].active) {
    nextIndex++;
  }

  // Wrap around if needed
  if (nextIndex >= room.players.length) {
    nextIndex = 0;
    while (nextIndex < room.players.length && !room.players[nextIndex].active) {
      nextIndex++;
    }
  }

  room.currentPlayerIndex = nextIndex;

  // Reset rules for new turn
  room.rules = [];

  const currentPlayer = room.players[room.currentPlayerIndex];
  io.to(roomCode).emit('updateTurn', {
    currentPlayerName: currentPlayer.name,
    players: room.players
  });
}

function applyRule(room, rule) {
  const seq = room.sequence;

  if (rule.type === 'replace') {
    const pos = rule.position - 1; // Convert to 0-indexed
    if (pos >= 0 && pos < seq.length) {
      seq[pos] = rule.value;
    }
  } else if (rule.type === 'swap') {
    const pos1 = rule.pos1 - 1;
    const pos2 = rule.pos2 - 1;
    if (pos1 >= 0 && pos1 < seq.length && pos2 >= 0 && pos2 < seq.length) {
      [seq[pos1], seq[pos2]] = [seq[pos2], seq[pos1]];
    }
  } else if (rule.type === 'reverse') {
    room.sequence = seq.reverse();
  }
}

// ================================================================
// START SERVER
// ================================================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 Memory Battle server running on port ${PORT}`);
});