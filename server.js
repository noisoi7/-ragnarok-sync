const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 5e6 // 5MB — for audio blob transfer
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// roomId -> { host, guests: [{socketId, deviceIndex}], guestCount }
const rooms = new Map();

io.on('connection', (socket) => {

  // ── Latency ping ────────────────────────────────────────────────────
  socket.on('ping', ({ t }) => socket.emit('pong', { t }));

  // ── Host creates room ────────────────────────────────────────────────
  socket.on('create-room', () => {
    const roomId = uuidv4().replace(/-/g, '').slice(0, 10);
    rooms.set(roomId, { host: socket.id, guests: [], guestCount: 0 });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = 'host';
    socket.data.deviceIndex = 0;
    socket.emit('room-created', { roomId, deviceIndex: 0 });
    console.log(`[Room] Created: ${roomId}`);
  });

  // ── Guest joins room ─────────────────────────────────────────────────
  socket.on('join-room', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) { socket.emit('join-error', { message: 'Room not found.' }); return; }

    const deviceIndex = room.guests.length + 1; // host is 0, guests are 1,2,3...
    room.guests.push({ socketId: socket.id, deviceIndex });
    room.guestCount++;
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = 'guest';
    socket.data.deviceIndex = deviceIndex;
    socket.emit('joined-room', { roomId, deviceIndex });
    io.to(roomId).emit('guest-count', { count: room.guestCount });
    console.log(`[Room] ${socket.id} joined ${roomId} as device #${deviceIndex}`);
  });

  // ── MODE: RAGNARÖK — synchronized scream ────────────────────────────
  socket.on('trigger-scream', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.host !== socket.id) return;
    const playAt = Date.now() + 2000;
    io.to(roomId).emit('play-scream', { playAt });
    console.log(`[Ragnarök] Room ${roomId} → scream at ${playAt}`);
  });

  // ── MODE: SHADOW CLONE — staggered voice jump ────────────────────────
  socket.on('clone-audio', ({ roomId, audioData }) => {
    const room = rooms.get(roomId);
    if (!room || room.host !== socket.id) return;

    // Build ordered list: host first, then guests by deviceIndex
    const allDevices = [
      { socketId: room.host, deviceIndex: 0 },
      ...room.guests.sort((a, b) => a.deviceIndex - b.deviceIndex)
    ];

    const totalDevices = allDevices.length;
    const GAP_MS = 420; // ms between each clone speaking

    allDevices.forEach(({ socketId, deviceIndex }) => {
      io.to(socketId).emit('play-clone', {
        audioData,
        deviceIndex,
        totalDevices,
        playDelay: deviceIndex * GAP_MS
      });
    });

    console.log(`[Shadow Clone] Room ${roomId} → ${totalDevices} clones`);
  });

  // ── Disconnect ───────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const { roomId, role } = socket.data;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    if (role === 'host') {
      io.to(roomId).emit('host-left');
      rooms.delete(roomId);
    } else {
      room.guests = room.guests.filter(g => g.socketId !== socket.id);
      room.guestCount = Math.max(0, room.guestCount - 1);
      io.to(roomId).emit('guest-count', { count: room.guestCount });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`\n🔱 Ragnarök Sync → http://localhost:${PORT}\n`));
