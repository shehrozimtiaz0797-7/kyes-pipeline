'use strict';
// Prints the 6 values to paste into GitHub (Settings -> Secrets and variables -> Actions -> New repository secret).
// Run on your laptop:  node print-secrets.js
// Keep this window private — these are your passwords.
const fs = require('fs');
const path = require('path');
const { env } = require('./src/lib');

let refresh = '';
try { refresh = JSON.parse(fs.readFileSync(path.join(__dirname, 'youtube-token.json'), 'utf8')).refresh_token; } catch (_) {}

const items = [
  ['GEMINI_API_KEY', env('GEMINI_API_KEY')],
  ['CF_ACCOUNT_ID', env('CF_ACCOUNT_ID')],
  ['CF_API_TOKEN', env('CF_API_TOKEN')],
  ['YT_CLIENT_ID', env('YT_CLIENT_ID')],
  ['YT_CLIENT_SECRET', env('YT_CLIENT_SECRET')],
  ['YT_REFRESH_TOKEN', refresh]
];

console.log('\nAdd each of these as a GitHub secret (Name = left, Secret = right):\n');
for (const [name, value] of items) {
  console.log(`  ${name}`);
  console.log(`      ${value || '(missing! check your .env / run node auth.js)'}\n`);
}
console.log('Do NOT share these with anyone.\n');
