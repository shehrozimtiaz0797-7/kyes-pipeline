'use strict';
// Checks every part of the setup and says what is missing. Run:  node check.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ROOT, env, runFFmpeg } = require('./src/lib');

const ok = m => console.log('  ✓ ' + m);
const bad = m => { console.log('  ✗ ' + m); problems++; };
let problems = 0;

(async () => {
  console.log('\nKeep Your Eyes Shut setup check\n');

  if (!fs.existsSync(path.join(ROOT, '.env'))) bad('.env file not found. Copy .env.example to .env and fill it in.');
  else ok('.env file found');

  try {
    const tmp = path.join(os.tmpdir(), 'kyes-check.mp4');
    await runFFmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=0.5', tmp]);
    fs.rmSync(tmp, { force: true });
    ok('FFmpeg works');
  } catch (e) { bad('FFmpeg not working: ' + e.message + ' (run: npm install)'); }

  const key = env('GEMINI_API_KEY');
  if (!key) bad('GEMINI_API_KEY missing');
  else {
    const models = [...new Set([env('GEMINI_TEXT_MODEL', 'gemini-3.8-flash'),
      ...env('GEMINI_TEXT_FALLBACKS', 'gemini-3.5-flash-lite').split(/[,\s]+/).filter(Boolean)])];
    let working = null; let busy = 0; let invalid = null;
    for (const model of models) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with the word OK.' }] }] })
        });
        if (r.ok) { working = model; break; }
        const body = (await r.text()).slice(0, 200);
        if (r.status === 503 || r.status === 429) { busy++; console.log(`  • ${model} is busy right now [${r.status}]`); }
        else if (/API_KEY_INVALID|API key not valid/i.test(body)) { invalid = body; break; }
        else console.log(`  • ${model} error [${r.status}]: ${body}`);
      } catch (e) { console.log(`  • ${model} not reachable: ${e.message}`); }
    }
    if (working) ok(`Gemini story writer works (${working})`);
    else if (invalid) bad('Gemini key is not valid — paste a correct GEMINI_API_KEY');
    else if (busy) ok('Gemini key is fine, but all models are busy right now (temporary) — videos will retry automatically');
    else bad('Gemini story writer not working');
  }

  const acc = env('CF_ACCOUNT_ID'), tok = env('CF_API_TOKEN');
  if (!acc || !tok) bad('CF_ACCOUNT_ID / CF_API_TOKEN missing (Cloudflare images)');
  else {
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/${env('CF_IMAGE_MODEL', '@cf/black-forest-labs/flux-1-schnell')}`, {
        method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'an empty dark hotel hallway at night, cinematic', steps: 4 })
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d?.result?.image) {
        fs.writeFileSync(path.join(ROOT, 'check-image.jpg'), Buffer.from(d.result.image, 'base64'));
        ok('Cloudflare images work (test picture saved as check-image.jpg)');
      } else bad(`Cloudflare image error [${r.status}]: ${JSON.stringify(d.errors || d).slice(0, 200)}`);
    } catch (e) { bad('Cloudflare not reachable: ' + e.message); }
  }

  if (!env('YT_CLIENT_ID') || !env('YT_CLIENT_SECRET')) bad('YT_CLIENT_ID / YT_CLIENT_SECRET missing');
  else if (!fs.existsSync(path.join(ROOT, 'youtube-token.json'))) bad('YouTube not connected yet. Run: node auth.js');
  else {
    const { channelInfo } = require('./src/youtube');
    const name = await channelInfo();
    if (name) ok(`YouTube connected: ${name}`); else bad('YouTube login not working. Run: node auth.js');
  }

  console.log(problems ? `\n${problems} problem(s) to fix.\n` : '\nAll good! Test with:  node make-video.js --no-upload\n');
  process.exit(problems ? 1 : 0);
})();
