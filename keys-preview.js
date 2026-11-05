'use strict';
// Shows a SAFE preview of each key (length + first and last 4 characters) so the
// laptop and GitHub copies can be compared without revealing them. Run: node keys-preview.js
const fs = require('fs');
const path = require('path');
const { env } = require('./src/lib');

let refresh = env('YT_REFRESH_TOKEN', '');
if (!refresh) {
  try { refresh = JSON.parse(fs.readFileSync(path.join(__dirname, 'youtube-token.json'), 'utf8')).refresh_token || ''; } catch (_) {}
}
const raw = n => process.env[n] || '';
const names = ['GEMINI_API_KEY', 'CF_ACCOUNT_ID', 'CF_API_TOKEN', 'YT_CLIENT_ID', 'YT_CLIENT_SECRET', 'YT_REFRESH_TOKEN'];
console.log('\nKey preview (safe):\n');
for (const n of names) {
  const v = n === 'YT_REFRESH_TOKEN' ? String(refresh).trim() : env(n, '');
  const r = n === 'YT_REFRESH_TOKEN' ? String(raw(n) || refresh) : raw(n);
  const extra = r && r !== r.trim() ? '  (had extra spaces — now ignored)' : '';
  const shown = v ? `length ${String(v.length).padStart(3)} | ${v.slice(0, 4)} ... ${v.slice(-4)}` : 'MISSING';
  console.log(`  ${n.padEnd(17)} ${shown}${extra}`);
}
console.log('');
