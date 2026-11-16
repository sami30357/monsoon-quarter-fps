// Monsoon Quarter: boot and the one loop — a fixed 60 Hz simulation feeding a render at
// the display's rate. ?shot=buy|combat|bomb|end with &seed=N sets up a deterministic frame
// for a capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapons } from './weapons.js';
import { createGrenades } from './grenade.js';
import { createBots } from './bots.js';
import { createNoise } from './noise.js';
import { createEconomy, BUY_ITEMS, REWARDS } from './economy.js';
import { createMatch, BOMB_SECONDS } from './match.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const buySeconds = Number.parseFloat(params.get('buytime') ?? '12') || 12;
const roundSeconds = Number.parseFloat(params.get('roundtime') ?? '100') || 100;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 20, 62);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const world = createWorld(scene);
const noise = createNoise();
const economy = createEconomy();
const match = createMatch(world, { buySeconds, roundSeconds });
const weapons = createWeapons(camera);
const grenades = createGrenades(scene, world.colliders, noise);
const bots = createBots(scene, world, noise);
const player = createPlayer(world.colliders);
const input = createInput(renderer.domElement, onLockChange);
const hud = createHud();
const audio = createAudio();
const raycaster = new THREE.Raycaster();
raycaster.far = 80;

// Reused temps: the hot loop allocates nothing.
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
const tracerGeo = new THREE.BufferGeometry();
tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
const tracer = new THREE.Line(
  tracerGeo,
  new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0 }),
);
tracer.frustumCulled = false;
scene.add(tracer);

// Rain: 380 falling streaks around the camera, positions recycled in place.
const RAIN_DROPS = 380;
const rainPos = new Float32Array(RAIN_DROPS * 6);
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rain = new THREE.LineSegments(
  rainGeo,
  new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.muted), transparent: true, opacity: 0.32 }),
);
rain.frustumCulled = false;
scene.add(rain);
const rainSpeed = new Float32Array(RAIN_DROPS);
for (let i = 0; i < RAIN_DROPS; i += 1) {
  rainPos[i * 6] = (random() * 2 - 1) * 20;
  rainPos[i * 6 + 1] = random() * 16;
  rainPos[i * 6 + 2] = (random() * 2 - 1) * 20;
  rainPos[i * 6 + 3] = rainPos[i * 6];
  rainPos[i * 6 + 4] = rainPos[i * 6 + 1] - 0.55;
  rainPos[i * 6 + 5] = rainPos[i * 6 + 2];
  rainSpeed[i] = 16 + random() * 10;
}

// The planted spike: a small blinking device on the site.
const bombMesh = new THREE.Group();
{
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.22, 0.4),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ember), roughness: 0.4, metalness: 0.3, emissive: new THREE.Color(PALETTE.ember), emissiveIntensity: 0.4 }),
  );
  box.position.y = 0.11;
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 8, 6),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }),
  );
  lamp.position.y = 0.28;
  bombMesh.add(box, lamp);
  bombMesh.visible = false;
  scene.add(bombMesh);
}
const bombLight = new THREE.PointLight(new THREE.Color(PALETTE.ember), 0, 8, 2);
scene.add(bombLight);

const body = player.state;
const shootables = world.shootables;
let health = 100;
let alive = true;
let kills = 0;
let spikeHolder = 'player'; // 'player' | bot object | null
let plantProgress = 0;
let defuseProgress = 0;
let noiseLevel = 0;
let stepTimer = 0;
let buyOpen = false;
let prevPhase = match.state.phase;
let prevFiring = false;
let started = false;
let elapsed = 0;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();

const fps = {
  phase: 'buy', round: 1, wins: { vanguard: 0, sentinel: 0 },
  health: 100, money: 800, kills: 0, alive: true,
  botsAlive: 7, bombPlanted: false, noise: 0, spike: true,
  // Live debug getters for headless playtests (read-only).
  get px() { return body.position.x; },
  get pz() { return body.position.z; },
  get yaw() { return body.yaw; },
  get pitch() { return body.pitch; },
  get mag() { return weapons.ammo[weapons.current()].mag; },
  get reserve() { return weapons.ammo[weapons.current()].reserve; },
  get auto() { return weapons.def().auto; },
  get grenades() { return economy.state.grenades; },
  get bots() {
    return bots.bots.map((b) => ({
      id: b.id, team: b.team, x: b.body.state.position.x, z: b.body.state.position.z,
      hp: b.health, alive: b.alive,
    }));
  },
};
window.__fps = fps;

function botName(bot) {
  return bot.team === 'vanguard' ? `VAN-${bot.id + 1}` : `SEN-${bot.id - 2}`;
}

function resetRoundState() {
  body.position.set(world.spawns.vanguard.x, 0, world.spawns.vanguard.z);
  body.velocity.set(0, 0, 0);
  body.yaw = 0;
  body.pitch = 0;
  health = 100;
  alive = true;
  spikeHolder = 'player';
  plantProgress = 0;
  defuseProgress = 0;
  buyOpen = false;
  grenades.clear();
  bombMesh.visible = false;
  bombLight.intensity = 0;
  hud.hideBuyMenu();
  hud.hideBomb();
  hud.setSpike(true);
  hud.setHealth(health, economy.state.armor);
  hud.setAmmo(weapons.ammo[weapons.current()].mag, weapons.ammo[weapons.current()].reserve, weapons.def().name);
  hud.setMoney(economy.state.money);
}

function startMatch() {
  economy.resetMatch();
  weapons.resetOwned();
  match.startMatch();
  bots.spawnRound();
  resetRoundState();
}

function die() {
  alive = false;
  hud.setHint('You are down — your team fights on.');
  hud.setSpike(false);
  // The spike passes to the nearest living ally, who carries it to a site.
  if (spikeHolder === 'player') {
    const next = bots.nearestAliveAlly(body.position.x, body.position.z, 'vanguard', null);
    if (next) {
      next.hasSpike = true;
      next.assignedSite = Math.abs(next.body.state.position.x - world.sites.A.x) < Math.abs(next.body.state.position.x - world.sites.B.x) ? 'A' : 'B';
      spikeHolder = next;
      setRouteFor(next, next.assignedSite === 'A' ? 'aSite' : 'bSite');
    } else {
      spikeHolder = null;
    }
  }
}

function setRouteFor(bot, toId) {
  bot.route = world.route(world.nearestWaypoint(bot.body.state.position.x, bot.body.state.position.z), toId);
  bot.routeIdx = 0;
  bot.state = 'route';
}

function damagePlayer(amount, isHead, fromBot) {
  if (!alive) return;
  const absorbed = Math.min(economy.state.armor, amount * 0.5);
  economy.state.armor -= absorbed;
  health -= (amount - absorbed);
  hud.damageFlash();
  hud.setHealth(health, economy.state.armor);
  audio.hurt();
  if (health <= 0) {
    health = 0;
    hud.killfeed(`${fromBot ? botName(fromBot) : 'Blast'} ▸ You${isHead ? ' (headshot)' : ''}`);
    die();
  }
}

function damageBot(bot, amount, part) {
  const killed = bots.damage(bot, amount, part, botCtx);
  if (killed) {
    kills += 1;
    economy.add(REWARDS.kill);
    hud.killfeed(`You ▸ ${botName(bot)}${part === 'head' ? ' (headshot)' : ''}`);
    hud.setMoney(economy.state.money);
    audio.kill();
  }
  return killed;
}

const botCtx = {
  get time() { return elapsed; },
  get phase() { return match.state.phase; },
  playerPos: body.position,
  get playerEye() { return body.eye; },
  get playerAlive() { return alive; },
  get playerCrouching() { return body.crouching; },
  get playerSpeed() { return player.groundSpeed(); },
  get bombPlanted() { return match.state.bombPlanted; },
  get bombSite() { return match.state.bombSite; },
  get bombPos() { return match.state.bombPos; },
  get spikeWithPlayer() { return spikeHolder === 'player'; },
  damagePlayer,
  onBotShot(bot) {
    audio.enemyShot();
    noise.emit(bot.body.state.position.x, bot.body.state.position.z, 22, 2, 'shot');
  },
  onKill(bot) {
    hud.killfeed(`${botName(bot)} is down`);
  },
  onPlant(site, bot) {
    if (match.plantBomb(site)) {
      bombMesh.visible = true;
      bombMesh.position.set(world.sites[site].x, 0, world.sites[site].z);
      hud.banner('SPIKE PLANTED', `Site ${site} — ${world.sites[site].name}. Defend it.`);
      audio.plantBeep();
      noise.emit(world.sites[site].x, world.sites[site].z, 12, 2, 'plant');
    }
  },
  onDefuse() {
    if (match.defuseBomb()) {
      bombMesh.visible = false;
      bombLight.intensity = 0;
    }
  },
};

function shoot(spread) {
  if (!weapons.takeRound()) return false;
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const hit = raycaster.intersectObjects(bots.hitMeshes.concat(shootables), false)[0];
  const end = hit ? hit.point : tmpVec.copy(camera.position).addScaledVector(direction, 60);
  // Tracer from the muzzle to the hit.
  muzzle.copy(camera.position).addScaledVector(direction, 0.5);
  muzzle.x += 0.2;
  muzzle.y -= 0.15;
  const pos = tracerGeo.attributes.position.array;
  pos[0] = muzzle.x; pos[1] = muzzle.y; pos[2] = muzzle.z;
  pos[3] = end.x; pos[4] = end.y; pos[5] = end.z;
  tracerGeo.attributes.position.needsUpdate = true;
  tracer.material.opacity = 0.85;
  if (hit && hit.object.userData.bot) {
    const bot = hit.object.userData.bot;
    const part = hit.object.userData.part;
    const dmg = weapons.def().damage * (part === 'head' ? weapons.def().headMult : 1);
    damageBot(bot, dmg, part);
    hud.hitMarker(bot.health <= 0, shot ? 4000 : 90);
    audio.hit();
  }
  weapons.pullTrigger();
  player.recoil(0.009 + random() * 0.004, (random() * 2 - 1) * 0.004);
  noise.emit(body.position.x, body.position.z, 30, 3, 'shot');
  audio.shot();
  hud.setAmmo(weapons.ammo[weapons.current()].mag, weapons.ammo[weapons.current()].reserve, weapons.def().name);
  return true;
}

function plantSiteAt(x, z) {
  for (const key of ['A', 'B']) {
    const s = world.sites[key];
    if (Math.hypot(x - s.x, z - s.z) <= s.r) return key;
  }
  return null;
}

function step(dt) {
  elapsed += dt;
  const m = match.state;

  // Round bookkeeping: who is still standing.
  const attackersAlive = (alive ? 1 : 0) + bots.aliveCount('vanguard');
  const defendersAlive = bots.aliveCount('sentinel');
  match.tick(dt, {
    attackersAlive,
    defendersAlive,
    onRoundStart(round) {
      bots.spawnRound();
      resetRoundState();
      hud.banner(`ROUND ${round}`, 'Buy phase — press B for the market');
    },
  });

  // Phase transitions: rewards, banners, match end.
  if (m.phase !== prevPhase) {
    if (m.phase === 'live') {
      hud.banner(`ROUND ${m.round}`, 'Fight — plant the spike or clear the Sentinels', 1800);
      hud.hideBuyMenu();
      buyOpen = false;
    } else if (m.phase === 'end') {
      const won = m.winner === 'vanguard';
      economy.add(won ? REWARDS.roundWin : REWARDS.roundLoss);
      hud.setMoney(economy.state.money);
      hud.banner(won ? 'ROUND WON' : 'ROUND LOST', m.reason);
      if (won) audio.roundWin(); else audio.roundLose();
      bombMesh.visible = false;
      bombLight.intensity = 0;
    } else if (m.phase === 'matchEnd') {
      hud.showOverlay('matchEnd', { winner: m.matchWinner, v: m.wins.vanguard, s: m.wins.sentinel });
      if (document.pointerLockElement) document.exitPointerLock();
    }
    prevPhase = m.phase;
  }

  if (alive && (m.phase === 'live' || m.phase === 'buy')) {
    player.step(dt, input.state.keys);
  }
  weapons.step(dt);

  // Footsteps: the noise the player makes, by stance. Running is loud, walking is
  // quiet, crouching is near-silent — and the bots hear the difference.
  if (alive && player.groundSpeed() > 0.5 && body.onGround) {
    stepTimer += dt;
    const running = !body.crouching && body.speedScale > 0.9;
    const walking = !body.crouching && !running;
    const interval = running ? 0.38 : walking ? 0.55 : 0.9;
    if (stepTimer >= interval) {
      stepTimer = 0;
      const radius = running ? 14 : walking ? 6 : 2.5;
      const level = running ? 3 : walking ? 1 : 0.5;
      noise.emit(body.position.x, body.position.z, radius, level, 'step');
      audio.footstep(running);
      noiseLevel = running ? 1 : walking ? 0.35 : 0.08;
    }
  } else {
    noiseLevel = Math.max(0, noiseLevel - dt * 2);
  }

  bots.step(dt, botCtx);
  noise.step(dt);

  // Grenade blasts: radial damage with falloff, to bots and to the player.
  const blasts = grenades.step(dt);
  for (const blast of blasts) {
    audio.explosion();
    for (const bot of bots.bots) {
      if (!bot.alive) continue;
      const d = Math.hypot(bot.body.state.position.x - blast.x, bot.body.state.position.z - blast.z);
      if (d <= grenades.BLAST_RADIUS) {
        const dmg = grenades.BLAST_DAMAGE * (1 - d / (grenades.BLAST_RADIUS + 2));
        damageBot(bot, dmg, 'torso');
      }
    }
    if (alive) {
      const d = Math.hypot(body.position.x - blast.x, body.position.z - blast.z);
      if (d <= grenades.BLAST_RADIUS) {
        damagePlayer(grenades.BLAST_DAMAGE * (1 - d / (grenades.BLAST_RADIUS + 2)) * 0.6, false, null);
      }
    }
  }

  // Player plant / defuse channels: hold E, stay still, stay in the zone.
  const site = plantSiteAt(body.position.x, body.position.z);
  const holdingE = input.state.keys.has('KeyE');
  if (alive && m.phase === 'live' && holdingE && spikeHolder === 'player' && site && !m.bombPlanted) {
    plantProgress += dt;
    hud.setBomb(`PLANTING SPIKE — SITE ${site}`, plantProgress / 3);
    if (Math.floor(plantProgress * 2) !== Math.floor((plantProgress - dt) * 2)) audio.plantBeep();
    if (plantProgress >= 3) {
      plantProgress = 0;
      if (match.plantBomb(site)) {
        economy.add(REWARDS.plant);
        hud.setMoney(economy.state.money);
        bombMesh.visible = true;
        bombMesh.position.set(world.sites[site].x, 0, world.sites[site].z);
        hud.banner('SPIKE PLANTED', `Site ${site} — ${world.sites[site].name}. Defend it.`);
        audio.plantBeep();
      }
    }
  } else if (alive && m.phase === 'live' && holdingE && m.bombPlanted && m.bombPos
    && Math.hypot(body.position.x - m.bombPos.x, body.position.z - m.bombPos.z) <= 2.5) {
    defuseProgress += dt;
    hud.setBomb('DEFUSING SPIKE', defuseProgress / 5);
    if (Math.floor(defuseProgress * 2) !== Math.floor((defuseProgress - dt) * 2)) audio.defuseBeep();
    if (defuseProgress >= 5) {
      defuseProgress = 0;
      if (match.defuseBomb()) {
        economy.add(REWARDS.defuse);
        hud.setMoney(economy.state.money);
        bombMesh.visible = false;
        bombLight.intensity = 0;
      }
    }
  } else {
    plantProgress = 0;
    defuseProgress = 0;
    if (m.bombPlanted) {
      hud.setBomb(`SPIKE PLANTED — ${Math.max(0, Math.ceil(m.bombTimer))}s`, m.bombTimer / BOMB_SECONDS);
    } else {
      hud.hideBomb();
    }
  }

  // Bomb blink.
  if (m.bombPlanted) {
    const blink = Math.sin(elapsed * 6) > 0 ? 1 : 0.15;
    bombLight.intensity = 14 * blink;
    bombLight.position.set(m.bombPos.x, 1.2, m.bombPos.z);
  }

  // HUD sync.
  hud.setHealth(health, economy.state.armor);
  hud.setAmmo(weapons.ammo[weapons.current()].mag, weapons.ammo[weapons.current()].reserve, weapons.def().name);
  hud.setMoney(economy.state.money);
  hud.setRoundScore(m.wins.vanguard, m.wins.sentinel, m.round);
  const phaseLabel = m.phase === 'buy' ? 'Buy phase' : m.phase === 'live' ? (m.bombPlanted ? 'Spike live' : 'Round live') : m.phase === 'end' ? 'Round over' : 'Match over';
  hud.setTimer(m.phase === 'live' && m.bombPlanted ? m.bombTimer : m.phaseT, phaseLabel);
  hud.setSpike(spikeHolder === 'player');
  const noiseLabel = noiseLevel > 0.66 ? 'Loud — they hear you' : noiseLevel > 0.33 ? 'Audible' : noiseLevel > 0.05 ? 'Faint' : 'Silent';
  hud.setNoise(noiseLevel, noiseLabel);
  if (alive && m.phase === 'live') {
    if (spikeHolder === 'player' && site && !m.bombPlanted) hud.setHint('Hold E to plant the spike');
    else if (m.bombPlanted && m.bombPos && Math.hypot(body.position.x - m.bombPos.x, body.position.z - m.bombPos.z) <= 2.5) hud.setHint('Hold E to defuse the spike');
    else if (m.phase === 'buy') hud.setHint('');
    else hud.setHint('');
  } else if (!alive) {
    hud.setHint('You are down — your team fights on.');
  } else if (m.phase === 'buy') {
    hud.setHint('Press B to buy — running is loud, walking is quiet');
  } else {
    hud.setHint('');
  }

  fps.phase = m.phase;
  fps.round = m.round;
  fps.wins = m.wins;
  fps.health = health;
  fps.money = economy.state.money;
  fps.kills = kills;
  fps.alive = alive;
  fps.botsAlive = bots.aliveCount('vanguard') + bots.aliveCount('sentinel');
  fps.bombPlanted = m.bombPlanted;
  fps.noise = noiseLevel;
  fps.spike = spikeHolder === 'player';
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    const m = match.state;

    // Firing: auto weapons hold, the pistol fires on the press edge.
    const firing = input.state.firing;
    if (alive && (m.phase === 'live' || m.phase === 'buy')) {
      const want = weapons.def().auto ? firing : firing && !prevFiring;
      if (want && weapons.ready()) shoot(shot ? 0 : weapons.spread(player.groundSpeed()));
    }
    prevFiring = firing;

    if (input.wasPressed('KeyR') && weapons.reload()) {
      audio.reload();
      noise.emit(body.position.x, body.position.z, 6, 1, 'reload');
    }
    if (input.wasPressed('KeyB') && m.phase === 'buy') {
      buyOpen = !buyOpen;
      if (buyOpen) {
        hud.showBuyMenu(BUY_ITEMS, economy.state.money);
        audio.click();
      } else {
        hud.hideBuyMenu();
      }
    }
    if (buyOpen && m.phase === 'buy') {
      for (const item of BUY_ITEMS) {
        if (input.wasPressed(`Digit${item.key}`)) {
          const res = economy.buy(item.id, weapons);
          if (res.ok) {
            audio.buy();
            hud.setMoney(economy.state.money);
            hud.showBuyMenu(BUY_ITEMS, economy.state.money);
            if (weapons.defs[item.id]) weapons.switchTo(item.id);
          } else {
            audio.click();
          }
        }
      }
    } else if (!buyOpen) {
      const weaponKeys = { Digit1: 'p9', Digit2: 'hornet', Digit3: 'vk47' };
      for (const [code, id] of Object.entries(weaponKeys)) {
        if (input.wasPressed(code) && weapons.switchTo(id)) audio.click();
      }
      if (input.wasPressed('KeyQ') && weapons.cycle()) audio.click();
    }
    if (input.wasPressed('KeyG') && m.phase === 'live' && economy.state.grenades > 0) {
      camera.getWorldDirection(direction);
      tmpVec.copy(camera.position).addScaledVector(direction, 0.6);
      grenades.throwGrenade(tmpVec, direction);
      economy.state.grenades -= 1;
      audio.click();
    }
    const wheel = input.takeWheel();
    if (wheel !== 0 && weapons.cycle()) audio.click();

    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  // Tracer fade and rain fall, on the render clock.
  tracer.material.opacity = Math.max(0, tracer.material.opacity - dt * 10);
  const rp = rainGeo.attributes.position.array;
  for (let i = 0; i < RAIN_DROPS; i += 1) {
    const fall = rainSpeed[i] * dt;
    rp[i * 6 + 1] -= fall;
    rp[i * 6 + 4] -= fall;
    if (rp[i * 6 + 1] < 0) {
      rp[i * 6] = camera.position.x + (random() * 2 - 1) * 20;
      rp[i * 6 + 1] = 14 + random() * 2;
      rp[i * 6 + 2] = camera.position.z + (random() * 2 - 1) * 20;
      rp[i * 6 + 3] = rp[i * 6];
      rp[i * 6 + 4] = rp[i * 6 + 1] - 0.55;
      rp[i * 6 + 5] = rp[i * 6 + 2];
    }
  }
  rainGeo.attributes.position.needsUpdate = true;
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  startMatch();
  body.pitch = 0;
  body.yaw = 0;
  if (name === 'buy') {
    // Buy phase at spawn, market open, allies beside the player, arch ahead.
    body.position.set(0, 0, 15);
    bots.bots[0].body.state.position.set(-2.5, 0, 13.5);
    bots.bots[1].body.state.position.set(2.5, 0, 13.5);
    bots.bots[0].group.position.copy(bots.bots[0].body.state.position);
    bots.bots[1].group.position.copy(bots.bots[1].body.state.position);
    settle(30);
    hud.showBuyMenu(BUY_ITEMS, economy.state.money);
    aimAt(new THREE.Vector3(0, 3.2, 8.5));
  } else if (name === 'combat') {
    // Live round, rifle in hand, an enemy up the west lane with a clear sightline.
    match.state.phase = 'live';
    match.state.phaseT = 90;
    economy.add(3000);
    economy.buy('vk47', weapons);
    weapons.switchTo('vk47');
    body.position.set(-4, 0, 8);
    const foe = bots.bots[3];
    foe.body.state.position.set(-4, 0, 0);
    foe.body.state.yaw = Math.PI;
    foe.group.position.copy(foe.body.state.position);
    foe.group.rotation.y = Math.PI;
    settle(20);
    // Aim at where the bot actually is now, not where it was placed: it walks
    // its route during the settle, and a 0.5 m error is a clean miss.
    const fp = foe.body.state.position;
    aimAt(new THREE.Vector3(fp.x, 1.2, fp.z));
    shoot(0);
    settle(2);
  } else if (name === 'bomb') {
    // Spike planted at the Tea House; a Sentinel is defusing, the player covers the site.
    match.state.phase = 'live';
    match.state.phaseT = 90;
    match.plantBomb('A');
    bombMesh.visible = true;
    bombMesh.position.set(world.sites.A.x, 0, world.sites.A.z);
    body.position.set(-13.5, 0, -8);
    const foe = bots.bots[3];
    foe.body.state.position.set(-19, 0, -8);
    foe.state = 'defuse';
    foe.channel = 2.5;
    foe.channelKind = 'defuse';
    foe.group.position.copy(foe.body.state.position);
    settle(15);
    const dp = foe.body.state.position;
    aimAt(new THREE.Vector3(dp.x, 1.2, dp.z));
    hud.setBomb('SPIKE PLANTED — 32s', 32 / BOMB_SECONDS);
  } else {
    // Round won: banner up, plaza and fountain ahead, allies in the mid.
    match.endRound('vanguard', 'Spike detonated');
    body.position.set(0, 0, 9);
    body.yaw = 0;
    settle(10);
    hud.banner('ROUND WON', 'Spike detonated — Vanguard leads 1–0');
  }
  hud.setAmmo(weapons.ammo[weapons.current()].mag, weapons.ammo[weapons.current()].reserve, weapons.def().name);
  hud.setMoney(economy.state.money);
  hud.setRoundScore(match.state.wins.vanguard, match.state.wins.sentinel, match.state.round);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (match.state.phase === 'matchEnd') {
    startMatch();
    input.requestLock();
    return;
  }
  input.requestLock();
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (match.state.phase !== 'matchEnd') {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

startMatch();
syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
