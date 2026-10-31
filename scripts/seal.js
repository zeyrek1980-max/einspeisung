'use strict';
// Verschlüsseln und Entschlüsseln (AES-256-GCM, Schlüssel per PBKDF2 aus einem Code). Format passt zur Handy-Seite.
const crypto = require('crypto');

function seal(obj, passphrase) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), iter = 200000;
  const key = crypto.pbkdf2Sync(passphrase, salt, iter, 32, 'sha256');
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final(), c.getAuthTag()]); // WebCrypto erwartet den Tag am Ende
  return { v: 1, iter, salt: salt.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64') };
}

function open(file, passphrase) {
  const key = crypto.pbkdf2Sync(passphrase, Buffer.from(file.salt, 'base64'), file.iter, 32, 'sha256');
  const ct = Buffer.from(file.ct, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(file.iv, 'base64'));
  d.setAuthTag(ct.subarray(ct.length - 16));
  return JSON.parse(Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString('utf8'));
}

module.exports = { seal, open };
