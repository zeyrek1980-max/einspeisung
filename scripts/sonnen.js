'use strict';
// Hält die Anmeldung beim sonnen-Portal (my.sonnen.de) am Leben und liefert einen Zugriffsschlüssel für die
// Live-Werte. sonnen tauscht bei jeder Erneuerung den Erneuerungsschlüssel aus; der neue Zustand wird deshalb
// sofort verschlüsselt (Code TOKEN_KEY) nach state/tokenstate.enc.json geschrieben und vom Workflow gesichert.
const fs = require('fs');
const path = require('path');
const { seal, open } = require('./seal.js');

const TOKEN_URL = 'https://account.sonnen.de/oauth/token';
const CLIENT_ID = 'a80a9abfd8c2847370340c96a04d2af7c691cce4c7cac58d8e12012f5da9280c'; // öffentliche Kennung des Portals (Desktop)
const STATE_FILE = path.join(__dirname, '..', 'state', 'tokenstate.enc.json');
const MARGIN_MS = 60 * 60e3; // Zugriffsschlüssel gelten 2 Stunden, spätestens bei weniger als 1 Stunde Rest erneuern

async function refresh(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(30000),
    body: new URLSearchParams({ client_id: CLIENT_ID, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`sonnen lehnt die Erneuerung ab (HTTP ${res.status}${j.error ? ', ' + j.error : ''})`);
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token || refreshToken,
    expiresAt: ((j.created_at || Date.now() / 1000) + (j.expires_in || 7200)) * 1000,
  };
}

// Liefert { accessToken, expiresAt, siteId }.
async function getLive({ tokenKey, seed }) {
  let state = null;
  try { if (fs.existsSync(STATE_FILE)) state = open(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')), tokenKey); }
  catch (_) { console.error('sonnen: gespeicherter Anmeldezustand nicht lesbar, nehme den Ausgangsschlüssel'); }
  if (!state) { const s = JSON.parse(seed); state = { refreshToken: s.refreshToken, siteId: s.siteId, accessToken: null, expiresAt: 0 }; }
  if (!state.accessToken || state.expiresAt - Date.now() < MARGIN_MS) {
    state = { ...state, ...(await refresh(state.refreshToken)) };
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(seal(state, tokenKey))); // sofort sichern, sonst ist die Kette verloren
    console.log('sonnen: Zugriffsschlüssel erneuert');
  } else console.log('sonnen: Zugriffsschlüssel noch gültig');
  return { accessToken: state.accessToken, expiresAt: state.expiresAt, siteId: state.siteId };
}

module.exports = { getLive };
