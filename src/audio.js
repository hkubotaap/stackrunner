// Procedural sound for StackRunner (Web Audio only, no sample files).
// Engine: kei-class 660cc 3-cylinder turbo + CVT. 4-stroke 3 cyl fires 1.5x per crank revolution.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.rpm = 800;
    this.truckRpm = 900;
    this.lastRopeFlutter = 0;
  }

  /** must be called from a user gesture */
  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(ctx.destination);

    // noise sources
    const len = ctx.sampleRate * 2;
    const white = ctx.createBuffer(1, len, ctx.sampleRate);
    const wd = white.getChannelData(0);
    for (let i = 0; i < len; i++) wd[i] = Math.random() * 2 - 1;
    const brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const bd = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * wd[i]) / 1.02;
      bd[i] = last * 3.5;
    }
    this.whiteBuf = white;
    this.brownBuf = brown;
    const noiseSrc = (buf) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start();
      return s;
    };

    // ---- player engine
    this.eng = this._buildEngine(1.0);
    this.eng.out.connect(this.master);
    // intake / mechanical hiss
    this.hiss = ctx.createGain();
    this.hiss.gain.value = 0;
    const hissF = ctx.createBiquadFilter();
    hissF.type = 'bandpass';
    hissF.frequency.value = 2600;
    hissF.Q.value = 0.6;
    noiseSrc(white).connect(hissF).connect(this.hiss).connect(this.master);
    // turbo whistle
    this.turbo = ctx.createOscillator();
    this.turbo.type = 'sine';
    this.turbo.frequency.value = 3000;
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turbo.connect(this.turboGain).connect(this.master);
    this.turbo.start();

    // ---- tyre noise: mud squelch, road/gravel scrub
    this.mudGain = ctx.createGain();
    this.mudGain.gain.value = 0;
    const mudF = ctx.createBiquadFilter();
    mudF.type = 'lowpass';
    mudF.frequency.value = 520;
    noiseSrc(brown).connect(mudF).connect(this.mudGain).connect(this.master);
    this.mudSplash = ctx.createGain();
    this.mudSplash.gain.value = 0;
    const splF = ctx.createBiquadFilter();
    splF.type = 'bandpass';
    splF.frequency.value = 1100;
    splF.Q.value = 1.2;
    noiseSrc(white).connect(splF).connect(this.mudSplash).connect(this.master);
    this.roadGain = ctx.createGain();
    this.roadGain.gain.value = 0;
    this.roadF = ctx.createBiquadFilter();
    this.roadF.type = 'bandpass';
    this.roadF.frequency.value = 1700;
    this.roadF.Q.value = 2.5;
    noiseSrc(white).connect(this.roadF).connect(this.roadGain).connect(this.master);

    // ---- rope creak
    this.creakGain = ctx.createGain();
    this.creakGain.gain.value = 0;
    this.creakF = ctx.createBiquadFilter();
    this.creakF.type = 'bandpass';
    this.creakF.frequency.value = 420;
    this.creakF.Q.value = 9;
    noiseSrc(white).connect(this.creakF).connect(this.creakGain).connect(this.master);

    // ---- helper truck (kei truck engine, a bit lazier than the N-BOX)
    this.truckEng = this._buildEngine(0.8);
    this.truckEng.out.connect(this.master);
    this.truckEng.out.gain.value = 0;
  }

  _buildEngine(pitchScale) {
    const ctx = this.ctx;
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    const sq = ctx.createOscillator();
    sq.type = 'square';
    const sub = ctx.createOscillator();
    sub.type = 'triangle';
    const sawG = ctx.createGain();
    sawG.gain.value = 0.5;
    const sqG = ctx.createGain();
    sqG.gain.value = 0.22;
    const subG = ctx.createGain();
    subG.gain.value = 0.35;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(2.2 * x);
    }
    shaper.curve = curve;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    lp.Q.value = 1.4;
    const out = ctx.createGain();
    out.gain.value = 0;
    saw.connect(sawG).connect(shaper);
    sq.connect(sqG).connect(shaper);
    sub.connect(subG).connect(shaper);
    shaper.connect(lp).connect(out);
    // uneven 3-cyl idle: slow amplitude wobble
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.3;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.08;
    lfo.connect(lfoG).connect(out.gain);
    saw.start();
    sq.start();
    sub.start();
    lfo.start();
    return { saw, sq, sub, lp, out, pitchScale };
  }

  _setEngine(e, rpm, load, level) {
    const t = this.ctx.currentTime;
    const f = (rpm / 60) * 1.5 * e.pitchScale; // firing frequency
    e.saw.frequency.setTargetAtTime(f, t, 0.03);
    e.sq.frequency.setTargetAtTime(f * 2, t, 0.03);
    e.sub.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    e.lp.frequency.setTargetAtTime(260 + rpm * 0.55 + load * 900, t, 0.05);
    e.out.gain.setTargetAtTime(level, t, 0.06);
  }

  /** per-frame update. h = sim.getHud(), extra = {truckDist, truckPulling, truckStalled} */
  update(h, dt, extra) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const thr = Math.abs(h.thr);
    const spd = Math.abs(h.speed) / 3.6; // m/s
    const spinning = h.wheels.filter((w) => w.spinning);
    const nSpin = spinning.length;

    // CVT: revs follow throttle quickly, speed adds a little; spinning wheels let revs flare
    let target = 780 + thr * 3300 + clamp(spd / 15, 0, 1) * 1600 + (nSpin ? 1100 * thr : 0);
    if (h.vsaCut) target = 780 + thr * 1200; // traction control chokes the engine
    const k = target > this.rpm ? 5 : 2.5;
    this.rpm += (target - this.rpm) * Math.min(1, dt * k);
    this.rpm += (Math.random() - 0.5) * 14; // idle jitter
    const load = clamp(thr * (1 - clamp(spd / 12, 0, 0.6)), 0, 1);
    this._setEngine(this.eng, this.rpm, load, this.muted ? 0 : 0.16 + thr * 0.1);
    this.hiss.gain.setTargetAtTime(this.muted ? 0 : thr * 0.012 * (this.rpm / 3000), t, 0.1);
    this.turbo.frequency.setTargetAtTime(2400 + this.rpm * 0.9, t, 0.08);
    this.turboGain.gain.setTargetAtTime(this.muted ? 0 : clamp((this.rpm - 2300) / 2500, 0, 1) * thr * 0.012, t, 0.12);

    // tyres
    const mudSpin = spinning.filter((w) => w.surface === 'mud').length;
    const hardSpin = nSpin - mudSpin;
    const wob = 0.65 + 0.35 * Math.sin(performance.now() * 0.021);
    const mudRoll = h.wheels.filter((w) => w.surface === 'mud').length ? spd * 0.03 : 0;
    this.mudGain.gain.setTargetAtTime(this.muted ? 0 : (mudSpin * 0.2 * thr + mudRoll) * wob, t, 0.05);
    this.mudSplash.gain.setTargetAtTime(this.muted ? 0 : mudSpin * 0.06 * thr * (0.4 + Math.random() * 0.6), t, 0.03);
    const hardRoll = h.wheels.filter((w) => w.surface !== 'mud' && w.surface !== 'air').length ? spd * 0.012 : 0;
    this.roadF.frequency.setTargetAtTime(1300 + spd * 90 + hardSpin * 400, t, 0.1);
    this.roadGain.gain.setTargetAtTime(this.muted ? 0 : hardSpin * 0.07 * thr + hardRoll, t, 0.06);

    // rope
    const T = h.rope ? h.rope.tension : 0;
    let creak = 0;
    if (T > 150) {
      creak = clamp(T / 5500, 0, 1) * 0.16;
      if (performance.now() - this.lastRopeFlutter > 90) {
        this.lastRopeFlutter = performance.now();
        this.creakF.frequency.setTargetAtTime(330 + T * 0.12 + Math.random() * 160, t, 0.02);
      }
    }
    this.creakGain.gain.setTargetAtTime(this.muted ? 0 : creak, t, 0.05);

    // truck: audible only while roped; louder when pulling, flares when stalled
    const roped = !!h.rope;
    const pulling = roped && extra.truckPulling;
    const targetTruck = roped ? (pulling ? (extra.truckStalled ? 3000 : 1900) : 900) : 900;
    this.truckRpm += (targetTruck - this.truckRpm) * Math.min(1, dt * 2.5);
    const dist = clamp(extra.truckDist ?? 8, 2, 40);
    const near = 1 / (1 + dist * 0.18);
    this._setEngine(this.truckEng, this.truckRpm, pulling ? 0.7 : 0.1, this.muted || !roped ? 0 : 0.12 * near * 2.2);
  }

  // ---------------------------------------------------------------- one shots
  _burst({ type = 'lowpass', freq = 800, q = 1, dur = 0.15, gain = 0.5, sweepTo = null, buf = 'white', attack = 0.003 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf === 'brown' ? this.brownBuf : this.whiteBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    const t = ctx.currentTime;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  _tone({ type = 'sine', from = 200, to = 60, dur = 0.2, gain = 0.5, delay = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** ev: { type, data } from sim.events */
  play(ev) {
    if (!this.ctx || this.muted) return;
    switch (ev.type) {
      case 'place': // board / mat dropped on the ground
        this._burst({ type: 'lowpass', freq: 900, dur: 0.14, gain: ev.data?.kind === 'helper' ? 0.55 : 0.3, buf: 'brown' });
        this._tone({ from: ev.data?.kind === 'helper' ? 170 : 120, to: 55, dur: 0.16, gain: 0.35 });
        if (ev.data?.kind === 'helper') this._burst({ type: 'bandpass', freq: 2400, q: 3, dur: 0.05, gain: 0.15 });
        break;
      case 'recover':
        this._burst({ type: 'bandpass', freq: 1500, q: 1.5, dur: 0.18, gain: 0.25 });
        break;
      case 'jackSet':
        this._tone({ type: 'square', from: 180, to: 90, dur: 0.08, gain: 0.18 });
        this._burst({ type: 'highpass', freq: 3000, dur: 0.04, gain: 0.3 });
        this._tone({ from: 120, to: 50, dur: 0.18, gain: 0.3, delay: 0.05 });
        break;
      case 'jackOff':
        this._burst({ type: 'bandpass', freq: 700, q: 2, dur: 0.35, gain: 0.25, sweepTo: 300 });
        if (ev.data?.lifted) this._tone({ from: 90, to: 35, dur: 0.4, gain: 0.5 });
        break;
      case 'jackCollapse':
        this._burst({ type: 'lowpass', freq: 3000, sweepTo: 200, dur: 0.6, gain: 0.9, buf: 'brown' });
        this._burst({ type: 'bandpass', freq: 2200, q: 1, dur: 0.15, gain: 0.5 });
        this._tone({ from: 110, to: 30, dur: 0.5, gain: 0.8 });
        break;
      case 'ropeTie':
        this._burst({ type: 'bandpass', freq: 900, q: 4, dur: 0.12, gain: 0.3 });
        this._tone({ type: 'triangle', from: 300, to: 180, dur: 0.1, gain: 0.15 });
        break;
      case 'ropeSnap':
        this._burst({ type: 'highpass', freq: 1800, dur: 0.12, gain: 0.9, attack: 0.001 });
        this._tone({ type: 'sawtooth', from: 2400, to: 200, dur: 0.18, gain: 0.35 });
        this._burst({ type: 'lowpass', freq: 600, dur: 0.3, gain: 0.4, buf: 'brown', sweepTo: 150 });
        break;
      case 'sideBrake': // ratchet lever / electric parking brake actuator
        for (let i = 0; i < (ev.data?.on ? 5 : 2); i++) {
          this._burst({ type: 'highpass', freq: 2600, dur: 0.025, gain: 0.2, attack: 0.001 });
          this._tone({ type: 'square', from: 380, to: 260, dur: 0.02, gain: 0.04, delay: i * 0.06 });
        }
        this._tone({ type: 'sawtooth', from: ev.data?.on ? 140 : 100, to: ev.data?.on ? 90 : 160, dur: 0.35, gain: 0.07, delay: 0.1 });
        break;
      case 'vsa':
        this._tone({ type: 'square', from: 1040, to: 1040, dur: 0.07, gain: 0.08 });
        this._tone({ type: 'square', from: 1040, to: 1040, dur: 0.07, gain: 0.08, delay: 0.11 });
        break;
      case 'win':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
          this._tone({ type: 'triangle', from: f, to: f, dur: 0.5, gain: 0.18, delay: i * 0.11 }));
        break;
      case 'flip':
        this._burst({ type: 'lowpass', freq: 2500, sweepTo: 150, dur: 0.9, gain: 0.9, buf: 'brown' });
        this._tone({ from: 90, to: 30, dur: 0.7, gain: 0.7 });
        break;
      default:
    }
  }

  /** ratchet click for the bottle jack */
  ratchet() {
    if (!this.ctx || this.muted) return;
    this._burst({ type: 'highpass', freq: 2800, dur: 0.03, gain: 0.22, attack: 0.001 });
    this._tone({ type: 'square', from: 420, to: 300, dur: 0.025, gain: 0.05 });
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.muted && this.ctx) {
      this.eng.out.gain.value = 0;
      this.truckEng.out.gain.value = 0;
    }
    return this.muted;
  }
}
