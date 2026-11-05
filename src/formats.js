'use strict';
// Video format: vertical Shorts (1080x1920), about 60-80 seconds.
const { env } = require('./lib');

const SHORT = {
  kind: 'short',
  label: 'Short',
  scenes: () => Number(env('SHORT_SCENES', '12')),
  wordsPerLine: '10 to 18',
  width: 1080, height: 1920,
  pic: 1080, picX: 0, picY: 420,
  gap: 0.35,
  // captions: big words in the middle of the picture
  subSize: 118, subMarginV: 640,
  // "RULE #1" label above the picture
  labelSize: 84, labelMarginV: 250,
  hookSize: 78, hookMarginV: 1560,
  brandSize: 48, brandMarginV: 110, brandAlign: 8,
  publishHours: () => env('SHORT_PUBLISH_HOURS', ''),
  footer: () => env('DESCRIPTION_FOOTER', '#Shorts #horror #pov #scarystories #creepy')
};

function format() { return SHORT; }

module.exports = { format, FORMATS: { short: SHORT } };
