'use strict';
// Makes short horror voice samples so you can pick the voice you like.
//   node voice-test.js                     6 samples (uses 6 of today's 10 free voice requests)
//   node voice-test.js Charon Algenib      only these voices
// Samples are saved in the "voice-samples" folder, with the same horror sound as the videos.
const fs = require('fs');
const path = require('path');
const { ROOT, runFFmpeg, runFFmpegCapture, log } = require('./src/lib');
const { speak } = require('./src/voice');
const { voiceFx, droneInputs, droneFx } = require('./src/horror-audio');

const VOICES = [
  ['Charon', 'male, deep and calm'],
  ['Algenib', 'male, rough and gravelly'],
  ['Enceladus', 'male, breathy, close whisper'],
  ['Gacrux', 'male, older and heavy'],
  ['Achernar', 'female, soft and quiet'],
  ['Sulafat', 'female, warm but unsettling']
];

const SAMPLE =
  "It's 3 AM, and the flight attendant just handed you a folded note.\n\n" +
  'Rule one: never open your window shade. No matter what knocks on it.\n\n' +
  'Then you hear it. Tap. Tap. Tap.\n\n' +
  'Do you A, open the shade, or B, wake the passenger next to you?';

(async () => {
  const pick = process.argv.slice(2);
  const list = pick.length ? pick.map(v => VOICES.find(x => x[0].toLowerCase() === v.toLowerCase()) || [v, '']) : VOICES;
  const dir = path.join(ROOT, 'voice-samples');
  fs.mkdirSync(dir, { recursive: true });
  for (const [i, [name, about]] of list.entries()) {
    try {
      log(`Sample ${i + 1}/${list.length}: ${name} (${about})...`);
      const raw = `raw-${name}.wav`;
      const secs = await speak(SAMPLE, path.join(dir, raw), name);
      const total = secs + 0.5;
      const out = `${i + 1}-${name}.mp3`;
      await runFFmpeg([
        '-y', '-i', raw, ...droneInputs(total), '-filter_complex',
        `${voiceFx('0:a', 'v')};${droneFx(1, 2, total, 'd')};[v]apad[vp];[vp][d]amix=inputs=2:duration=shortest:normalize=0,alimiter=limit=0.95[a]`,
        '-map', '[a]', '-t', total.toFixed(2), '-b:a', '160k', out
      ], dir);
      fs.rmSync(path.join(dir, raw), { force: true });
      console.log(`   ✓ saved voice-samples\\${out}`);
    } catch (err) {
      console.log(`   ✗ ${name}: ${err.message}`);
      if (/FREE limit/.test(err.message)) break;
    }
  }
  console.log('\nOpen the "voice-samples" folder and listen. Tell me the number/name you like.\n');
})();
