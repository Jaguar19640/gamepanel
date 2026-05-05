const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const { startScheduler } = require('./scheduler');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api/auth', require('./routes/auth'));

const serverRoutes = require('./routes/servers');
app.use('/api/servers', serverRoutes);
app.use('/api/permissions', require('./routes/permissions'));

app.setIo = (io) => { serverRoutes.setIo(io); };

// Scheduler starten
startScheduler();

app.get('/server/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/server.html'));
});

app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

module.exports = app;