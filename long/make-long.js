'use strict';
// War Maps long video (8-12 min): illustrated history documentary.
// Script + fact-check (Gemini) -> voice in a few chunks (Gemini TTS) -> painted pictures (Cloudflare FLUX)
// -> chapter map cards (real borders) -> slow camera moves + music (longtools.py) -> upload (optional).
// Runs inside the Empire Maps engine folder (uses its src/ helpers). Usage: node long/make-long.js [--topic id] [--no-upload]
const fs = require('fs');
const path = require('path');
const { askJSON, speak } = require('../src/gemini');
const { ROOT, env, log, run, duration, fetchRetry, FFMPEG, PYTHON } = require('../src/lib');

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : ''; };
const NO_UPLOAD = args.includes('--no-upload');
const TOPICS = JSON.parse(fs.readFileSync(path.join(ROOT, 'topics.json'), 'utf8'));
const HIST = path.join(ROOT, 'long-history.json');
const readHist = () => { try { return JSON.parse(fs.readFileSync(HIST, 'utf8')); } catch (_) { return []; } };
const yearText = y => (y < 0 ? `${-y} BC` : y < 1000 ? `${y} AD` : String(y));

const STYLE = 'detailed hand-painted historical illustration in the style of a medieval tapestry and an old oil painting, warm muted earth colours, parchment texture, cinematic wide composition, no text, no letters';
const SAFE = [[/\b(blood\w*|gor(e|y)|kill\w*|murder\w*|corpse\w*|dead|death|die[sd]?|wound\w*|massacre\w*|slaughter\w*|behead\w*)\b/gi, ''],
  [/\b(gun\w*|knife|knives|weapon\w*)\b/gi, 'equipment'], [/\bbod(y|ies)\b/gi, 'figures']];
const soften = t => SAFE.reduce((s, [re, r]) => s.replace(re, r), String(t)).replace(/\s{2,}/g, ' ');

function pickTopic() {
  const want = opt('--topic');
  if (want) { const t = TOPICS.find(x => x.id === want); if (t) return t; }
  const done = readHist().map(h => h.topic);
  return TOPICS.find(t => !done.includes(t.id)) || TOPICS[done.length % TOPICS.length];
}

function scriptPrompt(t) {
  return `You write long YouTube documentaries for "War Maps", a history channel in the style of Kings and Generals and OverSimplified (but serious, no jokes).
Subject: ${t.name}: ${t.story}.
Map snapshots available for the chapter cards: ${t.years.map(yearText).join(', ')}.

Write a gripping, accurate 9 to 11 minute narration (1350 to 1650 words) that tells this as a STORY: the people, their motives, the turning points, the battles, the consequences. Open with a strong cold-open hook (a dramatic moment), then go back and build up. End with why it still matters and a question for the comments.

Return ONLY JSON:
{"title": "YouTube title under 70 characters, curiosity + searchable, no emoji",
 "thumb_text": "2 to 4 BIG words for the thumbnail",
 "description": "3 short paragraphs about the video, then a blank line, then 5 hashtags",
 "tags": [12 to 15 search tags],
 "chapters": [6 to 8 objects: {"heading": "short chapter name", "map_year": one of the snapshot years above that fits this chapter (number, negative for BC), "paragraphs": [3 to 5 objects: {"text": "40 to 70 words of narration", "images": ["scene for the first half of this paragraph", "scene for the second half"]}]}]}

Image scene rules: each is one English sentence describing a painting: who, where, what is happening, period clothing and armour, setting, light. Show armies marching, commanders, cities, ships, councils, maps on tables, landscapes. No gore, nothing bloody, no close-up injuries, no text. Each scene must be different.
Facts: only well-known, true history. No invented numbers or quotes. Neutral tone about every people and religion.`;
}

async function writeScript(t) {
  let last;
  for (let a = 1; a <= 3; a++) {
    try {
      const s = await askJSON(scriptPrompt(t), { temperature: 0.8 });
      const ch = (s.chapters || []).filter(c => c && Array.isArray(c.paragraphs) && c.paragraphs.length);
      const paras = ch.flatMap(c => c.paragraphs);
      const words = paras.map(p => String(p.text || '')).join(' ').split(/\s+/).length;
      if (ch.length < 5 || words < 1000) throw new Error(`too short (${ch.length} chapters, ${words} words)`);
      log(`Script: ${ch.length} chapters, ${paras.length} paragraphs, ${words} words`);
      s.chapters = ch;
      try {
        const c = await askJSON(`You are a careful history fact-checker. Here are the narration paragraphs of a documentary about ${t.name}, as a JSON list of strings:
${JSON.stringify(paras.map(p => p.text))}
Fix any wrong fact, wrong date, wrong name or exaggeration presented as fact. Keep the same number of items, the same style and about the same length. Keep correct text exactly as it is.
Return ONLY JSON: {"texts": [...], "changed": number of items you changed}`, { temperature: 0.2 });
        if (Array.isArray(c.texts) && c.texts.length === paras.length) {
          paras.forEach((p, i) => { p.text = String(c.texts[i]); });
          log(`Fact-check changed ${c.changed || 0} paragraph(s)`);
        }
      } catch (e) { log('Fact-check skipped: ' + e.message); }
      return s;
    } catch (e) { last = e; log(`Script attempt ${a} not usable: ${e.message}`); }
  }
  throw last;
}

function wav(pcm, file) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(24000, 24);
  h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, pcm]));
}

// The voice is made in a few chunks (a whole 10 minutes at once is too long for one request).
async function makeVoice(s, dir) {
  const voice = env('LONG_VOICE', 'Charon');
  const paras = s.chapters.flatMap((c, ci) => c.paragraphs.map((p, pi) => ({ ...p, ci, first: pi === 0 })));
  const N = Number(env('LONG_VOICE_CHUNKS', '4'));
  const per = Math.ceil(paras.length / N);
  const style = 'Read this like a calm, gripping history documentary narrator, deep voice, steady pace, small pauses between paragraphs:\n';
  const pieces = [];
  for (let k = 0; k * per < paras.length; k++) {
    const group = paras.slice(k * per, (k + 1) * per);
    const text = style + group.map(p => p.text).join('\n\n');
    let pcm;
    for (let a = 1; a <= 3 && !pcm; a++) {
      try { pcm = await speak(text, voice); } catch (e) { log(`Voice chunk ${k + 1} try ${a}: ${e.message.slice(0, 200)}`); if (a === 3) throw e; await new Promise(r => setTimeout(r, 20000)); }
    }
    const f = path.join(dir, `voice${k + 1}.wav`); wav(pcm, f);
    const d = await duration(f);
    log(`Voice chunk ${k + 1}: ${d.toFixed(1)}s`);
    // time inside the chunk is shared by paragraph length
    const chars = group.map(p => p.text.length); const tot = chars.reduce((a, b) => a + b, 0);
    group.forEach((p, i) => { p.dur = d * chars[i] / tot; });
    pieces.push({ file: f, dur: d, group });
  }
  return { paras, pieces };
}

async function cfImage(prompt, out) {
  const accts = [[env('CF_ACCOUNT_ID'), env('CF_API_TOKEN')], [env('CF_ACCOUNT_ID_2'), env('CF_API_TOKEN_2')]].filter(a => a[0] && a[1]);
  let last;
  for (const [acc, tok] of accts) {
    for (const p of [soften(prompt), soften(prompt.split(/[.,;]/)[0])]) {
      try {
        const res = await fetchRetry(`https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
          method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: `${p}. ${STYLE}`.slice(0, 2000), steps: 8 }),
        }, 3);
        const data = await res.json();
        const b64 = data?.result?.image;
        if (!b64) throw new Error(JSON.stringify(data).slice(0, 200));
        fs.writeFileSync(out, Buffer.from(b64, 'base64'));
        return out;
      } catch (e) { last = e; if (/limit|quota|4006/i.test(e.message)) break; }
    }
  }
  throw last;
}

async function main() {
  const t = pickTopic();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const dir = path.join(ROOT, 'output', `long-${stamp}-${t.id}`);
  fs.mkdirSync(dir, { recursive: true });
  log(`LONG video: ${t.name}`);
  const s = await writeScript(t);
  fs.writeFileSync(path.join(dir, 'script.json'), JSON.stringify(s, null, 2));
  const { paras, pieces } = await makeVoice(s, dir);

  // pictures: two per paragraph
  const shots = [];
  let n = 0, lastGood = null, failed = 0;
  for (const p of paras) {
    const ims = (p.images || []).slice(0, 2);
    while (ims.length < 2) ims.push(ims[0] || p.text);
    for (let h = 0; h < 2; h++) {
      n++;
      const f = path.join(dir, `img${String(n).padStart(3, '0')}.jpg`);
      try { await cfImage(ims[h], f); lastGood = f; } catch (e) { failed++; log(`Image ${n} failed: ${e.message.slice(0, 150)}`); }
      shots.push({ img: fs.existsSync(f) ? f : lastGood, dur: p.dur / 2, para: p });
    }
  }
  log(`Pictures: ${n - failed}/${n}`);
  if (n - failed < n * 0.6) throw new Error('too many pictures failed');
  for (let i = 0; i < shots.length; i++) if (!shots[i].img) shots[i].img = shots.find(x => x.img).img;

  // timeline: 5 s title card, then the pictures; each chapter opens with a 4 s map card that takes the
  // first seconds of its first picture (the voice never stops, so pictures stay in sync with it)
  const timeline = [{ kind: 'title', dur: 5 }];
  const voiceAt = [];
  let tcur = 5;
  for (const piece of pieces) {
    voiceAt.push({ file: piece.file, start: tcur });
    for (const p of piece.group) {
      const mine = shots.filter(x => x.para === p);
      mine.forEach((sh, k) => {
        let d = sh.dur;
        if (k === 0 && p.first) {
          const c = s.chapters[p.ci];
          const md = Math.min(4, d * 0.6);
          timeline.push({ kind: 'map', dur: md, heading: c.heading, chapter: p.ci + 1, year: Number(c.map_year) || t.years[0] });
          d -= md;
        }
        timeline.push({ kind: 'img', img: sh.img, dur: d });
      });
    }
    tcur += piece.dur;
  }
  timeline.push({ kind: 'outro', dur: 4 });
  const total = tcur + 4;
  const spec = {
    topic: { names: t.names, years: t.years, label: t.label, labels: t.labels || {} }, theme: 'war', brand: env('BRAND', 'WAR MAPS'),
    timeline, voice: voiceAt, total, data_dir: path.join(ROOT, 'data'), out: path.join(dir, 'final.mp4'),
    title: s.title, preview: path.join(dir, 'preview.mp4'), thumb: path.join(dir, 'thumb.jpg'), thumb_text: s.thumb_text, ffmpeg: FFMPEG(), work: dir,
  };
  fs.writeFileSync(path.join(dir, 'long.json'), JSON.stringify(spec, null, 1));
  await run(PYTHON(), [path.join(__dirname, 'longtools.py'), path.join(dir, 'long.json')]);
  const real = await duration(spec.out);
  log(`Video ready: ${(real / 60).toFixed(1)} min`);

  const entry = { topic: t.id, title: s.title, date: new Date().toISOString(), minutes: +(real / 60).toFixed(1) };
  if (!NO_UPLOAD) {
    const { upload, accessToken } = require('../src/youtube');
    const credit = 'Map borders: historical-basemaps by André Ourednik (GPL-3.0). Pictures: AI illustrations. Narration: AI voice.';
    const chapters = ['0:00 Intro'];
    let at = 5;
    for (const it of timeline.slice(1)) { if (it.kind === 'map') chapters.push(`${Math.floor(at / 60)}:${String(Math.floor(at % 60)).padStart(2, '0')} ${it.heading}`); at += it.dur; }
    const desc = `${s.description}\n\nChapters:\n${chapters.join('\n')}\n\n${credit}`;
    const up = await upload(spec.out, { title: s.title, description: desc, tags: s.tags || [] });
    entry.videoId = up.id;
    log(`Long video uploaded: https://youtube.com/watch?v=${up.id}`);
    try {
      const tok = await accessToken();
      const r = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${up.id}`, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'image/jpeg' }, body: fs.readFileSync(spec.thumb) });
      log(r.ok ? 'Thumbnail set' : `Thumbnail not set (HTTP ${r.status}: ${(await r.text()).slice(0, 200)})`);
    } catch (e) { log('Thumbnail not set: ' + e.message); }
  }
  if (!NO_UPLOAD) { const h = readHist(); h.push(entry); fs.writeFileSync(HIST, JSON.stringify(h, null, 2)); }
}

main().catch(e => { log('FAILED: ' + (e.stack || e.message)); process.exit(1); });
