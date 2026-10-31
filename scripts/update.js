'use strict';
// Holt die Einspeisewerte aus dem Westnetz-Portal, rechnet sie zu Stundensummen um und schreibt sie
// verschlüsselt nach site/data.enc.json. Läuft in GitHub Actions (Zugangsdaten als Secrets) oder lokal.
//   Umgebung: MEDACO_USER, MEDACO_PASSWORD, DATA_KEY (Zugangscode für die Handy-Seite)
//   Aufruf:   node scripts/update.js [Ausgabedatei]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fetchExportIntervals } = require('../portal.js');

const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(ROOT, 'site', 'data.enc.json');
const tarif = JSON.parse(fs.readFileSync(path.join(ROOT, 'tarif.json'), 'utf8'));
const { MEDACO_USER, MEDACO_PASSWORD, DATA_KEY } = process.env;
if (!MEDACO_USER || !MEDACO_PASSWORD || !DATA_KEY) { console.error('MEDACO_USER, MEDACO_PASSWORD und DATA_KEY müssen gesetzt sein.'); process.exit(2); }

const berlinFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
const hourKey = ms => { const p = Object.fromEntries(berlinFmt.formatToParts(new Date(ms)).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}`; };

function encrypt(obj, passphrase) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), iter = 200000;
  const key = crypto.pbkdf2Sync(passphrase, salt, iter, 32, 'sha256');
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final(), c.getAuthTag()]); // WebCrypto erwartet den Tag am Ende
  return { v: 1, iter, salt: salt.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64') };
}

(async () => {
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
    startDate: tarif.startDate, rates: tarif.rates, hours };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(encrypt(payload, DATA_KEY)));
  const sum = Object.values(hours).reduce((a, b) => a + b, 0);
  console.log(`Fertig: ${Object.keys(hours).length} Stunden, Summe ${sum.toFixed(1)} kWh, letzter Wert ${payload.asOf}`);
})().catch(e => { console.error('Abruf fehlgeschlagen:', e.message); process.exit(1); });
