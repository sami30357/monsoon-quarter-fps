// The player: keyboard movement through the shared body mover, mouse look, and recoil.
// Health and money live in main.js; this module only moves and looks.
import { createBody } from './body.js';

export function createPlayer(colliders) {
  const mover = createBody(colliders, 0, 15, {});
  const body = mover.state;

  function look(dx, dy, sensitivity = 0.0022) {
    body.yaw -= dx * sensitivity;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.45, body.pitch + pitchKick);
    body.yaw += yawKick;
  }

  function step(dt, keys) {
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    mover.setCrouch(crouching);
    // Shift walks: slower, and quiet — the noise system hears the difference.
    body.speedScale = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 0.45 : 1;
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    let wishX = 0;
    let wishZ = 0;
    if (forward || strafe) {
      const sin = Math.sin(body.yaw);
      const cos = Math.cos(body.yaw);
      const len = Math.hypot(forward, strafe);
      wishX = (-sin * forward + cos * strafe) / len;
      wishZ = (-cos * forward - sin * strafe) / len;
    }
    mover.step(dt, wishX, wishZ, keys.has('Space'));
  }

  return {
    state: body,
    step,
    look,
    recoil,
    groundSpeed: mover.groundSpeed,
  };
}
