'use strict';
// Holt die Einspeisewerte aus dem Westnetz-Portal, rechnet sie zu Stundensummen um und schreibt sie
// verschlüsselt nach site/data.enc.json. Optional liefert es einen Zugriffsschlüssel für die sonnen-Live-Werte mit.
// Läuft in GitHub Actions (Zugangsdaten als Secrets) oder lokal.
//   Umgebung: MEDACO_USER, MEDACO_PASSWORD, DATA_KEY (Zugangscode für die Handy-Seite)
//   Optional: TOKEN_KEY, SONNEN_SEED (JSON mit refreshToken und siteId) für die Live-Werte
//   Aufruf:   node scripts/update.js [Ausgabedatei]
const fs = require('fs');
const path = require('path');
const { fetchExportIntervals } = require('../portal.js');
const { seal } = require('./seal.js');

const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(ROOT, 'site', 'data.enc.json');
const tarif = JSON.parse(fs.readFileSync(path.join(ROOT, 'tarif.json'), 'utf8'));
const { MEDACO_USER, MEDACO_PASSWORD, DATA_KEY, TOKEN_KEY, SONNEN_SEED } = process.env;
if (!MEDACO_USER || !MEDACO_PASSWORD || !DATA_KEY) { console.error('MEDACO_USER, MEDACO_PASSWORD und DATA_KEY müssen gesetzt sein.'); process.exit(2); }

const berlinFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
const hourKey = ms => { const p = Object.fromEntries(berlinFmt.formatToParts(new Date(ms)).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}`; };

(async () => {
  // Zuerst sonnen: Der neue Anmeldezustand muss gesichert werden, auch wenn der Rest später scheitert.
  let sonnen = null;
  if (TOKEN_KEY && SONNEN_SEED) {
    try { sonnen = await require('./sonnen.js').getLive({ tokenKey: TOKEN_KEY, seed: SONNEN_SEED }); }
    catch (e) { sonnen = { error: 'Live nicht verfügbar' }; console.error('sonnen:', e.message); }
  }

  const d = await fetchExportIntervals({ user: MEDACO_USER, password: MEDACO_PASSWORD, from: tarif.startDate });
  const hours = {};
  let lastMs = 0, lastKwh = 0;
  d.timestamps.forEach((t, i) => {
    const v = d.values[i], ms = Date.parse(t);
    if (typeof v !== 'number' || !(ms > 0)) return;
    const k = hourKey(ms - 1); // Zeitstempel = Ende des Viertelstunden-Intervalls
    hours[k] = (hours[k] || 0) + v;
    if (ms > lastMs) { lastMs = ms; lastKwh = v; }
  });
  for (const k in hours) hours[k] = Math.round(hours[k] * 10000) / 10000;
  if (!Object.keys(hours).length) throw new Error('Das Portal hat keine Werte geliefert');
  const payload = { v: 1, generatedAt: new Date().toISOString(), asOf: new Date(lastMs).toISOString(), last15: { end: new Date(lastMs).toISOString(), kwh: lastKwh },
    startDate: tarif.startDate, rates: tarif.rates, hours, sonnen };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(seal(payload, DATA_KEY)));
  const sum = Object.values(hours).reduce((a, b) => a + b, 0);
  console.log(`Fertig: ${Object.keys(hours).length} Stunden, Summe ${sum.toFixed(1)} kWh, letzter Wert ${payload.asOf}, Live ${sonnen && sonnen.accessToken ? 'bereit' : 'aus'}`);
})().catch(e => { console.error('Abruf fehlgeschlagen:', e.message); process.exit(1); });
