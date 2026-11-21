# Changes

## 2026-11-13 (owner request)
- Daily uploads cut to 3 (Malaysia time: 12:45am, 2:45am, 4:45am). A 'gate' job skips runs outside these slots, so cron-job.org needs no change. Manual run outside slots: tick 'force'.
- Reason: many uploads a day were splitting views; fewer videos should each get a bigger push.

## 2026-11-14 (22:40 MY)
- Every title now uses 'If Your <Thing> Ever <strange thing>... <COMMAND>'. 'If Your Mom Ever Says Goodnight Twice... LOCK YOUR DOOR' got 111 views and 3 likes in about a day; the POV titles from the same days got 1-15.
- Hot (home-trigger) settings are now picked 90% of the time (was 75%).

## 2026-11-14 (23:00 MY) - trend research
- Added 6 home triggers (cat, exact time like 3:33 AM, streetlights, alarm, baby monitor). The top 'If Your X Ever...' Shorts from 4-14 Nov were about cats and exact clock times (18k-196k views).

## 2026-11-15 (21:00 MY)
- Owner request: same times as Empire Maps. 3 videos a day at 2:50am, 8:50am, 12:50pm Malaysia time (gate hours 02 08 12, only cron calls at :50). Needs one cron-job.org job: 50 02,08,12 * * * (Asia/Kuala_Lumpur); the old :45 jobs are ignored.
- 23:25 MY: the 22:50 AI Wala slot was missed because cron-job.org still called at :45 (the gate only took :50). The gate now takes any call in the slot hour and skips if history.json was updated in the last hour, so :45 + :50 calls can never make two videos.

## 16 Nov 2026 (00:05 MY)
- KYES is now a map channel: "wars on the map", English (brand WAR MAPS). Uses the Empire Maps engine pinned at 2b676f2 + maps/topics.json + maps/script.js. Old horror code is kept but not used. Same slots (2:50am, 8:50am, 12:50pm MY). Horror videos stopped (0-5 views each). Videos already on the channel are not touched.
- 00:50 MY: own colours for this channel (maps/theme.py, theme 'war') so it does not look like Empire Maps.
- 16 Nov 11:30 MY: War Maps slots changed on owner request: calls at 21:50, 23:50, 01:50 MY so videos are live about 10pm, 12am, 2am. cron-job.org: 50 21,23,1 * * *
- 16 Nov 18:30 MY: added long videos (8-12 min illustrated war documentaries): long/make-long.js, long/longtools.py, workflow long-video.yml (manual start; upload off by default). Shorts are not changed.
- 16 Nov 19:10 MY: long videos now have burned-in captions timed to the voice (faster-whisper word times aligned to the script; words light up as spoken).
- 17 Nov 01:30 MY: long videos cancelled on owner request; long-video.yml workflow disabled (files kept, nothing runs). Shorts only.
- 17 Nov 18:30 MY: for more views: hook in the first 2 seconds, Shorts now 30-38 s (max 5 map years, 7-13 words per line), last line loops back into the first line.
- 18 Nov 02:15 MY: fixed render crash 'box offset can't be negative' (camera crop a hair wider than the map when fully zoomed out; hit the Reconquista Short). Patch applied in maps/theme.py.

* 2026-11-21: back to the horror POV Shorts (owner request: "jesy phely tha wesa"). The workflow is the last horror version (before 'Switch to map videos'), with the current cron-job.org slot hours kept. maps/ files stay unused.

## 2026-11-22 (04:57 MY)
- STOPPED by the owner ("ai wala and kyes ko band kar do, bs empire maps"). All workflows of this repo were disabled in GitHub Actions
  (Disable workflow), so cron-job.org calls no longer start any run. Nothing was deleted: the code, the videos and the channel stay as they are.
  To start again: Actions tab -> the workflow -> "Enable workflow".
