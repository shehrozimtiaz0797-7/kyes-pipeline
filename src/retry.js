'use strict';
// Small helpers so one temporary hiccup does not lose a whole video slot.
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Errors that will not fix themselves by trying again today (free limits used up).
const isQuota = msg => /quota|FREE limit|RESOURCE_EXHAUSTED|uploadLimitExceeded|dailyLimitExceeded|exceeded your/i.test(String(msg || ''));

async function withRetry(label, fn, { tries = 3, waitMs = 30000, log = console.log } = {}) {
  let last;
  for (let a = 1; a <= tries; a++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      if (isQuota(e.message) || a === tries) break;
      log(`${label} failed (${String(e.message).slice(0, 160)}), trying again in ${Math.round(waitMs / 1000)}s (${a}/${tries - 1})...`);
      await sleep(waitMs);
    }
  }
  throw last;
}
module.exports = { withRetry, isQuota, sleep };
