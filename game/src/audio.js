// Sound, synthesized with WebAudio — no audio files, nothing over the network. Every
// sound is a small oscillator or filtered noise burst. Guarded: if the browser has no
// audio yet (no user gesture, headless), every call is a silent no-op.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.16;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  function tone(freq, dur, type, gain, slideTo) {
    if (!ensure()) return;
    try {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
      g.gain.setValueAtTime(gain, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.connect(g);
      g.connect(master);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch { /* silent */ }
  }

  function noiseBurst(dur, filterFreq, gain) {
    if (!ensure()) return;
    try {
      const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = filterFreq;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(filter);
      filter.connect(g);
      g.connect(master);
      src.start();
    } catch { /* silent */ }
  }

  return {
    unlock() { ensure(); },
    shot() { noiseBurst(0.09, 2400, 0.9); tone(140, 0.08, 'square', 0.25, 60); },
    enemyShot() { noiseBurst(0.07, 1800, 0.4); },
    reload() { tone(700, 0.05, 'square', 0.12); setTimeout(() => tone(500, 0.05, 'square', 0.12), 180); },
    hit() { tone(1200, 0.05, 'sine', 0.2); },
    kill() { tone(880, 0.09, 'sine', 0.2); tone(1320, 0.12, 'sine', 0.15); },
    hurt() { tone(180, 0.15, 'sawtooth', 0.2, 90); },
    click() { tone(900, 0.04, 'square', 0.1); },
    buy() { tone(660, 0.07, 'sine', 0.18); tone(990, 0.1, 'sine', 0.18); },
    plantBeep() { tone(1500, 0.07, 'square', 0.15); },
    defuseBeep() { tone(1100, 0.07, 'square', 0.15); },
    explosion() { noiseBurst(0.7, 500, 1.0); tone(70, 0.5, 'sine', 0.5, 30); },
    roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'sine', 0.2), i * 130)); },
    roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'sine', 0.18), i * 140)); },
    footstep(run) { noiseBurst(0.05, run ? 900 : 500, run ? 0.22 : 0.08); },
  };
}
