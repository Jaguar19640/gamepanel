const app = require('./src/app');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

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