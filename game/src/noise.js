// The noise bus: sound is a mechanic, not decoration. Every loud action emits a noise
// event with a position and a radius; bots listen for events inside their hearing radius
// and investigate. Running is loud, walking is quiet, crouching is near-silent, gunfire
// and grenades carry across the map.
export function createNoise() {
  const events = [];
  let clock = 0;

  function emit(x, z, radius, level, kind) {
    events.push({ x, z, radius, level, kind, at: clock });
    if (events.length > 48) events.shift();
  }

  // Returns the loudest event heard from (x, z) within hearRadius, or null. Heard events
  // are consumed once, so a bot investigates each noise once and then moves on.
  function listen(x, z, hearRadius) {
    let best = null;
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const e = events[i];
      if (clock - e.at > 6) continue;
      const d = Math.hypot(e.x - x, e.z - z);
      if (d <= e.radius && d <= hearRadius) {
        if (!best || e.level > best.level) best = e;
      }
    }
    if (best) {
      const at = events.indexOf(best);
      if (at >= 0) events.splice(at, 1);
    }
    return best;
  }

  function step(dt) {
    clock += dt;
    while (events.length && clock - events[0].at > 6) events.shift();
  }

  return { emit, listen, step };
}
