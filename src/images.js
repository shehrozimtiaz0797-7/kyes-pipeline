'use strict';
// Scene pictures from Cloudflare Workers AI (FLUX.1 schnell) — free daily quota.
const fs = require('fs');
const path = require('path');
const { env, requireEnv, fetchRetry, log } = require('./lib');
const look = require('../style');

// Cloudflare's safety filter blocks harmless prompts that contain certain words.
// These replacements keep the meaning but avoid the false alarms.
const SAFE_WORDS = [
  [/\bwarm brown skin\b/gi, 'warm brown complexion'], [/\bskin\b/gi, 'complexion'],
  [/\bbod(y|ies)\b/gi, 'shape'], [/\bbedroom\b/gi, 'study room'], [/\bbed\b/gi, 'sofa'],
  [/\b(naked|nude|bare|undress\w*|shirtless|sexy|kiss\w*|lying down|lies down)\b/gi, ''],
  [/\b(blood\w*|bleed\w*|gor(e|y)|kill\w*|murder\w*|gun\w*|knife|knives|weapon\w*|corpse\w*|dead|death|die[sd]?|injur\w*|wound\w*|bod(y|ies))\b/gi, '']
];
function soften(text) {
  return SAFE_WORDS.reduce((t, [re, rep]) => t.replace(re, rep), String(text)).replace(/\s{2,}/g, ' ');
}

function fullPrompt(scenePrompt) {
  const upper = scenePrompt.toUpperCase();
  const extra = [];
  if (/\bYOU\b/.test(upper)) extra.push(look.you);
  if (/\b(FIGURE|CREATURE|SHADOW|SILHOUETTE|STRANGER|MAN|WOMAN|PASSENGER|ATTENDANT)S?\b/.test(upper)) extra.push(look.creature);
  const parts = [scenePrompt, ...extra, 'vertical-friendly centered composition, main subject in the middle', look.style];
  return soften(parts.join('. ')).slice(0, 2000);
}

// Second try when the safety filter still blocks: a calmer, simpler version of the scene.
function plainPrompt(scenePrompt) {
  return soften(`${scenePrompt.split(/[.,;]/)[0]}. Quiet empty eerie place at night, nobody hurt. ${look.style}`).slice(0, 2000);
}

async function generateImage(prompt, outFile, seed) {
  const account = requireEnv('CF_ACCOUNT_ID', 'See START-HERE.txt, step 3.');
  const token = requireEnv('CF_API_TOKEN', 'See START-HERE.txt, step 3.');
  const model = env('CF_IMAGE_MODEL', '@cf/black-forest-labs/flux-1-schnell');
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`;
  const res = await fetchRetry(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, steps: Number(env('CF_IMAGE_STEPS', '6')) })
  }, 'Cloudflare image', 4);
  const data = await res.json();
  const b64 = data?.result?.image || data?.image;
  if (!b64) throw new Error('Cloudflare returned no image: ' + JSON.stringify(data).slice(0, 300));
  fs.writeFileSync(outFile, Buffer.from(b64, 'base64'));
  return outFile;
}

async function makeSceneImages(story, workDir) {
  const files = story.scenes.map((_, i) => path.join(workDir, `scene${i + 1}.jpg`));
  const ok = [];
  let lastError = null;
  const baseSeed = Math.floor(Math.random() * 1e6);
  for (const [i, scene] of story.scenes.entries()) {
    try {
      log(`Image ${i + 1}/${story.scenes.length}...`);
      try {
        await generateImage(fullPrompt(scene.image_prompt), files[i], baseSeed + i);
      } catch (err) {
        if (!/NSFW|8007/i.test(err.message)) throw err;
        log(`Image ${i + 1}: safety filter false alarm, retrying with a simpler prompt...`);
        await generateImage(plainPrompt(scene.image_prompt), files[i], baseSeed + i);
      }
      ok[i] = true;
    } catch (err) {
      lastError = err;
      log(`Image ${i + 1} failed: ${err.message}`);
    }
  }
  const good = ok.map((v, i) => (v ? i : -1)).filter(i => i >= 0);
  if (!good.length) throw lastError || new Error('No images could be generated');
  // A failed scene reuses the nearest good picture so the video can still be made.
  files.forEach((f, i) => {
    if (ok[i]) return;
    const nearest = good.reduce((a, b) => (Math.abs(b - i) < Math.abs(a - i) ? b : a));
    fs.copyFileSync(files[nearest], f);
  });
  if (good.length < files.length) log(`${files.length - good.length} scene(s) reused a nearby picture.`);
  return files;
}

module.exports = { makeSceneImages, fullPrompt };
