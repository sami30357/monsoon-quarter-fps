// Monsoon Quarter: a rain-slicked neon night market at dusk. Narrow lanes between market
// stalls, a central plaza, and two bomb sites with their own character — the tea-house
// courtyard (Site A, amber) and the riverside warehouse (Site B, teal). Every box is a
// collider for bodies and a surface a bullet stops on. Signs are drawn at runtime on canvas
// textures, so nothing loads over the network. The waypoint graph is what the bots route on.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const SITES = {
  A: { x: -19, z: -8, r: 3.4, name: 'Tea House' },
  B: { x: 19, z: -8, r: 3.4, name: 'Warehouse' },
};
const SPAWNS = {
  vanguard: { x: 0, z: 15 },
  sentinel: { x: 0, z: -15 },
};

// Waypoint graph: lanes, connectors, sites and holds. Bots route on it with BFS.
const WAYPOINTS = {
  vSpawn: { x: 0, z: 15, links: ['vMid', 'vWest', 'vEast'] },
  vMid: { x: 0, z: 10, links: ['vSpawn', 'plaza'] },
  vWest: { x: -16, z: 10, links: ['vSpawn', 'aLane', 'plazaW'] },
  vEast: { x: 16, z: 10, links: ['vSpawn', 'bLane', 'plazaE'] },
  plaza: { x: 0, z: 2, links: ['vMid', 'plazaW', 'plazaE', 'midN'] },
  plazaW: { x: -8, z: 2, links: ['plaza', 'vWest', 'aLane'] },
  plazaE: { x: 8, z: 2, links: ['plaza', 'vEast', 'bLane'] },
  midN: { x: 0, z: -6, links: ['plaza', 'midHold', 'connN', 'connN2'] },
  midHold: { x: 0, z: -10, links: ['midN'] },
  aLane: { x: -20, z: 0, links: ['plazaW', 'vWest', 'aLaneN'] },
  aLaneN: { x: -20, z: -6, links: ['aLane', 'aEntry', 'connN', 'aHold'] },
  aEntry: { x: -16, z: -8, links: ['aLaneN', 'aSite', 'aHold'] },
  aSite: { x: -19, z: -8, links: ['aEntry'] },
  aHold: { x: -17, z: -11, links: ['aLaneN', 'aEntry'] },
  bLane: { x: 20, z: 0, links: ['plazaE', 'vEast', 'bLaneN'] },
  bLaneN: { x: 20, z: -6, links: ['bLane', 'bEntry', 'connN2', 'bHold'] },
  bEntry: { x: 16, z: -8, links: ['bLaneN', 'bSite', 'bHold'] },
  bSite: { x: 19, z: -8, links: ['bEntry'] },
  bHold: { x: 17, z: -11, links: ['bLaneN', 'bEntry'] },
  connN: { x: -8, z: -14, links: ['midN', 'aLaneN', 'sSpawn'] },
  connN2: { x: 8, z: -14, links: ['midN', 'bLaneN', 'sSpawn'] },
  sSpawn: { x: 0, z: -15, links: ['connN', 'connN2', 'midHold'] },
};

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'teal' || name === 'ember' ? 0.5 : 0.92,
      metalness: 0.03,
    });
  }
  // Wet ground: low roughness so the neon reads on it.
  const groundMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.canvas), roughness: 0.16, metalness: 0.6 });
  const puddleMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1d3049'), roughness: 0.05, metalness: 0.9 });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, matOverride) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), matOverride || materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Runtime-generated sign texture. The font auto-fits the canvas so a long name
  // like MONSOON QUARTER is never clipped at the edges, and the text is centred.
  function textTexture(text, fg, bg) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = fg;
    let size = 62;
    g.font = `bold ${size}px system-ui, sans-serif`;
    while (g.measureText(text).width > 472 && size > 24) {
      size -= 2;
      g.font = `bold ${size}px system-ui, sans-serif`;
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 68);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // A glowing sign board. Two single-sided planes back to back, so the text reads
  // correctly from both sides of a lane instead of mirrored. The basic material is
  // unlit, so it reads as neon against the dark.
  function sign(text, width, height, x, y, z, ry, fg, bg) {
    const tex = textTexture(text, fg, bg);
    const nx = Math.sin(ry);
    const nz = Math.cos(ry);
    for (const [off, rot] of [[0.02, ry], [-0.02, ry + Math.PI]]) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({ map: tex }),
      );
      mesh.position.set(x + nx * off, y, z + nz * off);
      mesh.rotation.y = rot;
      group.add(mesh);
    }
  }

  // A dim coloured strip flat on the ground: the sign's wet reflection.
  function glowStrip(width, depth, x, z, color, opacity) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.02, z);
    group.add(mesh);
  }

  // --- Ground and rain ---
  box(52.4, 0.4, 38.4, 0, -0.2, 0, 'canvas', groundMat);
  // Puddles: glossy patches that catch the neon.
  box(6, 0.02, 2.2, -4, 0.01, 4, 'canvas', puddleMat);
  box(5, 0.02, 2.0, 6, 0.01, -3, 'canvas', puddleMat);
  box(4, 0.02, 3.0, -19, 0.01, -8, 'canvas', puddleMat);
  box(4, 0.02, 3.0, 19, 0.01, -8, 'canvas', puddleMat);
  box(8, 0.02, 1.6, 0, 0.01, 12, 'canvas', puddleMat);

  // --- Perimeter: 5 m walls around the district ---
  box(0.5, 5, 38.4, -26.2, 2.5, 0, 'surface');
  box(0.5, 5, 38.4, 26.2, 2.5, 0, 'surface');
  box(52.4, 5, 0.5, 0, 2.5, -19.2, 'surface');
  box(52.4, 5, 0.5, 0, 2.5, 19.2, 'surface');

  // --- Site A: tea-house courtyard (west). U-shaped walls, entrance from the east. ---
  box(8.4, 3.4, 0.4, -19, 1.7, -12.2, 'surface'); // north wall
  box(6.4, 3.4, 0.4, -20, 1.7, -3.8, 'surface'); // south wall (gap at east end)
  box(0.4, 3.4, 2.4, -14.8, 1.7, -11, 'surface'); // east wall, north segment
  box(0.4, 3.4, 2.4, -14.8, 1.7, -5, 'surface'); // east wall, south segment
  // Tea tables and low seats inside the courtyard.
  box(1.8, 0.7, 1.8, -21, 0.35, -10, 'hairline');
  box(1.8, 0.7, 1.8, -17.5, 0.35, -6, 'hairline');
  box(1.2, 0.5, 1.2, -19, 0.25, -10.5, 'surface');
  box(1.2, 0.5, 1.2, -21, 0.25, -6, 'surface');
  // Site A pad and sign.
  box(5.4, 0.06, 5.4, -19, 0.03, -8, 'accent');
  sign('TEA HOUSE', 5.2, 1.3, -19, 3.9, -12.0, 0, PALETTE.canvas, PALETTE.accent);
  sign('A', 1.6, 1.6, -14.6, 2.6, -8, -Math.PI / 2, PALETTE.accent, PALETTE.canvas);
  glowStrip(5.4, 1.2, -19, -5.5, PALETTE.accent, 0.16);

  // --- Site B: riverside warehouse (east). Big door south, crates inside. ---
  box(8.4, 4.2, 0.4, 19, 2.1, -12.2, 'surface'); // north wall
  box(0.4, 4.2, 8.4, 23.2, 2.1, -8, 'surface'); // east wall
  box(5.4, 4.2, 0.4, 20.5, 2.1, -3.8, 'surface'); // south wall (gap at west end)
  box(0.4, 4.2, 2.4, 14.8, 2.1, -11, 'surface'); // west wall, north segment
  box(0.4, 4.2, 2.4, 14.8, 2.1, -5, 'surface'); // west wall, south segment
  // Crate stacks inside the warehouse.
  box(1.6, 1.1, 1.6, 21, 0.55, -10, 'hairline');
  box(1.6, 1.1, 1.6, 21, 1.65, -10, 'hairline');
  box(1.6, 1.1, 1.6, 17.5, 0.55, -6, 'hairline');
  box(1.2, 0.9, 1.2, 21.5, 0.45, -5.6, 'hairline');
  // Site B pad and sign.
  box(5.4, 0.06, 5.4, 19, 0.03, -8, 'teal');
  sign('WAREHOUSE', 5.2, 1.3, 19, 4.4, -12.0, 0, PALETTE.canvas, PALETTE.teal);
  sign('B', 1.6, 1.6, 14.6, 2.6, -8, Math.PI / 2, PALETTE.teal, PALETTE.canvas);
  glowStrip(5.4, 1.2, 19, -5.5, PALETTE.teal, 0.16);

  // --- Central plaza: fountain, stalls, the district arch ---
  const fountain = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.2, 0.7, 20), materials.surface);
  fountain.position.set(0, 0.35, 2);
  fountain.castShadow = true;
  fountain.receiveShadow = true;
  group.add(fountain);
  colliders.push(new THREE.Box3().setFromObject(fountain));
  shootables.push(fountain);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 1.6, 10), materials.hairline);
  spout.position.set(0, 1.4, 2);
  spout.castShadow = true;
  group.add(spout);
  colliders.push(new THREE.Box3().setFromObject(spout));
  shootables.push(spout);

  // Market stalls: a counter, an awning slab, a sign. Four around the plaza, two on each lane.
  function stall(x, z, ry, awning, label, fg) {
    const s = new THREE.Group();
    s.position.set(x, 0, z);
    s.rotation.y = ry;
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.15, 1.3), materials.hairline);
    counter.position.y = 0.575;
    counter.castShadow = true;
    counter.receiveShadow = true;
    const top = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.12, 1.7), materials[awning]);
    top.position.y = 2.35;
    top.castShadow = true;
    const postA = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.3, 0.1), materials.surface);
    postA.position.set(-1.35, 1.15, -0.7);
    const postB = postA.clone();
    postB.position.x = 1.35;
    const boardTex = textTexture(label, fg, PALETTE.canvas);
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 0.6),
      new THREE.MeshBasicMaterial({ map: boardTex }),
    );
    board.position.set(0, 1.9, 0.68);
    const boardBack = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 0.6),
      new THREE.MeshBasicMaterial({ map: boardTex }),
    );
    boardBack.position.set(0, 1.9, 0.66);
    boardBack.rotation.y = Math.PI;
    s.add(counter, top, postA, postB, board, boardBack);
    group.add(s);
    const c = new THREE.Box3().setFromObject(s);
    colliders.push(c);
    shootables.push(counter, top);
    return s;
  }
  stall(-7.5, 6.5, 0, 'accent', 'NOODLE BAR', PALETTE.accent);
  stall(7.5, 6.5, 0, 'teal', 'SILK & SPICE', PALETTE.teal);
  stall(-7.5, -2.5, Math.PI, 'ember', 'LANTERNS', PALETTE.ember);
  stall(7.5, -2.5, Math.PI, 'accent', 'RIVER FISH', PALETTE.accent);
  stall(-22.5, 3, Math.PI / 2, 'teal', 'TEA', PALETTE.teal);
  stall(22.5, 3, -Math.PI / 2, 'accent', 'FRUIT', PALETTE.accent);

  // Plaza arch with the district name.
  box(0.5, 4.6, 0.5, -3.4, 2.3, 8.5, 'surface');
  box(0.5, 4.6, 0.5, 3.4, 2.3, 8.5, 'surface');
  box(7.3, 0.9, 0.5, 0, 4.4, 8.5, 'surface');
  sign('MONSOON QUARTER', 5.6, 1.0, 0, 3.6, 8.2, Math.PI, PALETTE.ink, PALETTE.canvas);
  glowStrip(6.8, 1.0, 0, 9.8, PALETTE.accent, 0.12);

  // --- Mid choke: a kiosk block the lanes split around ---
  box(4.2, 2.4, 1.6, 0, 1.2, -8, 'surface');
  sign('JUICE', 3.6, 0.9, 0, 2.6, -7.15, 0, PALETTE.teal, PALETTE.canvas);
  box(1.4, 1.0, 1.4, -4.5, 0.5, -8.5, 'hairline');
  box(1.4, 1.0, 1.4, 4.5, 0.5, -8.5, 'hairline');

  // --- Lane cover: crates and planters so no lane is a bare shooting gallery ---
  box(1.6, 1.1, 1.6, -23, 0.55, 4, 'hairline');
  box(1.6, 1.1, 1.6, -23, 0.55, 7, 'hairline');
  box(1.6, 1.1, 1.6, 23, 0.55, 4, 'hairline');
  box(1.6, 1.1, 1.6, 23, 0.55, 7, 'hairline');
  box(2.2, 0.9, 1.2, -12, 0.45, -13.5, 'hairline');
  box(2.2, 0.9, 1.2, 12, 0.45, -13.5, 'hairline');
  box(1.2, 1.0, 1.2, -9, 0.5, 12, 'hairline');
  box(1.2, 1.0, 1.2, 9, 0.5, 12, 'hairline');
  box(1.8, 0.8, 1.8, -6, 0.4, -16.5, 'surface');
  box(1.8, 0.8, 1.8, 6, 0.4, -16.5, 'surface');

  // --- Canal strip along the east edge, behind the warehouse ---
  box(2.0, 0.06, 30, 25, 0.03, -2, 'teal', new THREE.MeshStandardMaterial({ color: new THREE.Color('#0a2e33'), roughness: 0.06, metalness: 0.9 }));

  // --- Light: dusk sky, a cool moon, warm neon points ---
  const sky = new THREE.HemisphereLight(new THREE.Color('#35506b'), new THREE.Color(PALETTE.canvas), 1.2);
  scene.add(sky);

  const moon = new THREE.DirectionalLight(new THREE.Color('#b8cfe8'), 1.7);
  moon.position.set(14, 20, 10);
  moon.target.position.set(0, 0, -2);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -30;
  moon.shadow.camera.right = 30;
  moon.shadow.camera.top = 30;
  moon.shadow.camera.bottom = -30;
  moon.shadow.camera.far = 60;
  moon.shadow.bias = -0.0006;
  scene.add(moon, moon.target);

  function neon(color, x, y, z, intensity, distance) {
    const light = new THREE.PointLight(new THREE.Color(color), intensity, distance, 2);
    light.position.set(x, y, z);
    scene.add(light);
    return light;
  }
  neon(PALETTE.accent, 0, 4.2, 2, 80, 22); // plaza
  neon(PALETTE.accent, -19, 3.6, -8, 32, 15); // tea house
  neon(PALETTE.teal, 19, 3.6, -8, 32, 15); // warehouse
  neon(PALETTE.accent, 0, 4.0, 12, 30, 16); // spawn arch

  // --- Waypoints: BFS over the graph, returns an array of {x, z} from start to goal ---
  function route(fromId, toId) {
    if (fromId === toId) return [WAYPOINTS[toId]];
    const prev = { [fromId]: null };
    const queue = [fromId];
    while (queue.length) {
      const cur = queue.shift();
      for (const next of WAYPOINTS[cur].links) {
        if (prev[next] !== undefined) continue;
        prev[next] = cur;
        if (next === toId) {
          const path = [WAYPOINTS[toId]];
          let at = cur;
          while (at) {
            path.unshift(WAYPOINTS[at]);
            at = prev[at];
          }
          return path;
        }
        queue.push(next);
      }
    }
    return [WAYPOINTS[toId]];
  }

  function nearestWaypoint(x, z) {
    let best = null;
    let bestD = Infinity;
    for (const [id, w] of Object.entries(WAYPOINTS)) {
      const d = (w.x - x) * (w.x - x) + (w.z - z) * (w.z - z);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  return { colliders, shootables, group, sites: SITES, spawns: SPAWNS, waypoints: WAYPOINTS, route, nearestWaypoint };
}
