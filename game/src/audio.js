// Dustline — audio: fully procedural WebAudio, zero external files.
// One lazy AudioContext; every method is a safe no-op before ensure().
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;

  function ensure() {
    try {
      if (ctx) {
        if (ctx.state === 'suspended') void ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      // One shared noise buffer (1 s white noise), reused by every shot/boom.
      const len = ctx.sampleRate;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1;
    } catch (_e) { ctx = null; }
  }

  function tone(freq, dur, type, gain, slideTo, delay = 0) {
    if (!ctx) return;
    try {
      const t0 = ctx.currentTime + delay;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g).connect(master);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    } catch (_e) { /* headless-safe */ }
  }

  function noise(dur, filterFreq, gain, filterType = 'lowpass', delay = 0) {
    if (!ctx || !noiseBuf) return;
    try {
      const t0 = ctx.currentTime + delay;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = filterFreq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      src.connect(f).connect(g).connect(master);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    } catch (_e) { /* headless-safe */ }
  }

  const SHOT_PITCH = { pistol: 180, smg: 220, rifle: 150, sniper: 90 };
  const SHOT_NOISE = { pistol: 0.09, smg: 0.07, rifle: 0.11, sniper: 0.22 };

  return {
    ensure,
    setMuted(b) {
      muted = !!b;
      try { if (master) master.gain.value = muted ? 0 : 0.5; } catch (_e) { /* noop */ }
    },
    shot(kind) {
      if (!ctx) return;
      const p = SHOT_PITCH[kind] || 150;
      noise(SHOT_NOISE[kind] || 0.1, kind === 'sniper' ? 2500 : 3200, 0.5, 'bandpass');
      tone(p, 0.09, 'square', 0.25, p * 0.4);
    },
    dryFire() { tone(1400, 0.03, 'square', 0.15); },
    reload() { tone(900, 0.04, 'square', 0.18); tone(700, 0.04, 'square', 0.18, undefined, 0.18); },
    hit() { tone(1200, 0.04, 'sine', 0.25); },
    kill() { tone(880, 0.09, 'sine', 0.3); tone(1320, 0.14, 'sine', 0.3, undefined, 0.09); },
    plantBeep(progress01) {
      const p = Math.min(1, Math.max(0, progress01 || 0));
      tone(1000 + p * 600, 0.06, 'square', 0.2);
    },
    explosion() {
      noise(0.8, 400, 0.9, 'lowpass');
      tone(60, 0.7, 'sine', 0.6, 30);
    },
    footstep(run) { noise(0.05, 500, run ? 0.12 : 0.07, 'lowpass'); },
    ui() { tone(600, 0.05, 'sine', 0.2); },
    win() { tone(523, 0.15, 'sine', 0.3); tone(784, 0.25, 'sine', 0.3, undefined, 0.15); },
    lose() { tone(392, 0.15, 'sine', 0.3); tone(262, 0.3, 'sine', 0.3, undefined, 0.15); },
    roundStart() { tone(660, 0.08, 'square', 0.2); tone(880, 0.12, 'square', 0.2, undefined, 0.1); },
  };
}
