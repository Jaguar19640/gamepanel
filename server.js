const app = require('./src/app');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

// Datenbank direkt beim Start importieren und Status korrigieren
const db = require('./src/database');
db.prepare("UPDATE servers SET status = 'offline' WHERE status = 'online' OR status = 'installing' OR status = 'booting'").run();
console.log('Server-Status beim Start zurückgesetzt');

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.setIo(io);
require('./src/socket/console')(io);

server.listen(PORT, () => {
  console.log(`GamePanel läuft auf http://localhost:${PORT}`);
});