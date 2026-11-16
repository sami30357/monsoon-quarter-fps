// The bots: three Vanguard allies and four Sentinel defenders. Each bot routes on the
// world's waypoint graph, holds a position, investigates noises it hears, and fights what
// it sees. Attackers carry the spike to a site and plant; defenders defuse. A bot thinks
// every 0.15 s (staggered), so seven bots cost about one raycast per frame between them.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createBody } from './body.js';

const BOT_SPEED = 4.6;
const HEALTH = 100;
const THINK_GAP = 0.15;
const REACT_MIN = 0.35;
const REACT_SPREAD = 0.25;
const HEAR_RADIUS = 26;
const PLANT_SECONDS = 3;
const DEFUSE_SECONDS = 5;

const raycaster = new THREE.Raycaster();
raycaster.far = 70;
const tmpDir = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();
const tmpFrom = new THREE.Vector3();

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

export function createBots(scene, world, noise) {
  const shootables = world.shootables;
  const bots = [];
  const hitMeshes = [];
  let seq = 0;

  // The player's hitbox: two invisible meshes the bots' raycasts can hit. The player's
  // own shooting never raycasts these (main.js only tests bot meshes and the world).
  const playerHitTorso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.0, 0.4), new THREE.MeshBasicMaterial({ visible: false }));
  playerHitTorso.userData.bot = 'player';
  playerHitTorso.userData.part = 'torso';
  const playerHitHead = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
  playerHitHead.userData.bot = 'player';
  playerHitHead.userData.part = 'head';
  scene.add(playerHitTorso, playerHitHead);
  const playerHitMeshes = [playerHitTorso, playerHitHead];

  const allyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.6, metalness: 0.05 });
  const allyDark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.7, metalness: 0.1 });
  const allyVisor = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.teal), roughness: 0.4, metalness: 0.1, emissive: new THREE.Color(PALETTE.teal), emissiveIntensity: 0.5 });
  const foeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.65, metalness: 0.1 });
  const foeHead = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ember), roughness: 0.45, metalness: 0.1, emissive: new THREE.Color(PALETTE.ember), emissiveIntensity: 0.35 });
  const foeVisor = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ember), roughness: 0.4, metalness: 0.1, emissive: new THREE.Color(PALETTE.ember), emissiveIntensity: 0.6 });

  function buildMesh(bot) {
    const group = new THREE.Group();
    const isFoe = bot.team === 'sentinel';
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.78, 0.3), isFoe ? foeMat : allyMat);
    torso.position.y = 1.15;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 14, 10), isFoe ? foeHead : allyMat);
    head.position.y = 1.68;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.05), isFoe ? foeVisor : allyVisor);
    visor.position.set(0, 1.68, 0.15);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.75, 0.26), isFoe ? foeMat : allyDark);
    legs.position.y = 0.375;
    group.add(torso, head, visor, legs);
    group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    torso.userData.bot = bot;
    torso.userData.part = 'torso';
    head.userData.bot = bot;
    head.userData.part = 'head';
    legs.userData.bot = bot;
    legs.userData.part = 'legs';
    hitMeshes.push(torso, head, legs);
    scene.add(group);
    return { group, torso, head };
  }

  function makeBot(team, x, z, role) {
    const bot = {
      id: seq,
      team,
      role,
      body: createBody(world.colliders, x, z, { speed: BOT_SPEED, yaw: team === 'vanguard' ? Math.PI : 0 }),
      health: HEALTH,
      alive: true,
      state: 'route',
      route: [],
      routeIdx: 0,
      target: null,
      targetIsPlayer: false,
      lastSeen: null,
      reactAt: 0,
      burstLeft: 0,
      nextShotAt: 0,
      thinkAt: 0,
      holdYaw: 0,
      holdUntil: 0,
      investigateUntil: 0,
      stuckAt: 0,
      stuckPos: new THREE.Vector3(x, 0, z),
      sidestepUntil: 0,
      sideX: 0,
      sideZ: 0,
      strafeDir: 1,
      strafeUntil: 0,
      channel: 0,
      channelKind: null,
      hasSpike: false,
      assignedSite: null,
      random: mulberry32(1000 + seq * 77),
    };
    seq += 1;
    const mesh = buildMesh(bot);
    bot.mesh = mesh;
    bot.group = mesh.group;
    bots.push(bot);
    return bot;
  }

  function clear() {
    for (const bot of bots) scene.remove(bot.group);
    bots.length = 0;
    hitMeshes.length = 0;
    seq = 0;
  }

  function setRoute(bot, fromId, toId) {
    bot.route = world.route(fromId, toId);
    bot.routeIdx = 0;
    bot.state = 'route';
  }

  function spawnRound() {
    clear();
    const v = world.spawns.vanguard;
    const s = world.spawns.sentinel;
    const allies = [
      makeBot('vanguard', v.x - 3, v.z + 1, 'rush'),
      makeBot('vanguard', v.x + 3, v.z + 1, 'rush'),
      makeBot('vanguard', v.x, v.z + 3, 'mid'),
    ];
    const foes = [
      makeBot('sentinel', s.x - 3, s.z - 1, 'holdA'),
      makeBot('sentinel', s.x + 3, s.z - 1, 'holdB'),
      makeBot('sentinel', s.x, s.z - 3, 'holdMid'),
      makeBot('sentinel', s.x - 1, s.z + 1, 'roam'),
    ];
    allies[0].assignedSite = 'A';
    allies[1].assignedSite = 'B';
    allies[2].assignedSite = allies[2].random() < 0.5 ? 'A' : 'B';
    for (const bot of allies) setRoute(bot, 'vSpawn', bot.assignedSite === 'A' ? 'aSite' : 'bSite');
    setRoute(foes[0], 'sSpawn', 'aHold');
    setRoute(foes[1], 'sSpawn', 'bHold');
    setRoute(foes[2], 'sSpawn', 'midHold');
    setRoute(foes[3], 'sSpawn', 'aHold');
    foes[3].roam = true;
    for (const bot of bots) {
      bot.group.position.copy(bot.body.state.position);
      bot.thinkAt = bot.random() * THINK_GAP;
    }
  }

  // Line of sight from the bot's eye to a point: true when no world surface is in between.
  function visibleFrom(bot, point) {
    tmpFrom.set(bot.body.state.position.x, bot.body.state.position.y + 1.55, bot.body.state.position.z);
    tmpDir.copy(point).sub(tmpFrom);
    const dist = tmpDir.length();
    if (dist > 55) return false;
    tmpDir.normalize();
    raycaster.set(tmpFrom, tmpDir);
    const hit = raycaster.intersectObjects(shootables, false)[0];
    return !hit || hit.distance >= dist - 0.4;
  }

  function nearestVisibleEnemy(bot, ctx) {
    let best = null;
    let bestD = Infinity;
    if (ctx.playerAlive) {
      tmpTarget.set(ctx.playerPos.x, ctx.playerPos.y + 1.2, ctx.playerPos.z);
      const d = tmpTarget.distanceTo(tmpFrom.set(bot.body.state.position.x, bot.body.state.position.y + 1.55, bot.body.state.position.z));
      if (d < bestD && visibleFrom(bot, tmpTarget)) {
        best = { isPlayer: true, pos: tmpTarget.clone(), dist: d, speed: ctx.playerSpeed, crouching: ctx.playerCrouching };
        bestD = d;
      }
    }
    for (const other of bots) {
      if (!other.alive || other.team === bot.team) continue;
      tmpTarget.set(other.body.state.position.x, other.body.state.position.y + 1.2, other.body.state.position.z);
      const d = tmpTarget.distanceTo(tmpFrom.set(bot.body.state.position.x, bot.body.state.position.y + 1.55, bot.body.state.position.z));
      if (d >= bestD) continue;
      // Bots only notice what is roughly in front of them, unless it is very close.
      const fx = -Math.sin(bot.body.state.yaw);
      const fz = -Math.cos(bot.body.state.yaw);
      tmpDir.copy(tmpTarget).sub(tmpFrom).normalize();
      if (d > 7 && tmpDir.x * fx + tmpDir.z * fz < 0.3) continue;
      if (visibleFrom(bot, tmpTarget)) {
        best = { isPlayer: false, bot: other, pos: tmpTarget.clone(), dist: d, speed: other.body.groundSpeed(), crouching: false };
        bestD = d;
      }
    }
    return best;
  }

  function faceToward(bot, x, z) {
    const dx = x - bot.body.state.position.x;
    const dz = z - bot.body.state.position.z;
    bot.body.state.yaw = Math.atan2(-dx, -dz);
  }

  function shootAt(bot, ctx, target) {
    if (ctx.time < bot.nextShotAt) return;
    if (ctx.time < bot.reactAt) return;
    // Aim error grows with distance and target speed, and crouching helps the target.
    // Bots are deliberately less lethal against the human player than against each
    // other, so a fair duel is winnable and peeking is not suicide.
    const err = 0.03 + target.dist * 0.0016 + target.speed * 0.007 + (target.crouching ? 0.015 : 0);
    tmpFrom.set(bot.body.state.position.x, bot.body.state.position.y + 1.55, bot.body.state.position.z);
    tmpDir.copy(target.pos).sub(tmpFrom).normalize();
    tmpDir.x += (bot.random() * 2 - 1) * err;
    tmpDir.y += (bot.random() * 2 - 1) * err;
    tmpDir.z += (bot.random() * 2 - 1) * err;
    tmpDir.normalize();
    scene.updateMatrixWorld(true);
    raycaster.set(tmpFrom, tmpDir);
    const allTargets = hitMeshes.concat(shootables, playerHitMeshes);
    const hit = raycaster.intersectObjects(allTargets, false)[0];
    bot.nextShotAt = ctx.time + 0.13;
    bot.burstLeft -= 1;
    ctx.onBotShot(bot);
    if (!hit) return;
    const hitBot = hit.object.userData.bot;
    if (!hitBot) return;
    const isHead = hit.object.userData.part === 'head';
    const falloff = Math.max(0.55, 1 - target.dist / 70);
    const dmg = hitBot === 'player'
      ? (isHead ? 30 : 10) * falloff
      : (isHead ? 78 : 26) * falloff;
    if (hitBot === 'player') {
      ctx.damagePlayer(dmg, isHead, bot);
      return;
    }
    if (!hitBot.alive) return;
    damage(hitBot, dmg, isHead ? 'head' : 'torso', ctx);
  }

  function damage(bot, amount, part, ctx) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.health > 0) return false;
    bot.alive = false;
    bot.state = 'dead';
    bot.channel = 0;
    bot.channelKind = null;
    ctx.onKill(bot);
    return true;
  }

  function think(bot, ctx) {
    const pos = bot.body.state.position;
    const live = ctx.phase === 'live';
    // Hearing: a noise inside the bot's radius pulls it off its route to investigate.
    if (bot.state !== 'engage' && bot.state !== 'plant' && bot.state !== 'defuse') {
      const heard = noise.listen(pos.x, pos.z, HEAR_RADIUS);
      if (heard && ctx.time > bot.investigateUntil) {
        const wp = world.nearestWaypoint(heard.x, heard.z);
        setRoute(bot, world.nearestWaypoint(pos.x, pos.z), wp);
        bot.state = 'investigate';
        bot.investigateUntil = ctx.time + 6;
      }
    }
    const enemy = live ? nearestVisibleEnemy(bot, ctx) : null;
    if (enemy) {
      const changed = !bot.target || bot.targetIsPlayer !== enemy.isPlayer || (enemy.bot && bot.target.bot !== enemy.bot);
      if (changed) {
        bot.reactAt = ctx.time + REACT_MIN + bot.random() * REACT_SPREAD;
        bot.burstLeft = 0;
      }
      bot.target = enemy;
      bot.targetIsPlayer = enemy.isPlayer;
      bot.lastSeen = enemy.pos.clone();
      bot.state = 'engage';
      bot.channel = 0;
      bot.channelKind = null;
      return;
    }
    bot.target = null;
    if (bot.state === 'engage') bot.state = bot.team === 'vanguard' ? 'route' : 'hold';
    if (bot.state === 'investigate' && bot.routeIdx >= bot.route.length) {
      bot.state = 'hold';
      bot.holdUntil = ctx.time + 2.5;
    }
    // Attackers with the spike plant when they reach a site and the coast is clear.
    if (live && bot.team === 'vanguard' && bot.hasSpike && !ctx.bombPlanted) {
      const site = world.sites[bot.assignedSite];
      const d = Math.hypot(pos.x - site.x, pos.z - site.z);
      if (d <= site.r) {
        bot.state = 'plant';
        bot.channelKind = 'plant';
        return;
      }
    }
    // Defenders defuse a planted bomb.
    if (bot.team === 'sentinel' && ctx.bombPlanted) {
      const d = Math.hypot(pos.x - ctx.bombPos.x, pos.z - ctx.bombPos.z);
      if (d <= 2.5) {
        bot.state = 'defuse';
        bot.channelKind = 'defuse';
        return;
      }
      if (bot.state !== 'route') setRoute(bot, world.nearestWaypoint(pos.x, pos.z), ctx.bombSite === 'A' ? 'aSite' : 'bSite');
      return;
    }
    if (bot.state === 'hold' && ctx.time < bot.holdUntil) return;
    if (bot.state === 'route' && bot.routeIdx >= bot.route.length) {
      if (bot.team === 'sentinel') {
        bot.state = 'hold';
        bot.holdUntil = ctx.time + 999;
        bot.holdYaw = bot.body.state.yaw;
      } else {
        // Attackers without a route wait at the site for the spike carrier.
        bot.state = 'hold';
        bot.holdUntil = ctx.time + 999;
      }
      return;
    }
    if (bot.state === 'hold' && bot.team === 'sentinel' && bot.roam) {
      // The roamer patrols between the two site holds.
      const dest = bot.roamSide === 'A' ? 'bHold' : 'aHold';
      bot.roamSide = bot.roamSide === 'A' ? 'B' : 'A';
      setRoute(bot, world.nearestWaypoint(pos.x, pos.z), dest);
    }
  }

  function stepBot(bot, dt, ctx) {
    const pos = bot.body.state.position;
    if (!bot.alive) {
      // Fall over and stay down for the round.
      bot.group.rotation.x += (-1.45 - bot.group.rotation.x) * Math.min(1, dt * 8);
      return;
    }
    if (ctx.time >= bot.thinkAt) {
      bot.thinkAt = ctx.time + THINK_GAP;
      think(bot, ctx);
    }

    let wishX = 0;
    let wishZ = 0;
    if (bot.state === 'engage' && bot.target) {
      faceToward(bot, bot.target.pos.x, bot.target.pos.z);
      if (ctx.time > bot.strafeUntil) {
        bot.strafeDir *= -1;
        bot.strafeUntil = ctx.time + 1.1 + bot.random() * 0.6;
      }
      const fx = -Math.sin(bot.body.state.yaw);
      const fz = -Math.cos(bot.body.state.yaw);
      wishX = -fz * bot.strafeDir * 0.35;
      wishZ = fx * bot.strafeDir * 0.35;
      if (bot.burstLeft <= 0 && ctx.time >= bot.nextShotAt) {
        bot.burstLeft = 3 + Math.floor(bot.random() * 3);
        bot.nextShotAt = ctx.time + 0.55 + bot.random() * 0.45;
      }
      if (bot.burstLeft > 0) shootAt(bot, ctx, bot.target);
    } else if (bot.state === 'plant') {
      bot.channel += dt;
      if (bot.channel >= PLANT_SECONDS) {
        bot.channel = 0;
        bot.channelKind = null;
        ctx.onPlant(bot.assignedSite, bot);
      }
    } else if (bot.state === 'defuse') {
      bot.channel += dt;
      if (bot.channel >= DEFUSE_SECONDS) {
        bot.channel = 0;
        bot.channelKind = null;
        ctx.onDefuse(bot);
      }
    } else if (bot.state === 'route' || bot.state === 'investigate') {
      const next = bot.route[bot.routeIdx];
      if (next) {
        const dx = next.x - pos.x;
        const dz = next.z - pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.7) {
          bot.routeIdx += 1;
        } else {
          wishX = dx / d;
          wishZ = dz / d;
          faceToward(bot, next.x, next.z);
        }
      }
      // Stuck: sidestep perpendicular to the route for a moment, then carry on.
      // The sidestep lasts several frames so the bot actually clears the obstacle
      // instead of nudging into it once and stopping again.
      const moved = Math.hypot(pos.x - bot.stuckPos.x, pos.z - bot.stuckPos.z);
      if (moved > 0.4) {
        bot.stuckPos.set(pos.x, 0, pos.z);
        bot.stuckAt = ctx.time;
      } else if (ctx.time - bot.stuckAt > 1.2) {
        bot.sideX = -wishZ;
        bot.sideZ = wishX;
        bot.sidestepUntil = ctx.time + 0.7;
        bot.stuckAt = ctx.time + 0.7;
      }
      if (ctx.time < bot.sidestepUntil) {
        wishX = bot.sideX;
        wishZ = bot.sideZ;
      }
    } else if (bot.state === 'hold') {
      // Scan the lane: slow yaw sweep.
      bot.body.state.yaw = bot.holdYaw + Math.sin(ctx.time * 0.5 + bot.id) * 0.6;
    }

    bot.body.step(dt, wishX, wishZ, false);
    bot.group.position.copy(pos);
    bot.group.position.y = pos.y;
    bot.group.rotation.y = bot.body.state.yaw;
  }

  function step(dt, ctx) {
    // Keep the player's hitbox on the player, so bots can hit them.
    playerHitTorso.position.set(ctx.playerPos.x, ctx.playerPos.y + 0.9, ctx.playerPos.z);
    playerHitHead.position.set(ctx.playerPos.x, ctx.playerPos.y + ctx.playerEye, ctx.playerPos.z);
    for (const bot of bots) stepBot(bot, dt, ctx);
  }

  function aliveCount(team) {
    let n = 0;
    for (const bot of bots) if (bot.alive && bot.team === team) n += 1;
    return n;
  }

  function nearestAliveAlly(x, z, team, exclude) {
    let best = null;
    let bestD = Infinity;
    for (const bot of bots) {
      if (!bot.alive || bot.team !== team || bot === exclude) continue;
      const d = Math.hypot(bot.body.state.position.x - x, bot.body.state.position.z - z);
      if (d < bestD) {
        bestD = d;
        best = bot;
      }
    }
    return best;
  }

  return {
    bots,
    hitMeshes,
    spawnRound,
    step,
    damage,
    aliveCount,
    nearestAliveAlly,
    clear,
  };
}
