'use strict';
// Builds the vertical horror Short: dark blurred background, the scene picture with slow motion,
// film grain and vignette, big 1-3 word captions in the middle, "RULE 1" labels, one continuous voice track.
const fs = require('fs');
const path = require('path');
const { ROOT, env, runFFmpeg, log } = require('./lib');
const { format } = require('./formats');
const { voiceFx, droneInputs, droneFx } = require('./horror-audio');

const FPS = 30;
const RED = '&H004A4AFF';      // #FF4A4A in ASS (BGR) order
const WHITE = '&H00F0F4F5';
const GREY = '&H00B9ACA8';

function assTime(t) {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}
function assText(s) {
  return String(s).replace(/\\/g, '/').replace(/[{}]/g, '').replace(/\r?\n/g, ' ');
}

// Split a line into 1-3 word captions, timed by length so they follow the voice.
function chunks(text, start, end, maxWords, maxChars) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const groups = [];
  let cur = [];
  for (const w of words) {
    if (cur.length && (cur.length >= maxWords || (cur.join(' ') + ' ' + w).length > maxChars)) { groups.push(cur.join(' ')); cur = []; }
    cur.push(w);
    if (/[.!?,:;]$/.test(w)) { groups.push(cur.join(' ')); cur = []; } // break at punctuation
  }
  if (cur.length) groups.push(cur.join(' '));
  const weight = g => g.length + 4;
  const total = groups.reduce((n, g) => n + weight(g), 0) || 1;
  let t = start;
  return groups.map(g => {
    const d = (end - start) * (weight(g) / total);
    const item = { text: g, start: t, end: t + d };
    t += d;
    return item;
  });
}

// Scary words light up red.
const RED_WORDS = /^(NEVER|DON'?T|NOT|NO|ALWAYS|RUN|STOP|HIDE|LOOK|EYES|BEHIND|DARK|WRONG|SHUT|NOBODY|A|B)[.,!?:;]*$/;
function captionText(text) {
  return String(text).toUpperCase().split(/\s+/)
    .map(w => (RED_WORDS.test(w) ? `{\\c${RED}}${assText(w)}{\\c${WHITE}}` : assText(w))).join(' ');
}

function assHeader(f) {
  const font = env('CAPTION_FONT', 'Anton');
  return [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${f.width}`, `PlayResY: ${f.height}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Sub,${font},${f.subSize},${WHITE},&H000000FF,&H00000000,&H96000000,0,0,0,0,100,100,2,0,1,8,4,5,70,70,0,1`,
    `Style: Label,${font},${f.labelSize},${RED},&H000000FF,&H00000000,&H96000000,0,0,0,0,100,100,6,0,1,5,3,5,40,40,0,1`,
    `Style: Brand,${font},${f.brandSize},${GREY},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,8,0,1,2,0,8,40,40,${f.brandMarginV},1`,
    `Style: Hook,${font},${f.hookSize},${WHITE},&H000000FF,&H00000000,&H96000000,0,0,0,0,100,100,1,0,1,5,2,5,60,60,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ];
}

function buildAss({ subtitle, label, voiceDur, duration, bottom, f }) {
  const brand = env('BRAND_TEXT', 'KEEP YOUR EYES SHUT');
  const cx = f.width / 2;
  const lines = assHeader(f);
  lines.push(`Dialogue: 0,${assTime(0)},${assTime(duration)},Brand,,0,0,0,,${assText(brand)}`);
  if (label) lines.push(`Dialogue: 1,${assTime(0)},${assTime(duration)},Label,,0,0,0,,{\\an5\\pos(${cx},${f.labelMarginV})\\fad(250,200)}${assText(label.toUpperCase())}`);
  if (bottom) lines.push(`Dialogue: 1,${assTime(0.1)},${assTime(duration)},Hook,,0,0,0,,{\\an5\\pos(${cx},${f.hookMarginV})\\fad(250,200)}${assText(bottom)}`);
  const capY = f.picY + Math.round(f.pic * 0.66);
  for (const c of chunks(subtitle, 0.1, Math.max(0.6, voiceDur), 3, 16)) {
    lines.push(`Dialogue: 2,${assTime(c.start)},${assTime(c.end)},Sub,,0,0,0,,` +
      `{\\an5\\pos(${cx},${capY})\\fscx82\\fscy82\\t(0,90,\\fscx100\\fscy100)}${captionText(c.text)}`);
  }
  return lines.join('\n') + '\n';
}

// Slow, creeping camera moves.
const MOTIONS = [
  n => ({ z: `1+0.14*on/${n}`, x: 'iw/2-(iw/zoom/2)', y: 'ih/2-(ih/zoom/2)' }),            // slow push in
  n => ({ z: '1.12', x: `(iw-iw/zoom)*on/${n}`, y: 'ih/2-(ih/zoom/2)' }),                   // drift right
  n => ({ z: `1.14-0.14*on/${n}`, x: 'iw/2-(iw/zoom/2)', y: 'ih/2-(ih/zoom/2)' }),         // pull back
  n => ({ z: '1.12', x: `(iw-iw/zoom)*(1-on/${n})`, y: 'ih/2-(ih/zoom/2)' }),               // drift left
  n => ({ z: '1.12', x: 'iw/2-(iw/zoom/2)', y: `(ih-ih/zoom)*(1-on/${n})` })                // tilt up
];

function prepareFonts(workDir) {
  const dir = path.join(workDir, 'fonts');
  fs.mkdirSync(dir, { recursive: true });
  const own = path.join(ROOT, 'assets', 'fonts');
  if (fs.existsSync(own)) for (const name of fs.readdirSync(own)) fs.copyFileSync(path.join(own, name), path.join(dir, name));
}

function backgroundFilter(f) {
  return `scale=${f.width}:${f.height}:force_original_aspect_ratio=increase,crop=${f.width}:${f.height},boxblur=40:3,eq=brightness=-0.30:saturation=0.6`;
}

async function renderScene(i, { image, voice, voiceDur, subtitle, label, bottom, isLast, workDir, f }) {
  const frames = Math.round((voiceDur + (isLast ? 1.5 : f.gap)) * FPS);
  const duration = frames / FPS; // exact, so video and audio never drift
  const m = MOTIONS[i % MOTIONS.length](frames);
  const assName = `subs${i + 1}.ass`;
  fs.writeFileSync(path.join(workDir, assName), buildAss({ subtitle, label, voiceDur, duration, bottom, f }));
  const img = path.basename(image), out = `seg${i + 1}.mp4`;
  const fadeOut = Math.max(0, duration - 0.25).toFixed(2);
  const filter = [
    `[0:v]${backgroundFilter(f)},fps=${FPS}[bg]`,
    `[1:v]scale=${f.pic * 2}:${f.pic * 2}:force_original_aspect_ratio=increase,crop=${f.pic * 2}:${f.pic * 2},` +
      `zoompan=z='${m.z}':x='${m.x}':y='${m.y}':d=${frames}:s=${f.pic}x${f.pic}:fps=${FPS},` +
      `eq=contrast=1.08:saturation=0.8:brightness=-0.03,vignette=angle=PI/4.5[fg]`,
    `[bg][fg]overlay=${f.picX}:${f.picY}:shortest=1,noise=alls=9:allf=t,` +
      `fade=t=in:st=0:d=0.25,fade=t=out:st=${fadeOut}:d=0.25,subtitles=${assName}:fontsdir=fonts,format=yuv420p[v]`
  ].join(';');
  await runFFmpeg([
    '-y', '-loop', '1', '-t', String(duration), '-i', img, '-i', img,
    '-filter_complex', filter, '-map', '[v]', '-an',
    '-c:v', 'libx264', '-preset', env('X264_PRESET', 'veryfast'), '-crf', '21', '-r', String(FPS),
    '-frames:v', String(frames), out
  ], workDir);
  return { file: path.join(workDir, out), duration, voice: path.basename(voice), voiceDur };
}

async function buildVideo(story, images, voices, workDir) {
  const f = format(story.kind);
  prepareFonts(workDir);
  const segs = [];
  const last = story.scenes.length - 1;
  for (const [i, scene] of story.scenes.entries()) {
    log(`Rendering scene ${i + 1}/${story.scenes.length}...`);
    const bottom = i === 0 ? story.title.replace(/^POV:\s*/i, 'POV: ').toUpperCase()
      : i === last ? env('END_TEXT', 'COMMENT A OR B') : null;
    segs.push(await renderScene(i, {
      image: images[i], voice: voices[i].file, voiceDur: voices[i].duration,
      subtitle: scene.subtitle, label: scene.label, bottom,
      isLast: i === last, workDir, f
    }));
  }

  // Picture track: join the silent scene clips.
  fs.writeFileSync(path.join(workDir, 'list.txt'), segs.map(s => `file '${path.basename(s.file)}'`).join('\n') + '\n');
  await runFFmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'joined.mp4'], workDir);

  // Sound track: ONE continuous voice track (no clicks between scenes).
  const voiceInputs = segs.flatMap(s => ['-i', s.voice]);
  const voiceFilter = segs.map((s, i) => {
    const fadeOutAt = Math.max(0, s.voiceDur - 0.04).toFixed(3);
    return `[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
      `afade=t=in:st=0:d=0.02,afade=t=out:st=${fadeOutAt}:d=0.04,apad=whole_dur=${s.duration.toFixed(4)},atrim=0:${s.duration.toFixed(4)}[a${i}]`;
  }).join(';') + ';' + segs.map((_, i) => `[a${i}]`).join('') + `concat=n=${segs.length}:v=0:a=1[voice]`;
  await runFFmpeg(['-y', ...voiceInputs, '-filter_complex', voiceFilter, '-map', '[voice]', '-c:a', 'pcm_s16le', 'voice_all.wav'], workDir);

  const total = segs.reduce((n, s) => n + s.duration, 0);
  // Horror sound: deeper voice with a cold echo + a low dark drone underneath (AMBIENCE_VOLUME=0 turns the drone off).
  const audioArgs = ['-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2'];
  await runFFmpeg([
    '-y', '-i', 'joined.mp4', '-i', 'voice_all.wav', ...droneInputs(total),
    '-filter_complex',
    `${voiceFx('1:a', 'v')};${droneFx(2, 3, total, 'd')};` +
    `[v][d]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[a]`,
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', ...audioArgs, '-t', total.toFixed(3), 'final.mp4'
  ], workDir);
  const final = path.join(workDir, 'final.mp4');
  log(`Video ready: ${final} (${total.toFixed(1)}s)`);
  return { file: final, duration: total, thumbnail: null };
}

module.exports = { buildVideo, buildAss };
