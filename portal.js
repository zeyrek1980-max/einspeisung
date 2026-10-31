'use strict';
// Holt die abrechnungsnahen Einspeisewerte (OBIS 1-1:2.29.0, Viertelstundenwerte) aus dem
// Westnetz-Portal MeDaCo. Es wird der eigene Zugang des Nutzers verwendet (config.local.json -> medaco).
// Wichtig: Das Portal sperrt nach Fehlversuchen. Der Aufrufer darf bei abgelehnter Anmeldung nicht schnell wiederholen.
const BASE = 'https://medaco.westnetz.de';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Einspeise-Hub/1.0';
const JSON_HEADERS = { Accept: 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest' };

class Jar {
  constructor() { this.cookies = new Map(); }
  absorb(res) {
    for (const sc of res.headers.getSetCookie()) {
      const kv = sc.split(';')[0];
      const i = kv.indexOf('=');
      if (i > 0) this.cookies.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
  }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
}

async function request(jar, p, opts = {}) {
  const res = await fetch(BASE + p, {
    redirect: 'manual', signal: AbortSignal.timeout(30000), ...opts,
    headers: { 'User-Agent': UA, Cookie: jar.header(), ...(opts.headers || {}) },
  });
  jar.absorb(res);
  return res;
}

async function getJson(jar, p) {
  const res = await request(jar, p, { headers: JSON_HEADERS });
  if (!res.ok) throw new Error(`Portal antwortet auf ${p.split('/').slice(0, 3).join('/')} mit HTTP ${res.status}`);
  const text = await res.text();
  try { return JSON.parse(text); } catch (_) { throw new Error('Portal liefert keine Daten (Sitzung abgelaufen?)'); }
}

async function login(user, password) {
  const jar = new Jar();
  const page = await request(jar, '/login');
  const m = (await page.text()).match(/name="_csrf_token"\s+value="([^"]+)"/);
  if (!m) throw new Error('Die Portal-Anmeldeseite hat sich geändert (kein CSRF-Token gefunden)');
  let res = await request(jar, '/login_check', {
    method: 'POST',
    body: new URLSearchParams({ _username: user, _password: password, _csrf_token: m[1] }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE, Referer: BASE + '/login' },
  });
  for (let hop = 0; hop < 5 && res.status >= 300 && res.status < 400; hop++) {
    const target = new URL(res.headers.get('location') || '/', BASE);
    if (target.pathname === '/login') throw new Error('Anmeldung abgelehnt: Zugangsdaten falsch oder Konto gesperrt');
    res = await request(jar, target.pathname + target.search);
  }
  // Erfolg prüfen: Die Zählpunkt-Übersicht muss als JSON kommen.
  await getJson(jar, '/sidebarMultiMp/rlm').catch(() => { throw new Error('Anmeldung abgelehnt: Zugangsdaten falsch, Konto gesperrt oder Zwei-Faktor-Code verlangt'); });
  return jar;
}

function findLine(node, re) {
  if (!node) return null;
  if (Array.isArray(node)) { for (const n of node) { const hit = findLine(n, re); if (hit) return hit; } return null; }
  if (node.type === 'line' && re.test(node.name || '')) return node;
  for (const c of node.childs || []) { const hit = findLine(c, re); if (hit) return hit; }
  return null;
}

function berlinOffset(ymd) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', timeZoneName: 'longOffset' })
    .formatToParts(new Date(ymd + 'T12:00:00Z')).find(p => p.type === 'timeZoneName').value; // z. B. "GMT+02:00"
  return part === 'GMT' ? '+00:00' : part.replace('GMT', '');
}
const stamp = ymd => `${ymd}T00:00:00${berlinOffset(ymd)}`;
const ymdOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Liefert die Viertelstundenwerte der Einspeisung ab `from` (YYYY-MM-DD) bis heute.
async function fetchExportIntervals({ user, password, from }) {
  const jar = await login(user, password);
  const tree = await getJson(jar, '/sidebarMultiMp/rlm');
  const line = findLine(tree, /2\.29\.0/);
  const mp = line && line.details && line.details.metPointId;
  if (!line || !mp) throw new Error('Die Linie 1-1:2.29.0 (Einspeisung) wurde im Portal nicht gefunden');
  const to = ymdOf(new Date(Date.now() + 86400000));
  const j = await getJson(jar, `/data/mpline/genericto/${mp}/${line.id}/${stamp(from)}/${stamp(to)}/base`);
  if (!Array.isArray(j.timestamps) || !Array.isArray(j.values)) throw new Error('Unerwartete Datenantwort des Portals');
  return { timestamps: j.timestamps, values: j.values, unit: j.unit };
}

module.exports = { fetchExportIntervals };
