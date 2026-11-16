// The armoury: three weapons with real, different numbers, plus the view models. Money
// matters because the prices and the damage are far apart: the pistol is free, the SMG is
// cheap and fast, the rifle hits hardest and costs most of a round's winnings.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPON_DEFS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', price: 0, damage: 26, headMult: 4,
    mag: 12, reserve: 36, gap: 0.18, reload: 1.3,
    spreadStill: 0.004, spreadMoving: 0.02, auto: false, kick: 0.006,
  },
  hornet: {
    id: 'hornet', name: 'Hornet-9 SMG', price: 1500, damage: 22, headMult: 4,
    mag: 28, reserve: 84, gap: 0.075, reload: 1.7,
    spreadStill: 0.006, spreadMoving: 0.03, auto: true, kick: 0.005,
  },
  vk47: {
    id: 'vk47', name: 'VK-47 Rifle', price: 2700, damage: 34, headMult: 4,
    mag: 25, reserve: 75, gap: 0.11, reload: 2.1,
    spreadStill: 0.0022, spreadMoving: 0.028, auto: true, kick: 0.009,
  },
};
const ORDER = ['p9', 'hornet', 'vk47'];

export function createWeapons(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.6, metalness: 0.3 });

  function buildModel(kind) {
    const model = new THREE.Group();
    if (kind === 'p9') {
      const slide = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.24), dark);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.08), grip);
      handle.position.set(0, -0.09, 0.07);
      model.add(slide, handle);
    } else if (kind === 'hornet') {
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.34), dark);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.26), grip);
      barrel.position.set(0, 0.02, -0.28);
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.06), grip);
      mag.position.set(0, -0.11, -0.02);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.16), grip);
      stock.position.set(0, -0.01, 0.24);
      model.add(receiver, barrel, mag, stock);
    } else {
      const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.46), dark);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.42), grip);
      barrel.position.set(0, 0.025, -0.4);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.24), grip);
      stock.position.set(0, -0.02, 0.32);
      const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.1), body);
      sight.position.set(0, 0.075, -0.05);
      model.add(receiver, barrel, stock, sight);
    }
    model.position.set(0.3, -0.3, -0.62);
    model.scale.setScalar(0.6);
    model.visible = false;
    camera.add(model);
    return model;
  }

  const models = { p9: buildModel('p9'), hornet: buildModel('hornet'), vk47: buildModel('vk47') };

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.14, 0.14),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.3, -0.28, -1.05);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.3, -0.26, -0.75);
  camera.add(flashLight);

  const ammo = {};
  for (const id of ORDER) ammo[id] = { mag: WEAPON_DEFS[id].mag, reserve: WEAPON_DEFS[id].reserve };
  const owned = { p9: true, hornet: false, vk47: false };
  const state = { current: 'p9', cooldown: 0, reloadLeft: 0, flash: 0, kick: 0 };
  models.p9.visible = true;

  function def() { return WEAPON_DEFS[state.current]; }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[state.current];
    model.position.z = -0.62 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (def().reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def().mag - ammo[state.current].mag;
        const take = Math.min(need, ammo[state.current].reserve);
        ammo[state.current].mag += take;
        ammo[state.current].reserve -= take;
      }
    }
  }

  return {
    state,
    defs: WEAPON_DEFS,
    order: ORDER,
    ammo,
    owned,
    step,
    current() { return state.current; },
    def,
    ready() {
      return ammo[state.current].mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def().gap;
      state.flash = 0.06;
      state.kick = 0.055;
    },
    takeRound() {
      if (ammo[state.current].mag <= 0) return false;
      ammo[state.current].mag -= 1;
      return true;
    },
    reload() {
      const d = def();
      if (state.reloadLeft > 0 || ammo[state.current].mag === d.mag || ammo[state.current].reserve === 0) return false;
      state.reloadLeft = d.reload;
      return true;
    },
    spread(speed) {
      const d = def();
      return d.spreadStill + Math.min(1, speed / 5.2) * d.spreadMoving;
    },
    switchTo(id) {
      if (!owned[id] || id === state.current) return false;
      models[state.current].visible = false;
      state.current = id;
      state.reloadLeft = 0;
      state.cooldown = 0;
      models[id].visible = true;
      return true;
    },
    cycle() {
      const ownedIds = ORDER.filter((id) => owned[id]);
      const next = ownedIds[(ownedIds.indexOf(state.current) + 1) % ownedIds.length];
      return this.switchTo(next);
    },
    // Buy a weapon: first purchase gives full ammo; re-buying an owned one refills ammo
    // for 20% of the price. Returns the cost, or -1 when the weapon id is unknown.
    buy(id) {
      const d = WEAPON_DEFS[id];
      if (!d) return -1;
      if (!owned[id]) {
        owned[id] = true;
        ammo[id] = { mag: d.mag, reserve: d.reserve };
        return d.price;
      }
      const cost = Math.round(d.price * 0.2);
      ammo[id] = { mag: d.mag, reserve: d.reserve };
      return cost;
    },
    refill() {
      for (const id of ORDER) {
        if (!owned[id]) continue;
        ammo[id] = { mag: WEAPON_DEFS[id].mag, reserve: WEAPON_DEFS[id].reserve };
      }
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
    resetOwned() {
      owned.p9 = true;
      owned.hornet = false;
      owned.vk47 = false;
      for (const id of ORDER) ammo[id] = { mag: WEAPON_DEFS[id].mag, reserve: WEAPON_DEFS[id].reserve };
      if (state.current !== 'p9') {
        models[state.current].visible = false;
        state.current = 'p9';
        models.p9.visible = true;
      }
    },
  };
}
