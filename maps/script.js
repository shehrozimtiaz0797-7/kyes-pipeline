'use strict';
// Map channel script writer (runs on top of the Empire Maps engine).
// MAP_KIND=borders-ur : "how a country got its borders", spoken in Urdu, captions in Roman Urdu.
// MAP_KIND=wars-en    : "a war on the map", in English.
const fs = require('fs');
const path = require('path');
const { ROOT, env, log } = require('./lib');
const { askJSON } = require('./gemini');

const KIND = env('MAP_KIND', 'wars-en');
const URDU = KIND.endsWith('-ur');
const CHANNEL = env('CHANNEL_NAME', 'Map Shorts');
const HISTORY = path.join(ROOT, 'history.json');
const TOPICS = JSON.parse(fs.readFileSync(path.join(ROOT, 'topics.json'), 'utf8'));

function readHistory() { try { return JSON.parse(fs.readFileSync(HISTORY, 'utf8')); } catch (_) { return []; } }
function addHistory(entry) {
  const h = readHistory(); h.push(entry);
  fs.writeFileSync(HISTORY, JSON.stringify(h.slice(-500), null, 2));
}

// At most 5 map years per Short, so a video stays about 30-38 seconds (short Shorts are watched to the end).
function angles(t) {
  let ys = t.years;
  if (ys.length > 5) {
    const pick = [];
    for (let i = 0; i < 5; i++) pick.push(ys[Math.round(i * (ys.length - 1) / 4)]);
    ys = [...new Set(pick)];
  }
  return [{ angle: 'full', years: ys }];
}

// topics.json is in order of interest. Never-made topics first; after that, the one made longest ago.
function pickTopic(wanted) {
  const ids = new Set(TOPICS.map(t => t.id));
  const hist = readHistory().filter(h => ids.has(h.topic));
  const all = [];
  for (const t of TOPICS) for (const a of angles(t)) all.push({ topic: t, ...a });
  if (wanted) {
    const w = String(wanted).toLowerCase();
    const hit = all.find(x => x.topic.id === w || x.topic.name.toLowerCase().includes(w) || x.topic.label.toLowerCase().includes(w));
    if (hit) return hit;
  }
  const lastMade = id => { for (let i = hist.length - 1; i >= 0; i--) if (hist[i].topic === id) return i; return -1; };
  const recent = hist.slice(-8).map(h => h.topic);
  const fresh = all.filter(x => lastMade(x.topic.id) === -1);
  if (fresh.length) return fresh[0];
  const pool = all.filter(x => !recent.includes(x.topic.id));
  return (pool.length ? pool : all).sort((a, b) => lastMade(a.topic.id) - lastMade(b.topic.id))[0];
}

const yearText = y => (y < 0 ? `${-y} BC` : y < 1000 ? `${y} AD` : String(y));

const SCENES_RULE = n => `- "scenes": exactly ${n} objects, one per snapshot year, in order: {"markers": [up to 2 famous cities or battle sites that the line for that year talks about, each {"name": "short English name", "lat": number, "lon": number}], "arrow": null or {"from": {"lat","lon"}, "to": {"lat","lon"}} for a famous march, invasion or campaign in that line}. Coordinates must be real (decimal degrees).`;

function prompt(p) {
  const n = p.years.length;
  const ys = p.years.map(yearText).join(', ');
  const t = p.topic;
  if (URDU) {
    return `You write narration for "${CHANNEL}", a Pakistani/Indian YouTube Shorts channel of animated history maps, 50 seconds, in Urdu (Hindustani that Hindi speakers also understand).
Topic: how ${t.name} got its borders: ${t.story}.
The video shows the borders of ${t.name} on a map at these snapshot years, one after another: ${ys}. (The map data only has these years; a line may name the real year of an event that happened between the previous snapshot and its own snapshot year.)

Write:
- "lines": exactly ${n + 1} narration lines in ROMAN URDU. Line 1 (the hook) is shown with the map of ${yearText(p.years[0])}; ${p.years.slice(1).map((y, i) => `line ${i + 2} with the map of ${yearText(y)}`).join('; ')}; the last line is the closing line on the final map. So line 2 must talk about ${yearText(p.years[1] ?? p.years[0])} (or an event just before it), line 3 about ${yearText(p.years[2] ?? p.years[p.years.length - 1])}, and so on (Urdu written in English letters, the way people type on WhatsApp, e.g. "1947 mein ek naya mulk bana: Pakistan."). These are the on-screen captions.
  * Line 1 is the hook: surprise, contrast or a question that makes people stay, e.g. "Kya aap jante hain, 1880 mein Pakistan naam ka koi mulk nahi tha?"
  * Each middle line starts with a year ("1880 mein ...", "1947 tak ...") and says what changed on the map: wars, treaties, independence, partition, who took what. Name real places and real people.
  * The last line is a LOOP line: one short punchy sentence that flows straight back into line 1 when the Short replays (for example, if line 1 is about Pakistan not existing in 1880, the last line could end with 'aur ye sab shuru hua tha 1880 se, jab...'). No question in the last line, the screen already asks one.
  * The hook must grab in the first 2 seconds: open with the most shocking fact or a direct question. No slow intro, never 'Aaj hum dekhenge' or 'Is video mein'.
  * 7 to 13 words per line (the whole Short must be 30 to 38 seconds). Simple everyday Urdu, like a great storyteller. No hard Persian/Arabic words.
  * Only well-known, true history. No made-up numbers. Strictly neutral: no praise or hate of any country, religion or people; for disputed areas (like Kashmir) do not take sides, just leave them out.
- "speak": the same ${n + 1} lines, word for word the same meaning, written in Urdu script (نستعلیق). This is what the voice reads. Write years as digits.
${SCENES_RULE(n)}
- "hook_text": the on-screen title in ROMAN URDU, 3 to 7 words, a curiosity title different from line 1 (e.g. "Pakistan Ka Naqsha Kaise Bana?").
- "title": YouTube title in Roman Urdu under 70 characters with 1 emoji at the end, curious and searchable (e.g. "Pakistan Ka Naqsha Kaise Bana? 🗺️").
- "description": 2 short sentences in Roman Urdu about the video, then a blank line, then 4 hashtags (#history #maps #shorts and one about the country).
- "tags": 10 to 14 search tags (mix of Roman Urdu, Hindi-English and English, e.g. "pakistan ka naqsha", "pakistan history", "map").

Return ONLY JSON: {"lines": [...], "speak": [...], "scenes": [...], "hook_text": "...", "title": "...", "description": "...", "tags": [...]}`;
  }
  return `You write narration for "${CHANNEL}", a YouTube Shorts channel that shows famous wars and conquests on animated maps (like Kings and Generals, but 50 seconds).
War of this video: ${t.name}: ${t.story}.
The video shows the territory of ${t.label} on a map at these snapshot years, one after another: ${ys}. (The map data only has these years; a line may name the real year of a battle or event that happened between the previous snapshot and its own snapshot year.)

Write:
- "lines": exactly ${n + 1} narration lines. Line 1 (the hook) is shown with the map of ${yearText(p.years[0])}; ${p.years.slice(1).map((y, i) => `line ${i + 2} with the map of ${yearText(y)}`).join('; ')}; the LAST line is the closing line on the final map. Each middle line must talk about its own map's year (or a battle just before it).
  * Line 1 is the hook: tension, surprise or a question that makes people stay, e.g. "In 1938, Germany was about to start the deadliest war in history."
  * Each middle line starts with a year ("In 1941, ...", "By 1944, ...") and tells the war like a thriller: the big battles, invasions, turning points and who won. Name real battles, places and commanders.
  * The last line is a LOOP line: one short punchy sentence that flows straight back into line 1 when the Short replays (for example, if line 1 is 'In 1938, Germany was about to start the deadliest war in history', the last line could be 'And it all began in 1938, when...'). No question in the last line, the screen already asks one.
  * The hook must grab in the first 2 seconds: open with the most shocking fact or a direct question. No slow intro, never 'In this video' or 'Today we'.
  * 7 to 13 words per line, ${Math.round((n + 1) * 9)} to ${Math.round((n + 1) * 12)} words in total (the whole Short must be 30 to 38 seconds). Simple, gripping English, like a great documentary narrator.
  * Only well-known, true history. No made-up numbers. Neutral tone: no praise of war crimes and no hate of any nation, religion or people.
${SCENES_RULE(n)}
- "hook_text": the on-screen title, 4 to 7 words, a curiosity title different from line 1 (e.g. "How Hannibal Almost Destroyed Rome").
- "title": YouTube title under 70 characters with 1 emoji at the end, curious and searchable (e.g. "World War 2 on a Map in 50 Seconds ⚔️").
- "description": 2 short sentences about the video, then a blank line, then 4 hashtags (#history #war #shorts and one about this war).
- "tags": 10 to 14 search tags.

Return ONLY JSON: {"lines": [...], "scenes": [...], "hook_text": "...", "title": "...", "description": "...", "tags": [...]}`;
}

function checkPrompt(p, s) {
  const ys = p.years.map(yearText).join(', ');
  if (URDU) {
    return `You are a careful history fact-checker. These Roman Urdu narration lines (and the same lines in Urdu script) go with maps of ${p.topic.name} at the snapshot years ${ys} (the last line is a closing line). A line may name the real year of an event between snapshots.
lines: ${JSON.stringify(s.lines, null, 1)}
speak: ${JSON.stringify(s.speak, null, 1)}

Fix any wrong fact, wrong date, exaggeration presented as fact, or anything that takes sides on a disputed border. Keep the same number of lines, style and length (7 to 13 words each). If you change a line, change the same line in "speak" too. Keep correct lines exactly as they are.
Return ONLY JSON: {"lines": [...], "speak": [...], "changed": number of lines you changed}`;
  }
  return `You are a careful history fact-checker. These narration lines go with maps of ${p.topic.name} at the snapshot years ${ys} (the last line is a closing line). A line may name the real year of a battle or event between snapshots.
${JSON.stringify(s.lines, null, 1)}

Fix any line that has a wrong fact, a wrong date, or an exaggeration presented as fact. Keep the same number of lines, the same style and about the same length (7 to 13 words each). Keep correct lines exactly as they are.
Return ONLY JSON: {"lines": [...], "changed": number of lines you changed}`;
}

const num = v => (typeof v === 'number' ? v : Number(v));
function cleanScenes(raw, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = (raw || [])[i] || {};
    const ok = m => m && Number.isFinite(num(m.lat)) && Number.isFinite(num(m.lon)) && Math.abs(num(m.lat)) <= 85 && Math.abs(num(m.lon)) <= 180;
    const markers = (s.markers || []).filter(ok).slice(0, 2).map(m => ({ name: String(m.name || '').slice(0, 22), lat: num(m.lat), lon: num(m.lon) }));
    const arrow = s.arrow && ok(s.arrow.from) && ok(s.arrow.to) ? { from: { lat: num(s.arrow.from.lat), lon: num(s.arrow.from.lon) }, to: { lat: num(s.arrow.to.lat), lon: num(s.arrow.to.lon) } } : null;
    out.push({ markers, arrow });
  }
  return out;
}

const tidy = a => (Array.isArray(a) ? a : []).map(l => String(l).replace(/\s+/g, ' ').trim()).filter(Boolean);

function validate(p, s) {
  const n = p.years.length;
  const lines = tidy(s.lines);
  if (lines.length !== n + 1) throw new Error(`need ${n + 1} lines, got ${lines.length}`);
  const words = lines.join(' ').split(' ').length;
  if (words < (n + 1) * 5 || words > (n + 1) * 16) throw new Error(`script is ${words} words`);
  let speak = null;
  if (URDU) {
    speak = tidy(s.speak);
    if (speak.length !== n + 1) throw new Error(`need ${n + 1} Urdu lines, got ${speak.length}`);
    if (!speak.every(l => /[؀-ۿ]/.test(l))) throw new Error('speak is not in Urdu script');
  }
  const hook = String(s.hook_text || '').trim();
  if (!hook || hook.split(/\s+/).length > 9) throw new Error('bad hook_text');
  return {
    lines, speak, hook_text: hook,
    title: String(s.title || hook).slice(0, 95),
    description: String(s.description || '').trim(),
    tags: (Array.isArray(s.tags) ? s.tags : []).map(String).slice(0, 15),
    scenes: cleanScenes(s.scenes, n),
  };
}

async function writeScript(wanted) {
  const p = pickTopic(wanted);
  log(`Topic (${KIND}): ${p.topic.name} (${p.years.map(yearText).join(', ')})`);
  let last;
  for (let a = 1; a <= 3; a++) {
    try {
      const s = validate(p, await askJSON(prompt(p), { temperature: 0.8 }));
      try {
        const c = await askJSON(checkPrompt(p, s), { temperature: 0.2 });
        const okLines = Array.isArray(c.lines) && c.lines.length === s.lines.length;
        const okSpeak = !URDU || (Array.isArray(c.speak) && c.speak.length === s.speak.length);
        if (okLines && okSpeak) {
          if (c.changed) log(`Fact-check changed ${c.changed} line(s)`);
          s.lines = tidy(c.lines);
          if (URDU) s.speak = tidy(c.speak);
        }
      } catch (e) { log('Fact-check skipped: ' + e.message); }
      return finish(p, s);
    } catch (e) { last = e; log(`Script attempt ${a} not usable (${e.message})`); }
  }
  throw last;
}

function finish(p, s) {
  const scenes = p.years.map((y, i) => ({ year: y, ...s.scenes[i] }));
  scenes.push({ year: p.years[p.years.length - 1], markers: [], arrow: null });
  const credit = 'Map borders: historical-basemaps by André Ourednik (GPL-3.0). Narration: AI voice.';
  return {
    kind: KIND,
    topic: { id: p.topic.id, label: p.topic.label, labels: p.topic.labels || {}, name: p.topic.name, names: p.topic.names }, angle: p.angle, years: p.years,
    lines: s.lines, speak: s.speak || undefined, scenes, hook_text: s.hook_text,
    title: s.title, description: `${s.description}\n\n${credit}`.trim(), tags: s.tags,
  };
}

module.exports = { writeScript, readHistory, addHistory, pickTopic, finish, TOPICS };
