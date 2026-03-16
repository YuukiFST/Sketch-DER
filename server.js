const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "https://yuukifst.github.io",
      "http://localhost:3000",
      "http://127.0.0.1:5500",
      "http://localhost:5500",
      "http://localhost:8000"
    ],
    methods: ["GET", "POST"]
  }
});

// Estrutura: { [roomCode]: { users: Map<socketId, userInfo>, derState: string } }
const rooms = new Map();

const MAX_USERS_PER_ROOM = 4;

// Gera código de sala: "DER-XXXX" com 4 hex chars aleatórios
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'DER-';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Garante que o código seja único entre as salas ativas
function getUniqueRoomCode() {
  let code;
  do {
    code = generateRoomCode();
  } while (rooms.has(code));
  return code;
}

// Cores fixas atribuídas por ordem de entrada na sala
const USER_COLORS = ['#E74C3C', '#2ECC71', '#3498DB', '#F39C12'];

io.on('connection', (socket) => {

  // === CRIAR SALA ===
  socket.on('create_room', ({ userName, derState }) => {
    const roomCode = getUniqueRoomCode();
    const userColor = USER_COLORS[0];

    rooms.set(roomCode, {
      users: new Map([[socket.id, { name: userName, color: userColor, order: 0 }]]),
      derState: derState || ''
    });

    socket.join(roomCode);
    socket.roomCode = roomCode;

    socket.emit('room_created', {
      roomCode,
      userColor,
      users: [{ id: socket.id, name: userName, color: userColor }]
    });
  });

  // === ENTRAR EM SALA EXISTENTE ===
  socket.on('join_room', ({ roomCode, userName }) => {
    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit('join_error', { message: 'Sala não encontrada. Verifique o código.' });
      return;
    }

    if (room.users.size >= MAX_USERS_PER_ROOM) {
      socket.emit('join_error', { message: 'Sala cheia (máximo 4 usuários).' });
      return;
    }

    // Descobre qual cor ainda não está em uso
    const usedOrders = Array.from(room.users.values()).map(u => u.order);
    const order = [0, 1, 2, 3].find(i => !usedOrders.includes(i));
    const userColor = USER_COLORS[order];

    room.users.set(socket.id, { name: userName, color: userColor, order });
    socket.join(roomCode);
    socket.roomCode = roomCode;

    // Lista de usuários já na sala (para mostrar no painel)
    const userList = Array.from(room.users.entries()).map(([id, u]) => ({
      id, name: u.name, color: u.color
    }));

    // Envia ao recém-chegado o estado atual do DER
    socket.emit('room_joined', {
      roomCode,
      userColor,
      derState: room.derState,
      users: userList
    });

    // Avisa os outros que alguém entrou
    socket.to(roomCode).emit('user_joined', {
      id: socket.id,
      name: userName,
      color: userColor,
      users: userList
    });
  });

  // === MOVIMENTO DE CURSOR ===
  // Emitido pelo frontend a cada mousemove (throttled a 40ms)
  socket.on('cursor_move', ({ x, y }) => {
    if (!socket.roomCode) return;
    socket.to(socket.roomCode).emit('cursor_update', {
      userId: socket.id,
      x, y
    });
  });

  // === ELEMENTO MOVIDO (entidade ou relacionamento arrastado) ===
  socket.on('element_moved', ({ elementId, elementType, x, y }) => {
    if (!socket.roomCode) return;
    socket.to(socket.roomCode).emit('element_moved', {
      userId: socket.id,
      elementId,
      elementType, // 'entity' | 'relationship' | 'attribute' | 'cardinality'
      x, y
    });
  });

  // === DER REGENERADO (usuário clicou "Gerar DER" com novo script) ===
  socket.on('der_regenerated', ({ scriptText, fullState }) => {
    if (!socket.roomCode) return;
    const room = rooms.get(socket.roomCode);
    if (room) room.derState = fullState;

    socket.to(socket.roomCode).emit('der_regenerated', {
      userId: socket.id,
      scriptText,
      fullState
    });
  });

  // === PROPRIEDADES EDITADAS (painel de propriedades de entidade/atributo) ===
  socket.on('properties_changed', ({ elementId, elementType, changes }) => {
    if (!socket.roomCode) return;
    socket.to(socket.roomCode).emit('properties_changed', {
      userId: socket.id,
      elementId,
      elementType,
      changes
    });
  });

  // === ESTADO COMPLETO ATUALIZADO (salvo periodicamente pelo host) ===
  socket.on('state_sync', ({ fullState }) => {
    if (!socket.roomCode) return;
    const room = rooms.get(socket.roomCode);
    if (room) room.derState = fullState;
  });

  // === DESCONEXÃO ===
  socket.on('disconnect', () => {
    if (!socket.roomCode) return;
    const room = rooms.get(socket.roomCode);
    if (!room) return;

    const user = room.users.get(socket.id);
    room.users.delete(socket.id);

    if (room.users.size === 0) {
      // Último usuário saiu: destrói a sala
      rooms.delete(socket.roomCode);
    } else {
      // Avisa os demais
      const userList = Array.from(room.users.entries()).map(([id, u]) => ({
        id, name: u.name, color: u.color
      }));
      io.to(socket.roomCode).emit('user_left', {
        id: socket.id,
        name: user ? user.name : 'Usuário',
        users: userList
      });
    }
  });
});

app.get('/', (req, res) => res.send('Sketch-DER collaboration server running.'));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
