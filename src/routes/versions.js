const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');
const { getVersions } = require('../versions');

const cache = new Map();
const CACHE_TIME = 10 * 60 * 1000;

// Fallback-Versionen falls API nicht erreichbar
const FALLBACKS = {
  vanilla: ['1.21.1','1.21','1.20.6','1.20.4','1.20.1','1.19.4','1.18.2','1.17.1','1.16.5','1.12.2','1.8.9'],
  paper:   ['1.21.1','1.21','1.20.6','1.20.4','1.20.1','1.19.4','1.18.2','1.17.1','1.16.5'],
  purpur:  ['1.21.1','1.21','1.20.6','1.20.4','1.20.1','1.19.4','1.18.2'],
  fabric:  ['1.21.1','1.21','1.20.6','1.20.4','1.20.1','1.19.4','1.18.2','1.17.1'],
  forge:   ['1.20.1','1.19.4','1.18.2','1.16.5','1.12.2','1.7.10'],
  neoforge:['21.1.228','21.4.93','21.3.88','21.0.167','20.6.119','20.4.237'],
  spigot:  ['1.21.1','1.21','1.20.4','1.20.1','1.19.4','1.18.2','1.16.5','1.12.2','1.8.8'],
  quilt: ['1.21.1','1.21','1.20.6','1.20.4','1.20.1','1.19.4','1.18.2','1.17.1'],
};

router.get('/:loader', requireAuth, async (req, res) => {
  const { loader } = req.params;
  const includeBeta = req.query.beta === 'true';
  const cacheKey = loader + (includeBeta ? '-beta' : '');
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.time < CACHE_TIME) {
    return res.json(cached.data);
  }

  try {
    const versions = await getVersions(loader, includeBeta);
    const list = Array.isArray(versions) ? versions : [];
    if (list.length === 0) throw new Error('Keine Versionen erhalten');
    cache.set(cacheKey, { data: list, time: Date.now() });
    res.json(list);
  } catch (e) {
    console.error(`Versions-API Fehler für ${loader}:`, e.message);
    // Fallback nutzen
    const fallback = FALLBACKS[loader] || [];
    console.log(`Nutze Fallback für ${loader}: ${fallback.length} Versionen`);
    res.json(fallback);
  }
});

module.exports = router;