const express = require('express');
const router = express.Router();
const si = require('systeminformation');
const { requireAuth } = require('./auth');
const { getServerInfo } = require('../gameserver');
const db = require('../database');

router.get('/stats', requireAuth, async (req, res) => {
  try {
    const [cpu, cpuTemp, mem, gpus, processes, cpuInfo] = await Promise.all([
      si.currentLoad(),
      si.cpuTemperature(),
      si.mem(),
      si.graphics(),
      si.processes(),
      si.cpu()
    ]);

    // Pro-Server Ressourcenverbrauch
    const servers = db.prepare('SELECT * FROM servers WHERE status = ?').all('online');
    const serverStats = [];

    for (const server of servers) {
      const info = getServerInfo(server.id);
      if (!info || !info.pid) continue;

      const serverProcs = processes.list.filter(p =>
        p.pid === info.pid || p.parentPid === info.pid
      );

      const totalCpu = serverProcs.reduce((a, p) => a + (p.cpu || 0), 0);
      const totalMem = serverProcs.reduce((a, p) => a + (p.memRss || 0), 0);

      serverStats.push({
        id: server.id,
        name: server.name,
        game: server.game,
        pid: info.pid,
        uptime: info.uptime,
        cpu: Math.round(totalCpu * 10) / 10,
        ram: Math.round(totalMem / 1024 / 1024 * 10) / 10,
      });
    }

    res.json({
      cpu: {
        load: Math.round(cpu.currentLoad * 10) / 10,
        user: Math.round(cpu.currentLoadUser * 10) / 10,
        system: Math.round(cpu.currentLoadSystem * 10) / 10,
        cores: cpu.cpus.map((c, i) => ({
          core: i + 1,
          load: Math.round(c.load * 10) / 10
        })),
        temp: cpuTemp.main || cpuTemp.cores?.[0] || null,
        temps: cpuTemp.cores || [],
        model: cpuInfo.manufacturer + ' ' + cpuInfo.brand,
        physicalCores: cpuInfo.physicalCores,
        logicalCores: cpuInfo.cores,
        sockets: cpuInfo.processors || 1
      },
      ram: {
        total: Math.round(mem.total / 1024 / 1024 / 1024 * 10) / 10,
        used: Math.round(mem.active / 1024 / 1024 / 1024 * 10) / 10,
        free: Math.round(mem.available / 1024 / 1024 / 1024 * 10) / 10,
        percent: Math.round(mem.active / mem.total * 100)
      },
      gpus: gpus.controllers.map(g => ({
        model: g.model,
        vendor: g.vendor,
        vram: g.vram,
        temp: g.temperatureGpu || null,
        load: g.utilizationGpu || null,
        memLoad: g.utilizationMemory || null
      })),
      servers: serverStats
    });
  } catch (e) {
    console.error('System stats Fehler:', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/drives', requireAuth, async (req, res) => {
  try {
    const fsSize = await si.fsSize();
    const drives = fsSize.map(f => ({
      mount: f.mount,
      type: f.type,
      size: Math.round(f.size / 1024 / 1024 / 1024 * 10) / 10,
      used: Math.round(f.used / 1024 / 1024 / 1024 * 10) / 10,
      free: Math.round((f.size - f.used) / 1024 / 1024 / 1024 * 10) / 10,
      percent: f.use
    }));
    res.json(drives);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;