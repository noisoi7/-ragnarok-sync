const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html for any room path
app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const rooms = new Map(); // roomId -> { hostSocketId, guestCount }

io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  // ── Host creates a room ──────────────────────────────────────────────
  socket.on('create-room', () => {
    const roomId = uuidv4().replace(/-/g, '').slice(0, 10);
    rooms.set(roomId, { host: socket.id, guestCount: 0 });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = 'host';
    socket.emit('room-created', { roomId });
    console.log(`[Room] Created: ${roomId} by ${socket.id}`);
  });

  // ── Guest joins a room ───────────────────────────────────────────────
  socket.on('join-room', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('join-error', { message: 'Room not found or expired.' });
      return;
    }
    room.guestCount++;
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = 'guest';
    socket.emit('joined-room', { roomId });
    // Tell everyone (including host) the new count
    io.to(roomId).emit('guest-count', { count: room.guestCount });
    console.log(`[Room] ${socket.id} joined ${roomId}. Guests: ${room.guestCount}`);
  });

  // ── Host pings for latency measurement (client sends ping, gets pong) ─
  socket.on('ping', ({ t }) => {
    socket.emit('pong', { t });
  });

  // ── Host triggers the scream ─────────────────────────────────────────
  socket.on('trigger-scream', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.host !== socket.id) return;

    // Schedule playback 2 seconds from now — gives all clients time to receive & prepare
    const playAt = Date.now() + 2000;
    io.to(roomId).emit('play-scream', { playAt });
    console.log(`[Scream] Room ${roomId} → play at ${playAt}`);
  });

  // ── Cleanup on disconnect ────────────────────────────────────────────
  socket.on('disconnect', () => {
    const { roomId, role } = socket.data;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    if (role === 'host') {
      io.to(roomId).emit('host-left');
      rooms.delete(roomId);
      console.log(`[Room] Host left, room ${roomId} closed`);
    } else {
      room.guestCount = Math.max(0, room.guestCount - 1);
      io.to(roomId).emit('guest-count', { count: room.guestCount });
      console.log(`[Room] Guest left ${roomId}. Guests: ${room.guestCount}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🔱 Ragnarok Sync running → http://localhost:${PORT}\n`);
});
