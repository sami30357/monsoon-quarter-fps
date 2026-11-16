// The frag grenade: a thrown projectile with gravity and a bounce, a 1.6 s fuse, then a
// radial blast with falloff. Loud: the explosion is the noisiest event in the game, and
// bots across the map hear it.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const GRAVITY = 12;
const FUSE = 1.6;
const BLAST_RADIUS = 9;
const BLAST_DAMAGE = 110;

export function createGrenades(scene, colliders, noise) {
  const live = [];
  const box = new THREE.Box3();
  const meshGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const meshMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.5, metalness: 0.5 });
  const blastGeo = new THREE.SphereGeometry(1, 18, 12);
  const blasts = [];

  function throwGrenade(from, dir) {
    const mesh = new THREE.Mesh(meshGeo, meshMat);
    mesh.position.copy(from);
    mesh.castShadow = true;
    scene.add(mesh);
    const vel = dir.clone().multiplyScalar(13);
    vel.y += 3.2;
    live.push({ mesh, vel, fuse: FUSE });
  }

  // Sub-stepped so a fast grenade cannot tunnel through a thin wall. On a hit the
  // velocity component along the hit axis reflects with damping.
  function moveOne(g, dt) {
    const sub = 3;
    const h = dt / sub;
    for (let i = 0; i < sub; i += 1) {
      g.vel.y -= GRAVITY * h;
      const p = g.mesh.position;
      const nx = p.x + g.vel.x * h;
      const ny = p.y + g.vel.y * h;
      const nz = p.z + g.vel.z * h;
      box.min.set(nx - 0.09, ny - 0.09, nz - 0.09);
      box.max.set(nx + 0.09, ny + 0.09, nz + 0.09);
      let hit = null;
      for (const c of colliders) {
        if (box.intersectsBox(c)) { hit = c; break; }
      }
      if (hit) {
        const cx = Math.max(hit.min.x, Math.min(nx, hit.max.x));
        const cy = Math.max(hit.min.y, Math.min(ny, hit.max.y));
        const cz = Math.max(hit.min.z, Math.min(nz, hit.max.z));
        const dx = Math.abs(nx - cx);
        const dy = Math.abs(ny - cy);
        const dz = Math.abs(nz - cz);
        if (dx >= dy && dx >= dz) g.vel.x *= -0.45;
        else if (dy >= dx && dy >= dz) g.vel.y *= -0.45;
        else g.vel.z *= -0.45;
        g.vel.multiplyScalar(0.9);
      } else {
        p.set(nx, ny, nz);
      }
      if (p.y < 0.09) {
        p.y = 0.09;
        g.vel.y = Math.abs(g.vel.y) * 0.45;
        g.vel.x *= 0.85;
        g.vel.z *= 0.85;
      }
    }
  }

  // step returns an array of blasts {x, y, z} that went off this tick; the caller applies
  // the damage, so this module never touches health.
  function step(dt) {
    const wentOff = [];
    for (let i = live.length - 1; i >= 0; i -= 1) {
      const g = live[i];
      g.fuse -= dt;
      moveOne(g, dt);
      if (g.fuse <= 0) {
        const p = g.mesh.position;
        wentOff.push({ x: p.x, y: p.y, z: p.z });
        noise.emit(p.x, p.z, 35, 3, 'explosion');
        scene.remove(g.mesh);
        const flash = new THREE.Mesh(
          blastGeo,
          new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.85, depthWrite: false }),
        );
        flash.position.copy(p);
        flash.scale.setScalar(0.4);
        scene.add(flash);
        const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 60, 16, 2);
        light.position.copy(p);
        scene.add(light);
        blasts.push({ mesh: flash, light, life: 0.45 });
        live.splice(i, 1);
      }
    }
    for (let i = blasts.length - 1; i >= 0; i -= 1) {
      const b = blasts[i];
      b.life -= dt;
      const t = Math.max(0, b.life / 0.45);
      b.mesh.scale.setScalar(0.4 + (1 - t) * BLAST_RADIUS * 0.9);
      b.mesh.material.opacity = t * 0.7;
      b.light.intensity = t * 60;
      if (b.life <= 0) {
        scene.remove(b.mesh);
        scene.remove(b.light);
        b.mesh.material.dispose();
        blasts.splice(i, 1);
      }
    }
    return wentOff;
  }

  function clear() {
    for (const g of live) scene.remove(g.mesh);
    live.length = 0;
    for (const b of blasts) {
      scene.remove(b.mesh);
      scene.remove(b.light);
    }
    blasts.length = 0;
  }

  return { throwGrenade, step, clear, live, BLAST_RADIUS, BLAST_DAMAGE };
}
