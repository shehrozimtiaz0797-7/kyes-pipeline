'use strict';
// Keep Your Eyes Shut — makes creepy POV "rules" Shorts from scratch and uploads them.
// Usage:
//   node make-video.js                       SHORTS_PER_RUN Shorts (default 1)
//   node make-video.js --count 2             2 Shorts
//   node make-video.js --topic "a night shift at a toy factory"
//   node make-video.js --no-upload           make the video but don't upload (for testing)
const fs = require('fs');
const path = require('path');
const { ROOT, env, log, slugify } = require('./src/lib');
const { withRetry, isQuota, sleep } = require('./src/retry');
const { writeStory, addHistory, readHistory } = require('./src/story');
const { makeSceneImages } = require('./src/images');
const { makeVoiceOvers } = require('./src/voice');
const { buildVideo } = require('./src/video');
const { upload } = require('./src/youtube');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : (process.argv[i + 1] || '');
}
const NO_UPLOAD = process.argv.includes('--no-upload') || env('UPLOAD', 'yes').toLowerCase() === 'no';

function cleanup(workDir) {
  for (const f of fs.readdirSync(workDir)) {
    if (/^(seg\d+\.mp4|joined\.mp4|voice_all\.wav|voice_full\d*\.wav|voice\d+\.wav|subs\d+\.ass|list\.txt)$/.test(f)) fs.rmSync(path.join(workDir, f), { force: true });
  }
  fs.rmSync(path.join(workDir, 'fonts'), { recursive: true, force: true });
  const keepDays = Number(env('KEEP_DAYS', '7'));
  const outRoot = path.join(ROOT, 'output');
  for (const d of fs.readdirSync(outRoot)) {
    const p = path.join(outRoot, d);
    try {
      if (Date.now() - fs.statSync(p).mtimeMs > keepDays * 86400000) fs.rmSync(p, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
  }
}

async function makeOne(topic) {
  const story = await writeStory(topic, 'short');
  const n = new Date(), p = v => String(v).padStart(2, '0');
  const stamp = `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}_${p(n.getHours())}-${p(n.getMinutes())}`;
  const workDir = path.join(ROOT, 'output', `${stamp}_${slugify(story.title)}`);
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, 'story.json'), JSON.stringify(story, null, 2));

  const images = await makeSceneImages(story, workDir);
  const voices = await makeVoiceOvers(story, workDir);
  const video = await buildVideo(story, images, voices, workDir);

  let videoId = null, publishAt = null;
  if (NO_UPLOAD) log('Upload skipped (--no-upload). Video is in: ' + workDir);
  else {
    const usedSlots = readHistory().map(h => h.publishAt).filter(t => t && new Date(t).getTime() > Date.now());
    ({ id: videoId, publishAt } = await withRetry('YouTube upload', () => upload(video.file, story, usedSlots, null), { tries: 3, waitMs: 45000, log }));
  }

  addHistory({ title: story.title, setting: story.setting || '', kind: story.kind, date: new Date().toISOString(), videoId, publishAt, folder: path.basename(workDir) });
  cleanup(workDir);
  return { story, videoId, file: video.file };
}

(async () => {
  const count = Math.max(1, Number(arg('--count') || env('SHORTS_PER_RUN', '1')));
  const topic = arg('--topic');
  log(`===== Keep Your Eyes Shut pipeline started (${count} Short${count > 1 ? 's' : ''}) =====`);
  let failed = 0;
  for (let i = 0; i < count; i++) {
    let ok = false, lastErr = null;
    for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
      try {
        const r = await makeOne(i === 0 ? topic : null);
        log(`Done ${i + 1}/${count}: ${r.story.title}`);
        ok = true;
      } catch (err) {
        lastErr = err;
        log(`✗ Video ${i + 1} (attempt ${attempt}/2) failed: ${err.message}`);
        if (isQuota(err.message) || attempt === 2) break;
        log('Trying once more with a new story in 30 seconds...');
        await sleep(30000);
      }
    }
    if (!ok) {
      failed++;
      if (/FREE limit is used up/.test(lastErr.message) && /voice/i.test(lastErr.message)) {
        log('Voice limit reached for today, stopping this run.');
        failed += count - i - 1;
        break;
      }
    }
  }
  log(`===== Finished: ${count - failed} ok, ${failed} failed =====`);
  process.exit(failed ? 1 : 0);
})();
