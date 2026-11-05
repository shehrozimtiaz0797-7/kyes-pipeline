'use strict';
// Voice-over with Gemini TTS (free tier: about 10 voice requests per day).
// The whole story is spoken in ONE request, then split into scenes at the natural pauses,
// so one video costs only one voice request.
const fs = require('fs');
const path = require('path');
const { env, requireEnv, fetchRetry, runFFmpeg, runFFmpegCapture, sleep, log } = require('./lib');

function wavFromPcm(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function speak(text, outFile) {
  const key = requireEnv('GEMINI_API_KEY');
  const model = env('GEMINI_TTS_MODEL', 'gemini-3.8-flash-tts');
  const voiceName = env('GEMINI_TTS_VOICE', 'Kore');
  const style = env('TTS_STYLE', '');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetchRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: style ? `${style}\n\n${text}` : text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
      }
    })
  }, 'Gemini voice');
  const data = await res.json();
  const part = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
  if (!part) throw new Error('Gemini voice returned no audio: ' + JSON.stringify(data).slice(0, 300));
  const rate = Number((part.inlineData.mimeType || '').match(/rate=(\d+)/)?.[1] || 24000);
  const pcm = Buffer.from(part.inlineData.data, 'base64');
  fs.writeFileSync(outFile, wavFromPcm(pcm, rate));
  return pcm.length / (rate * 2); // seconds
}

// Finds pauses in the narration: returns [{start, end, mid}] in seconds.
async function findPauses(file, workDir) {
  const out = await runFFmpegCapture(['-i', path.basename(file), '-af', 'silencedetect=noise=-38dB:d=0.18', '-f', 'null', '-'], workDir);
  const pauses = [];
  let start = null;
  for (const line of out.split(/\r?\n/)) {
    const s = line.match(/silence_start:\s*([\d.]+)/);
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (s) start = Number(s[1]);
    if (e && start !== null) { const end = Number(e[1]); pauses.push({ start, end, mid: (start + end) / 2, len: end - start }); start = null; }
  }
  return pauses;
}

// Picks where each scene's line ends: the pause closest to where it "should" be by text length.
function chooseCuts(lines, total, pauses) {
  const weights = lines.map(l => Math.max(1, l.length));
  const sum = weights.reduce((a, b) => a + b, 0);
  const avg = total / lines.length;
  const usable = pauses.filter(p => p.start > 0.3 && p.end < total - 0.3);
  const cuts = [0];
  let acc = 0;
  for (let k = 1; k < lines.length; k++) {
    acc += weights[k - 1];
    const expected = total * acc / sum;
    const prev = cuts[cuts.length - 1];
    const remaining = lines.length - k;
    const maxCut = total - remaining * 0.8;
    let best = null, bestScore = Infinity;
    for (const p of usable) {
      if (p.mid <= prev + 0.8 || p.mid >= maxCut) continue;
      const dist = Math.abs(p.mid - expected);
      if (dist > Math.max(2.0, avg * 0.45)) continue;
      const score = dist - p.len * 1.5; // prefer longer pauses (real line breaks)
      if (score < bestScore) { bestScore = score; best = p; }
    }
    cuts.push(best ? best.mid : Math.min(Math.max(expected, prev + 0.8), maxCut));
  }
  cuts.push(total);
  return cuts;
}

async function makeVoiceOvers(story, workDir) {
  const useUrdu = env('VOICE_SCRIPT', 'urdu').toLowerCase() !== 'roman';
  const lines = story.scenes.map(s => (useUrdu ? s.voice : s.subtitle).trim());
  // Shorts: one request. Long videos: a few requests of up to VOICE_CHUNK lines each.
  const chunkSize = Math.max(4, Number(env('VOICE_CHUNK', '12')));
  const parts = Math.ceil(lines.length / chunkSize);
  const per = Math.ceil(lines.length / parts); // spread lines evenly over the parts
  const out = [];
  let grand = 0;
  for (let p = 0; p < parts; p++) {
    const group = lines.slice(p * per, (p + 1) * per);
    if (!group.length) continue;
    const full = path.join(workDir, `voice_full${p + 1}.wav`);
    log(parts === 1
      ? `Voice: recording all ${group.length} lines in one request...`
      : `Voice part ${p + 1}/${parts}: recording ${group.length} lines...`);
    if (p > 0) await sleep(Number(env('TTS_DELAY_MS', '6000')));
    const total = await speak(group.join('\n\n'), full);
    const pauses = await findPauses(full, workDir);
    const cuts = chooseCuts(group, total, pauses);
    for (let i = 0; i < group.length; i++) {
      const n = out.length + 1;
      const file = path.join(workDir, `voice${n}.wav`);
      const start = cuts[i], end = cuts[i + 1];
      await runFFmpeg(['-y', '-i', path.basename(full), '-ss', start.toFixed(3), '-to', end.toFixed(3), '-c:a', 'pcm_s16le', path.basename(file)], workDir);
      out.push({ file, duration: end - start });
    }
    grand += total;
  }
  log(`Voice ready: ${grand.toFixed(1)}s, split into ${out.length} scenes (${parts} request${parts > 1 ? 's' : ''}).`);
  return out;
}

module.exports = { makeVoiceOvers, wavFromPcm, chooseCuts };
