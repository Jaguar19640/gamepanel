module.exports = (io) => {
  io.on('connection', (socket) => {
    console.log('Browser verbunden:', socket.id);

    // Client registriert sich für Server-Updates
    socket.on('watch-server', (serverId) => {
      socket.join(`server-${serverId}`);
    });

    socket.on('unwatch-server', (serverId) => {
      socket.leave(`server-${serverId}`);
    });

    socket.emit('log', {
      time: new Date().toLocaleTimeString(),
      type: 'info',
      message: 'GamePanel Console bereit'
    });

    socket.on('disconnect', () => {
      console.log('Browser getrennt:', socket.id);
    });
  });
};