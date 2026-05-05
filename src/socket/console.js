module.exports = (io) => {
  io.on('connection', (socket) => {
    console.log('Browser verbunden:', socket.id);

    // Testmeldung an den Browser schicken
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