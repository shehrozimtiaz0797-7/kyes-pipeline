'use strict';
// Shared helpers: .env loading, logging, HTTP with retry, FFmpeg runner.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

function env(name, fallback) {
  // Trim spaces/line breaks: a secret pasted with a leading space would otherwise be rejected.
  const v = process.env[name] === undefined ? undefined : String(process.env[name]).trim();
  return v === undefined || v === '' ? fallback : v;
}

function requireEnv(name, hint) {
  const v = env(name);
  if (!v || /^your[-_]|^paste/i.test(v)) {
    throw new Error(`${name} is missing in the .env file. ${hint || ''}`.trim());
  }
  return v;
}

const LOG_DIR = path.join(ROOT, 'logs');
function log(msg) {
  const line = `[${new Date().toLocaleString()}] ${msg}`;
  console.log(line);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR, 'pipeline.log'), line + '\n');
  } catch (_) { /* logging must never break the run */ }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// fetch with retries for rate limits (429) and temporary server errors (5xx).
async function fetchRetry(url, options = {}, label = 'request', tries = 6) {
  let wait = 8000;
  for (let attempt = 1; attempt <= tries; attempt++) {
    let res;
    try {
      // a fresh timeout for every attempt, so one stuck request can't block the whole run
      const { timeoutMs, ...opts } = options;
      res = await fetch(url, timeoutMs ? { ...opts, signal: AbortSignal.timeout(timeoutMs) } : opts);
    } catch (err) {
      if (attempt === tries) throw new Error(`${label} failed: ${err.message}`);
      log(`${label}: network error (${err.message}), retrying in ${wait / 1000}s...`);
      await sleep(wait); wait *= 2; continue;
    }
    if (res.ok) return res;
    const body = await res.text().catch(() => '');
    if (res.status === 429 && /per day|PerDay|daily/i.test(body)) {
      const wait = body.match(/retry in ((?:\d+h)?(?:\d+m)?)/i)?.[1];
      throw new Error(`${label}: today's FREE limit is used up` + (wait ? ` (resets in about ${wait})` : '') +
        '. The next run will work after the reset.');
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === tries) {
      throw new Error(`${label} failed [${res.status}]: ${body.slice(0, 600)}`);
    }
    log(`${label}: busy/limited [${res.status}], retrying in ${wait / 1000}s (attempt ${attempt}/${tries})...`);
    await sleep(wait); wait = Math.min(wait * 2, 120000);
  }
  throw new Error(`${label} failed`);
}

function ffmpegPath() {
  if (env('FFMPEG_PATH')) return env('FFMPEG_PATH');
  try {
    const p = require('ffmpeg-static');
    if (p && fs.existsSync(p)) return p;
  } catch (_) { /* not installed */ }
  // Fallback: the FFmpeg that came with the YouTube Automation Agent next door.
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const sibling = path.join(ROOT, '..', 'youtube-automation-agent', 'node_modules', 'ffmpeg-static', exe);
  if (fs.existsSync(sibling)) return sibling;
  return 'ffmpeg';
}

function runFFmpeg(args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', ...args], { cwd, windowsHide: true });
    let err = '';
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('error', reject);
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg failed (${code}): ${err.slice(-1500)}`)));
  });
}

// Runs FFmpeg and returns its log output (used for silence detection).
function runFFmpegCapture(args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), ['-hide_banner', '-nostats', ...args], { cwd, windowsHide: true });
    let err = '';
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('error', reject);
    proc.on('close', code => code === 0 ? resolve(err) : reject(new Error(`FFmpeg failed (${code}): ${err.slice(-1500)}`)));
  });
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'video';
}

module.exports = { ROOT, env, requireEnv, log, sleep, fetchRetry, runFFmpeg, runFFmpegCapture, slugify };
