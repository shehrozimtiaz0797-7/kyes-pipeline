'use strict';
// Sound design shared by the videos and the voice samples:
// the voice gets a little deeper with a cold room echo, and a low dark drone plays underneath.
const { env } = require('./lib');

// Keep this SHORT and in Google's "Say ...:" form. A long instruction gets read out loud by the voice.
const DEFAULT_STYLE = 'Say slowly, in a low, eerie whisper:';

function ttsStyle() { return env('HORROR_STYLE', DEFAULT_STYLE); }

// Filter for the voice: [in] -> [out]
function voiceFx(input, output) {
  const p = Math.min(1, Math.max(0.85, Number(env('VOICE_PITCH', '0.94'))));   // 1 = no change, lower = deeper
  const echo = Math.max(0, Number(env('VOICE_REVERB', '0.22')));                 // 0 = no echo
  const parts = [
    'aresample=44100', `asetrate=${Math.round(44100 * p)}`, 'aresample=44100', `atempo=${(1 / p).toFixed(4)}`,
    'highpass=f=60', 'lowpass=f=9500'
  ];
  if (echo > 0) parts.push(`aecho=0.85:0.7:70|140|230:${echo.toFixed(2)}|${(echo * 0.6).toFixed(2)}|${(echo * 0.35).toFixed(2)}`);
  parts.push('aformat=sample_fmts=fltp:channel_layouts=stereo');
  return `[${input}]${parts.join(',')}[${output}]`;
}

// Inputs (lavfi) for the dark drone: brown-noise rumble + slow pulsing low tone.
function droneInputs(seconds) {
  return [
    '-f', 'lavfi', '-t', seconds.toFixed(3), '-i', 'anoisesrc=color=brown:amplitude=1:seed=7:sample_rate=44100',
    '-f', 'lavfi', '-t', seconds.toFixed(3), '-i', 'sine=frequency=52:sample_rate=44100'
  ];
}

// Filter that turns the two drone inputs into [output].
function droneFx(noiseIdx, toneIdx, seconds, output) {
  const vol = Math.max(0, Number(env('AMBIENCE_VOLUME', '0.06')));
  const out = Math.max(0, seconds - 1.5).toFixed(2);
  return `[${noiseIdx}:a]lowpass=f=170,volume=${vol}[dn];` +
    `[${toneIdx}:a]tremolo=f=0.25:d=0.7,volume=${(vol * 0.9).toFixed(3)}[dt];` +
    `[dn][dt]amix=inputs=2:normalize=0,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
    `afade=t=in:d=1.5,afade=t=out:st=${out}:d=1.5[${output}]`;
}

module.exports = { ttsStyle, voiceFx, droneInputs, droneFx, DEFAULT_STYLE };
