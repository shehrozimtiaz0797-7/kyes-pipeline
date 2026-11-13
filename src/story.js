'use strict';
// Writes the story: a second-person ("you") creepy POV story with rules and an A/B choice at the end.
const fs = require('fs');
const path = require('path');
const { ROOT, env, requireEnv, fetchRetry, log } = require('./lib');
const look = require('../style');
const { format } = require('./formats');

const HISTORY = path.join(ROOT, 'history.json');
let lastSetting = '';

function readHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY, 'utf8')); } catch (_) { return []; }
}
function addHistory(entry) {
  const h = readHistory();
  h.push(entry);
  fs.writeFileSync(HISTORY, JSON.stringify(h.slice(-300), null, 2));
}


// Place "themes": two settings with the same theme count as the same story (e.g. two different attic or college stories).
const THEMES = [
  ['hostel'], ['college', 'university', 'campus'], ['attic', 'grandmother', 'grandma', 'nani', 'dadi'],
  ['lake', 'boat', 'dock', 'canal', 'river'], ['bus'], ['haveli'], ['well'], ['rest house', 'cabin', 'guest house'],
  ['train', 'railway', 'station'], ['petrol', 'gas station', 'pump'], ['cinema', 'drive-in', 'theatre', 'theater'],
  ['hospital'], ['flat', 'apartment', 'landlord', 'neighbour', 'neighbor', 'room 4b'], ['mela', 'fairground', 'amusement'],
  ['library'], ['elevator', 'lift'], ['mall', 'plaza'], ['hotel'], ['flight', 'plane'], ['scarecrow', 'cornfield', 'farm', 'field', 'orchard'],
  ['forest', 'ranger', 'jungle', 'campground', 'camping'], ['road', 'gps', 'drive', 'highway', 'motorway', 'dhaba'],
  ['cricket', 'ground', 'stadium'], ['wedding'], ['call centre', 'call center'], ['museum'], ['lighthouse'], ['cruise', 'ship'],
  ['babysit'], ['workshop'], ['atm', 'bank'], ['parking'], ['school'], ['mountain', 'snow', 'cable car'], ['swamp'], ['desert'],
];
function themesOf(text) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  return THEMES.filter(words => words.some(w => t.includes(w))).map(words => words[0]);
}
function recentThemes(n = 15) {
  const set = new Set();
  for (const h of readHistory().slice(-n)) for (const th of themesOf(`${h.title} ${h.setting || ''}`)) set.add(th);
  return set;
}

function buildPrompt(topic, sceneCount, fmt) {
  const past = readHistory().slice(-40).map(h => `- ${h.title}`).join('\n') || '- (none yet)';
  // Never reuse a setting from the last 40 stories, and sometimes let the writer invent a new one.
  const usedSettings = readHistory().slice(-40).map(h => h.setting).filter(Boolean);
  const usedThemes = recentThemes(15);
  const fresh = list => (list || []).filter(x => !usedSettings.includes(x) && !themesOf(x).some(th => usedThemes.has(th)));
  const first = (look.settingsHot && Math.random() < 0.75) ? look.settingsHot : look.settings;
  let options = fresh(first);
  if (!options.length) options = fresh([...(look.settingsHot || []), ...look.settings]);
  const invent = !topic && (!options.length || Math.random() < 0.3);
  const setting = topic || (invent ? '' : options[Math.floor(Math.random() * options.length)]);
  lastSetting = topic ? topic : (invent ? 'invented' : setting);
  const settingLine = invent
    ? `Invent a fresh, original setting yourself: an ordinary place real people know (not a famous landmark). It must be clearly different from every earlier story listed below${usedThemes.size ? `, and must NOT be about any of these recently used places: ${[...usedThemes].join(', ')}` : ''}.`
    : setting;
  const short = sceneCount <= 10;
  // not every video has 5 rules, so the titles and stories do not all look the same
  const pickN = list => list[Math.floor(Math.random() * list.length)];
  const rules = short ? pickN([3, 3, 4]) : pickN([4, 5, 5, 6]);
  const wrong = Math.max(1, sceneCount - 4 - rules);

  return `You write scripts for "Keep Your Eyes Shut", a YouTube Shorts channel of creepy POV "rules" horror stories.
The viewer is the main character: always write in second person ("You...", "Your...").
Tone: calm, quiet, slow-burn dread, like someone whispering a warning. Creepy, not gory.

Setting: ${settingLine}

Write exactly ${sceneCount} scenes for a vertical Short of about 55-70 seconds. Structure:
- Scene 1: the COLD OPEN. 5 to 8 words. Start in the middle of the scariest moment of the story, when a rule is already being broken, with no warm-up and no "POV" (e.g. "It is knocking. You broke rule three.", "The scarecrow is not in the field anymore."). The viewer must feel danger in the first second.
- Scene 2: 6 to 10 words. Jump back: where the rules came from (a note, a sign, a voice, a logbook), e.g. "One hour ago, grandma left you a note."
- Then ${rules} rules, one per scene, each with a short creepy detail. Each rule starts with "Rule one:", "Rule two:" and so on.
- Then ${wrong} scene${wrong > 1 ? 's' : ''} where something goes wrong: a rule is tested, something breaks the pattern.
- Second-to-last scene: the final impossible moment.
- Last scene: give the viewer a choice in this exact pattern: "Do you A, <option>, or B, <option>? Comment A or B." Both options must sound risky.

Line rules:
- Each scene is ONE spoken line of ${fmt.wordsPerLine} words (scenes 1 and 2 are shorter, as said above). Simple English, short sentences, easy to read as big captions.
- Scene 1 "image_prompt" must be the most striking picture of the whole story: the threat itself, close and clear (a faceless silhouette right behind YOU, a hand-shaped shadow on the door, the thing standing where it should not be). Never an empty room or a calm establishing shot.
- The "something goes wrong" scenes must lead back to the moment shown in scene 1 and then go past it.
- "label": "RULE 1", "RULE 2"... on rule scenes; "A or B?" on the last scene; empty string "" on all other scenes.
- "image_prompt": English, 25-50 words, one clear dark moment for the picture. When the viewer is in the picture write "YOU" in capitals. Never describe a face; strange beings are faceless silhouettes or shadows. No blood, no gore, no weapons, no injuries, no dead bodies, no children in danger. No text or signs in the picture.
- The number of rules named in the title must be exactly the number of rules in the story.
- Fiction only. No real places, brands, people or real tragedies.

Every story must be clearly different from the earlier ones below: a different place AND a different kind of danger. Do not reuse a place, object or twist from them (for example no second 'hotel clerk with a key or card', no second scarecrow story, no second elevator).

Do not repeat these earlier stories:
${past}

Return ONLY valid JSON in this exact shape:
{
  "title": "curiosity title under 70 characters. Use the form 'POV: <Person> Left ${rules} Rules About <Object>' about two times out of three (e.g. 'POV: Grandma Left ${rules} Rules About the Scarecrow', 'POV: The Landlord Left ${rules} Rules About Room 4B'); otherwise 'POV: <Place> Has ${rules} Rules. Never <action>'",
  "description": "2 short sentences that tease the story without spoiling it, and say it is a fictional horror story",
  "tags": ["8 to 12 short tags"],
  "scenes": [ { "text": "...", "label": "", "image_prompt": "..." } ]
}`;
}

function parseJSON(text) {
  const cleaned = String(text).replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch (_) {
    const s = cleaned.indexOf('{'); const e = cleaned.lastIndexOf('}');
    if (s !== -1 && e > s) return JSON.parse(cleaned.slice(s, e + 1));
    throw new Error('Story writer did not return valid JSON');
  }
}

// Models to try in order. If the first is busy (503) or rate-limited, the next one writes the story.
function storyModels() {
  const main = env('GEMINI_TEXT_MODEL', 'gemini-3.8-flash');
  const backups = env('GEMINI_TEXT_FALLBACKS', 'gemini-3.5-flash-lite,gemini-3.5-flash').split(/[,\s]+/).filter(Boolean);
  return [...new Set([main, ...backups])];
}

async function writeStory(topic, kind = 'short') {
  const fmt = format(kind);
  const key = requireEnv('GEMINI_API_KEY', 'Get one at https://aistudio.google.com/apikey');
  const sceneCount = fmt.scenes();
  const models = storyModels();
  let lastError = null;
  const rounds = Math.max(1, Number(env('STORY_ROUNDS', '4')));

  for (let round = 1; round <= rounds; round++) {
  if (round > 1) {
    const wait = Number(env('STORY_ROUND_WAIT_MS', '180000'));
    log(`All story models are busy (Google high demand). Waiting ${Math.round(wait / 60000)} min, then trying again (round ${round}/${rounds})...`);
    await new Promise(r => setTimeout(r, wait));
  }
  for (const [m, model] of models.entries()) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    const isLast = m === models.length - 1;
    for (let attempt = 1; attempt <= 3; attempt++) {
      log(`Writing story (${sceneCount} scenes) with ${model}${topic ? ` (topic: ${topic})` : ''}...`);
      let data;
      try {
        const res = await fetchRetry(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: buildPrompt(topic, sceneCount, fmt) }] }],
            generationConfig: { temperature: 1.0, responseMimeType: 'application/json' }
          }),
          timeoutMs: Number(env('STORY_TIMEOUT_MS', '150000'))
        }, `Gemini story (${model})`, 3);
        data = await res.json();
      } catch (err) {
        lastError = err;
        if (/\[(429|500|502|503|504|404|400)\]|busy|FREE limit|failed:|abort|timeout/i.test(err.message)) {
          log(isLast ? `${model} is busy or unavailable too.` : `${model} is busy or unavailable, switching to ${models[m + 1]}...`);
          break;
        }
        throw err;
      }
      const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
      try {
        const story = parseJSON(text);
        const scenes = (story.scenes || []).filter(s => s && (s.text || s.subtitle) && s.image_prompt);
        if (!story.title || scenes.length < Math.max(6, Math.floor(sceneCount * 0.75))) throw new Error(`story incomplete (${scenes.length} scenes)`);
        story.scenes = scenes.slice(0, sceneCount).map(s => {
          const line = String(s.text || s.subtitle).trim();
          return { subtitle: line, voice: line, label: String(s.label || '').trim().slice(0, 14), image_prompt: String(s.image_prompt).trim() };
        });
        story.tags = Array.isArray(story.tags) ? story.tags.map(String).slice(0, 15) : [];
        story.setting = lastSetting;
        story.title = String(story.title).slice(0, 95);
        story.kind = fmt.kind;
        log(`Story ready: "${story.title}" (${story.scenes.length} scenes, ${model})`);
        return story;
      } catch (err) {
        lastError = err;
        log(`Story attempt ${attempt} was not usable (${err.message}), trying again...`);
      }
    }
  }
  }
  throw new Error('Could not get a usable story from Gemini: ' + (lastError ? lastError.message : 'unknown error'));
}

module.exports = { writeStory, addHistory, readHistory };
