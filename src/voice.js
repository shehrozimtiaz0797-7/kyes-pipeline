'use strict';
// Voice-over with Gemini TTS (free tier: about 10 voice requests per day).
// The whole story is spoken in ONE request, then split into scenes at the natural pauses,
// so one video costs only one voice request.
const fs = require('fs');
const { execFile } = require('child_process');
const path = require('path');
const { ttsStyle } = require('./horror-audio');
const { ROOT, env, requireEnv, fetchRetry, runFFmpeg, runFFmpegCapture, sleep, log } = require('./lib');

function wavFromPcm(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// GEMINI_TTS_VOICE can be one voice or a list ("Gacrux,Sulafat"): videos take turns.
function pickVoice() {
  const list = env('GEMINI_TTS_VOICE', 'Gacrux,Sulafat').split(/[,\s]+/).filter(Boolean);
  if (list.length === 1) return list[0];
  let n = 0;
  try { n = JSON.parse(fs.readFileSync(path.join(ROOT, 'history.json'), 'utf8')).length; } catch (_) {}
  return list[n % list.length];
}

async function speak(text, outFile, voiceOverride) {
  const key = requireEnv('GEMINI_API_KEY');
  const model = env('GEMINI_TTS_MODEL', 'gemini-3.8-flash-tts');
  const voiceName = voiceOverride || pickVoice();
  const style = ttsStyle();
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
  log(`Voice: ${voiceName}`);
  if (!part) throw new Error('Gemini voice returned no audio: ' + JSON.stringify(data).slice(0, 300));
  const rate = Number((part.inlineData.mimeType || '').match(/rate=(\d+)/)?.[1] || 24000);
  const pcm = Buffer.from(part.inlineData.data, 'base64');
  fs.writeFileSync(outFile, wavFromPcm(pcm, rate));
  return pcm.length / (rate * 2); // seconds
}

// Finds pauses in the narration: returns [{start, end, mid}] in seconds.
async function findPauses(file, workDir, minPause = 0.18) {
  const out = await runFFmpegCapture(['-i', path.basename(file), '-af', `silencedetect=noise=-38dB:d=${minPause}`, '-f', 'null', '-'], workDir);
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

// Where the voice is actually speaking inside one scene clip: [{start, end}] in seconds.
// Used to time the captions exactly with the voice (skipping the quiet gaps).
async function speechParts(file, dur, workDir) {
  let pauses = [];
  try { pauses = await findPauses(file, workDir, 0.12); } catch (_) { /* fall back below */ }
  const parts = [];
  let t = 0;
  for (const p of pauses) {
    const end = Math.min(p.start, dur);
    if (end - t > 0.08) parts.push({ start: t, end });
    t = Math.max(t, p.end);
  }
  if (dur - t > 0.08) parts.push({ start: t, end: dur });
  return parts.length ? parts : [{ start: 0.05, end: dur }];
}

// Word times with speech recognition (align.py + faster-whisper). Returns per-line word lists, or null.
async function alignWords(full, lines, workDir) {
  if (env('ALIGN', 'yes').toLowerCase() === 'no') return null;
  const py = env('PYTHON', process.platform === 'win32' ? 'python' : 'python3');
  const linesFile = path.join(workDir, 'lines.json'), outFile = path.join(workDir, 'words.json');
  fs.writeFileSync(linesFile, JSON.stringify(lines));
  try {
    const res = await new Promise(resolve => {
      execFile(py, [path.join(ROOT, 'align.py'), full, linesFile, outFile], { timeout: 600000, windowsHide: true },
        (err, stdout, stderr) => resolve({ err, text: (stdout + stderr).trim() }));
    });
    if (res.err || !fs.existsSync(outFile)) {
      log(`Word timing not available (${(res.text.split(/\r?\n/).pop() || res.err?.message || '').slice(0, 160)}), using pause detection.`);
      return null;
    }
    const data = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    log(`Word timing: ${data.matched}/${data.total} words matched to the voice.`);
    return data.lines;
  } catch (err) {
    log(`Word timing failed (${err.message}), using pause detection.`);
    return null;
  }
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
    // Best: real word times from speech recognition. Fallback: cut at pauses (less exact).
    const words = await alignWords(full, group, workDir);
    let cuts;
    if (words) {
      cuts = [0];
      for (let i = 1; i < group.length; i++) {
        const prevEnd = words[i - 1].length ? words[i - 1][words[i - 1].length - 1].end : cuts[i - 1];
        const nextStart = words[i].length ? words[i][0].start : prevEnd;
        cuts.push(Math.max(cuts[i - 1] + 0.2, Math.min(total, (prevEnd + Math.max(prevEnd, nextStart)) / 2)));
      }
      cuts.push(total);
    } else {
      cuts = chooseCuts(group, total, await findPauses(full, workDir));
    }
    for (let i = 0; i < group.length; i++) {
      const n = out.length + 1;
      const file = path.join(workDir, `voice${n}.wav`);
      const start = cuts[i], end = cuts[i + 1];
      await runFFmpeg(['-y', '-i', path.basename(full), '-ss', start.toFixed(3), '-to', end.toFixed(3), '-c:a', 'pcm_s16le', path.basename(file)], workDir);
      const item = { file, duration: end - start };
      if (words) item.words = words[i].map(w => ({ w: w.w, start: Math.max(0, w.start - start), end: Math.max(0, w.end - start) }));
      else item.speech = await speechParts(file, end - start, workDir);
      out.push(item);
    }
    grand += total;
  }
  log(`Voice ready: ${grand.toFixed(1)}s, split into ${out.length} scenes (${parts} request${parts > 1 ? 's' : ''}).`);
  return out;
}

module.exports = { makeVoiceOvers, wavFromPcm, chooseCuts, speak, speechParts };
