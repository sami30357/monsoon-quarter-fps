// One shared mover for the player and the bots: acceleration, friction, gravity, crouch and
// jump, resolved as a box against the world's colliders one axis at a time, so a wall never
// swallows a body. A mover only moves where it is told; the caller owns the wish direction.
import * as THREE from 'three';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;

export function createBody(colliders, x, z, opts = {}) {
  const body = {
    position: new THREE.Vector3(x, 0, z),
    velocity: new THREE.Vector3(),
    yaw: opts.yaw ?? 0,
    pitch: 0,
    eye: STAND_EYE,
    height: STAND_HEIGHT,
    onGround: true,
    crouching: false,
    // speedScale lets the caller walk quietly (0.45) or run (1) without rebuilding the mover.
    speedScale: 1,
  };
  const probe = new THREE.Box3();
  const speed = opts.speed ?? 5.2;
  const crouchSpeed = opts.crouchSpeed ?? 2.4;
  const groundAccel = opts.groundAccel ?? 42;
  const airAccel = opts.airAccel ?? 9;
  const friction = opts.friction ?? 9;

  // lift keeps the feet and the crown out of the horizontal tests, so standing on the floor
  // is not read as walking into a wall.
  function overlaps(px, py, pz, height, lift) {
    probe.min.set(px - RADIUS, py + lift, pz - RADIUS);
    probe.max.set(px + RADIUS, py + height - lift, pz + RADIUS);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  function setCrouch(want) {
    if (want && !body.crouching) {
      body.crouching = true;
      body.height = CROUCH_HEIGHT;
    } else if (!want && body.crouching && !overlaps(body.position.x, body.position.y, body.position.z, STAND_HEIGHT, 0.02)) {
      body.crouching = false;
      body.height = STAND_HEIGHT;
    }
  }

  // wishX/wishZ is a unit (or zero) direction in world space. Returns nothing; read
  // body.position and body.velocity afterwards.
  function step(dt, wishX, wishZ, jump) {
    const eyeTarget = body.crouching ? CROUCH_EYE : STAND_EYE;
    body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);

    const top = (body.crouching ? crouchSpeed : speed) * (body.speedScale ?? 1);
    const blend = Math.min(1, (body.onGround ? groundAccel : airAccel) * dt / top);
    body.velocity.x += (wishX * top - body.velocity.x) * blend;
    body.velocity.z += (wishZ * top - body.velocity.z) * blend;
    if (body.onGround && wishX === 0 && wishZ === 0) {
      const damp = Math.max(0, 1 - friction * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }

    if (jump && body.onGround) {
      body.velocity.y = JUMP_SPEED;
      body.onGround = false;
    }
    body.velocity.y -= GRAVITY * dt;

    const nextX = body.position.x + body.velocity.x * dt;
    if (!overlaps(nextX, body.position.y, body.position.z, body.height, 0.04)) body.position.x = nextX;
    else body.velocity.x = 0;
    const nextZ = body.position.z + body.velocity.z * dt;
    if (!overlaps(body.position.x, body.position.y, nextZ, body.height, 0.04)) body.position.z = nextZ;
    else body.velocity.z = 0;

    body.position.y += body.velocity.y * dt;
    body.onGround = false;
    const hit = overlaps(body.position.x, body.position.y, body.position.z, body.height, 0);
    if (hit && body.velocity.y <= 0) {
      body.position.y = hit.max.y;
      body.velocity.y = 0;
      body.onGround = true;
    } else if (hit) {
      body.position.y = hit.min.y - body.height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      body.onGround = true;
    }
    body.velocity.y = Math.max(-30, body.velocity.y);
  }

  function groundSpeed() {
    return Math.hypot(body.velocity.x, body.velocity.z);
  }

  return { state: body, step, setCrouch, groundSpeed, overlaps };
}
