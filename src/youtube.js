'use strict';
// YouTube login (one time) and upload, using plain HTTPS calls — no extra packages.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');
const { ROOT, env, requireEnv, fetchRetry, log } = require('./lib');
const { format } = require('./formats');

const TOKEN_FILE = path.join(ROOT, 'youtube-token.json');
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly'
];

function client() {
  return {
    id: requireEnv('YT_CLIENT_ID', 'Use the Client ID from your Google Cloud project (see START-HERE.txt).'),
    secret: requireEnv('YT_CLIENT_SECRET', 'Use the Client Secret from your Google Cloud project.')
  };
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

async function login() {
  const { id, secret } = client();
  const server = http.createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const redirect = `http://127.0.0.1:${server.address().port}/`;
  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: id, redirect_uri: redirect, response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent'
  });
  console.log('\nA Google sign-in page is opening. If it does not open, copy this link into Chrome:\n\n' + authUrl + '\n');
  openBrowser(authUrl);

  const code = await new Promise((resolve, reject) => {
    server.on('request', (req, res) => {
      const u = new URL(req.url, redirect);
      const c = u.searchParams.get('code'); const e = u.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(c ? '<h2>Keep Your Eyes Shut: sign-in done. You can close this tab.</h2>' : `<h2>Sign-in failed: ${e}</h2>`);
      if (c) resolve(c); else if (e) reject(new Error('Google sign-in failed: ' + e));
    });
  });
  server.close();

  const res = await fetchRetry('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: 'authorization_code' })
  }, 'Google token', 2);
  const tok = await res.json();
  if (!tok.refresh_token) throw new Error('Google did not return a refresh token. Run "node auth.js" again.');
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ refresh_token: tok.refresh_token, saved: new Date().toISOString() }, null, 2));
  const ch = await channelInfo();
  console.log(`\n✓ Connected to YouTube channel: ${ch || '(name unavailable)'}\n`);
}

function refreshToken() {
  // Cloud (GitHub Actions): the login is stored as the secret YT_REFRESH_TOKEN.
  if (env('YT_REFRESH_TOKEN')) return env('YT_REFRESH_TOKEN');
  if (!fs.existsSync(TOKEN_FILE)) throw new Error('YouTube is not connected yet. Run: node auth.js');
  return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')).refresh_token;
}

async function accessToken() {
  const refresh_token = refreshToken();
  const { id, secret } = client();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token, client_id: id, client_secret: secret, grant_type: 'refresh_token' })
  });
  const tok = await res.json();
  if (!tok.access_token) {
    throw new Error('YouTube login expired (' + (tok.error || res.status) + '). On your laptop run "node auth.js", then "node print-secrets.js" ' +
      'and paste the new YT_REFRESH_TOKEN into GitHub (Settings -> Secrets -> Actions).');
  }
  return tok.access_token;
}

async function channelInfo() {
  try {
    const token = await accessToken();
    const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json();
    return d.items?.[0]?.snippet?.title || null;
  } catch (_) { return null; }
}

// Picks when the video goes public. PUBLISH_AT_HOUR can be one hour ("20") or several ("12,16,20").
// Each video takes the next free time slot, so 3 videos a day spread out instead of all going live at once.
function publishAtIso(usedSlots = [], hoursSetting = env('PUBLISH_AT_HOUR', '')) {
  const raw = String(hoursSetting || '').trim();
  if (raw === '') return null;
  const hours = raw.split(/[,\s]+/).map(Number).filter(h => Number.isInteger(h) && h >= 0 && h <= 23).sort((a, b) => a - b);
  if (!hours.length) return null;
  const used = new Set(usedSlots.map(s => new Date(s).getTime()));
  const earliest = Date.now() + 20 * 60 * 1000;
  for (let day = 0; day < 14; day++) {
    for (const h of hours) {
      const d = new Date();
      d.setDate(d.getDate() + day);
      d.setHours(h, 0, 0, 0);
      if (d.getTime() >= earliest && !used.has(d.getTime())) return d.toISOString();
    }
  }
  return null;
}

async function upload(videoFile, story, usedSlots = [], thumbnail = null) {
  const f = format(story.kind);
  const token = await accessToken();
  const privacy = env('PRIVACY', 'private');
  const publishAt = publishAtIso(usedSlots, f.publishHours());
  const tags = [...new Set([...(story.tags || []), 'Keep Your Eyes Shut', 'Shorts', 'horror', 'pov'])].slice(0, 15);
  const meta = {
    snippet: {
      title: story.title.slice(0, 100),
      description: `${story.description || ''}\n\n${f.footer()}`.slice(0, 4900),
      tags,
      categoryId: env('YT_CATEGORY', '24'),
      defaultLanguage: 'en',
      defaultAudioLanguage: 'en'
    },
    status: {
      privacyStatus: publishAt ? 'private' : privacy,
      ...(publishAt ? { publishAt } : {}),
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true
    }
  };
  const size = fs.statSync(videoFile).size;
  const start = await fetchRetry('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': 'video/mp4'
    },
    body: JSON.stringify(meta)
  }, 'YouTube upload start', 3);
  const location = start.headers.get('location');
  if (!location) throw new Error('YouTube did not return an upload address');
  log(`Uploading ${(size / 1e6).toFixed(1)} MB to YouTube...`);
  const put = await fetchRetry(location, {
    method: 'PUT', headers: { 'Content-Type': 'video/mp4' },
    body: fs.readFileSync(videoFile)
  }, 'YouTube upload', 3);
  const video = await put.json();
  const when = publishAt ? `scheduled to go public at ${new Date(publishAt).toLocaleString()}` : privacy;
  const link = f.kind === 'short' ? `https://youtube.com/shorts/${video.id}` : `https://youtu.be/${video.id}`;
  log(`✓ Uploaded ${f.label}: ${link} (${when})`);
  if (thumbnail && fs.existsSync(thumbnail)) await setThumbnail(video.id, thumbnail, token);
  return { id: video.id, publishAt };
}

// Custom thumbnail (long videos). Needs a phone-verified channel; if not allowed, YouTube picks one.
async function setThumbnail(videoId, file, token) {
  try {
    const r = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' },
      body: fs.readFileSync(file)
    });
    if (r.ok) log('✓ Thumbnail set');
    else log(`Thumbnail not set [${r.status}] — verify your channel by phone at youtube.com/verify to allow custom thumbnails.`);
  } catch (err) { log('Thumbnail not set: ' + err.message); }
}

module.exports = { login, upload, channelInfo, publishAtIso };
