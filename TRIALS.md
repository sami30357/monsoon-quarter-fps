# Trials — Monsoon Quarter (threejs-fps-02)

Headless-Chromium playtest log. All runs used the vendored three.js 0.187.0
game served locally (`node serve.ts --port 8091`), viewport 480×300 for
playtests (SwiftShader is ~0.5–0.8× real time), 1280×800 for screenshots.
Zero console errors in every run unless noted.

## Smoke (2026-11-16 ~18:09 +06)
- Starter loads, `__shotReady` true, one 404 (favicon, since fixed).
- Result: pass.

## Bot probe (no player input)
- Before crate fix: allies stopped at (±19, 6); all four Sentinels clustered
  at (0, −13) — crates sat on the bot routes.
- After moving the lane crates off the routes and fixing the stuck-sidestep
  bug: Sentinels reach their holds (A −17,−11; B 17,−11; mid 0,−10; roamer
  patrols), allies reach the site approaches (−20,−2 / 21,−2). Fights are
  close-range and competitive, both sides take damage, rounds end by
  elimination (probe round 1: VAN 0–SEN 1). 0 console errors.
- Result: pass.

## Aim probe (`?shot=combat`, game-aimed rifle shot)
- Bot hp 100 → 66 (34 torso damage). 0 console errors.
- Result: pass — shooting, raycast and damage work.

## Aim-check probe (test-harness aim, live bot)
- Aim at the nearest Sentinel, then read yaw/pitch: yaw error 0.0°,
  pitch error ~0.0° over 8 aims at 24–25.5 m.
- Result: pass — the test harness aims exactly; later misses were a
  line-of-sight problem (shots hitting the fountain), not an aim bug.

## Kill probe (spawn, P9, aimed bursts at the Site A holder)
- Player bought the rifle but could not afford it ($800), so it fought with
  the P9. Bursts 3–7: holder hp 100 → 74 → 48 → 22 → −4 (dead); a second
  bot was also killed (kills 2). Player took one hit (100 → 91.1).
- Result: pass — the player can kill bots with aimed fire.

## Full playtest v3 (real input, 2 rounds)
- Pointer lock true; mouse look exact (yaw 0 → −0.264 for 120 px).
- Buy works (grenade $800 → $500; Hornet-9 $2400 → $900 in round 2).
- Grenade thrown (1 → 0), reload works (mag refills 14 / 27).
- Bots move: 7/7 moved >3 m (max displacement 29.9 m). Bots shoot back
  (player health reached 0). Rounds end and restart (round 2, then round 3).
  Shots fired ~51, 0 console errors.
- Player kills 0, planted false — the test player fired at bots it could not
  see (no line-of-sight check) and died pushing the site. Harness limits,
  not game bugs (see kill probe).
- Result: partial — all systems work; kill/plant verified separately.

## Plant probes (crouch-walk, then buy-phase rush)
- Player reaches Site A entrance (−16, −8) repeatedly and throws the
  grenade at the site (hp stays 100 after the fuse fix — no self-damage),
  but the Site A holder kills it at the entrance before the 3 s plant
  channel completes. Player got 1 kill en route in one attempt.
- Bot damage vs the player was reduced 14 → 10 torso / 42 → 30 head
  (bot-vs-bot unchanged at 26 / 78) after these runs, to give a human
  planter a fairer 3 s channel.
- The planted state itself is verified by `?shot=bomb`: bomb mesh +
  blinking light render, a Sentinel defuses it, HUD shows
  "SPIKE PLANTED — 32s", and the round ends on detonation/defuse.
- The hold-E plant path is the same channel the bots use; a full
  player-plant in live play was not achieved by the test bot in the time
  available. This is the known weak spot — see README/dossier.
- Result: plant mechanic implemented and its planted state verified;
  live player-plant not yet demonstrated by the test bot.

## Screenshots (2026-11-16 ~19:30 +06, re-taken from the final game)
- `1-buy.jpg` 69,331 B, `2-combat.jpg` 50,567 B, `3-bomb.jpg` 47,483 B,
  `4-end.jpg` 40,825 B — all 1280×800 JPEG, under the 256 KiB cap,
  0 console errors at capture. Cover and combat shots visually checked:
  "MONSOON QUARTER" sign legible, buy menu clean, neon stalls, rain,
  tracer + hit marker on a bot in combat.

## Dossier / gate check (2026-11-16 ~19:31 +06)
- `main.ts` with `MAKEFUN_OUTPUT_DIR` to two temp dirs: both contain
  `game/`, `screenshots/`, `dossier.json`; dossier.json byte-identical.
- Dossier text 105,717 chars (~103 KiB) — under the 160 KiB cap.
- `game/`: 2.2 MiB, 18 files, 0 symlinks — under 48 MiB / 993 files.
- `game/index.html` under 1 MiB; three.js 0.187.0 vendored byte-for-byte,
  single import map; no network references; `vendor/makefun-threejs.ts`
  unchanged; LICENSE MIT at root.
- Result: pass.

## Harness notes (for the next iteration)
- Headless SwiftShader is slow; use 480×300 for playtests.
- Real mouse positions saturate at the viewport edge; use synthetic
  `MouseEvent` with patched `movementX`/`movementY` getters (exact yaw).
- Semi-auto needs a ~350 ms press at headless frame rates; a 60–80 ms
  press falls between frames and never fires.
- Fire only with a line of sight (fountain/kiosk/stalls/site walls block
  shots); lead a strafing bot (~0.35 s) or the aim lands behind it.
- A test player that walks into its own grenade blast takes ~48
  self-damage — wait out the 1.6 s fuse before advancing.
