// Real CC0 skateboard recordings with a synthesized fallback when unavailable.
import { readAudioVolume, saveAudioVolume, readBackgroundAudio, saveBackgroundAudio } from './AudioSettings.js';
import { createSkateImpact } from './SkateSoundSynthesis.js';
import { surfaceAudioFor } from './SurfaceAudio.js';
import { loadSkateFoley } from './SkateFoley.js';
export class SkateAudio {
  constructor() {
    this.enabled = true;
    try { this.enabled = localStorage.getItem('streetskate.sound') !== 'off'; } catch {}
    this.previous = null;
    this.baseGain = 0.85;
    this.effectsVolume = readAudioVolume('effects');
    this.announcerVolume = readAudioVolume('announcer');
    this.backgroundAudio = readBackgroundAudio();
    this.masterVolume = this.effectsVolume;
    this.lastImpactTime = -Infinity;
    this.lastImpacts = new Map();
    this.voices = new Set();
    this.disposed = false;
    this.lastBailImpact = null;
    this.recordedFoley = new Set();
    this._visibility = () => { if (this.isBackgroundMuted()) this.silence(); };
    globalThis.document?.addEventListener?.('visibilitychange', this._visibility);
  }

  isBackgroundMuted() { return !this.backgroundAudio && Boolean(globalThis.document?.hidden); }

  async unlock() {
    if (!this.enabled || this.disposed) return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    if (!this.context) {
      const c = this.context = new Audio();
      this.master = c.createGain(); this.master.gain.value = this.baseGain*this.effectsVolume;
      this.announcer = c.createGain(); this.announcer.gain.value = this.baseGain*this.announcerVolume;
      // Tame overlapping truck hits while preserving the initial pop attack.
      this.compressor = c.createDynamicsCompressor();
      this.compressor.threshold.value = -12;
      this.compressor.knee.value = 10; this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.004; this.compressor.release.value = 0.12;
      this.master.connect(this.compressor); this.compressor.connect(c.destination);
      this.announcer.connect(this.compressor);
      this.buffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const samples = this.buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      this.roll = this.loop('lowpass', 450);
      this.texture = this.loop('bandpass', 1600);
      this.grind = this.loop('bandpass', 2100);
      this.brake = this.loop('highpass', 1400);
      this.wind = this.loop('lowpass', 700);
      this.impacts = Object.fromEntries(['pop','landing','grind','bail','loss','catch','push']
        .map(kind => [kind, createSkateImpact(c, kind)]));
      // Decode in the background without blocking controls or the first frame.
      // Each clip replaces its fallback independently when it is ready.
      this.foleyLoad = loadSkateFoley(c, (kind, buffer) => {
        if (this.disposed || this.context !== c) return;
        if (kind === 'roll') {
          const previous = this.roll.source, source = c.createBufferSource();
          source.buffer = buffer; source.loop = true; source.connect(this.roll.filter);
          source.playbackRate.value = previous.playbackRate?.value || 1;
          source.start(); this.roll.source = source;
          try { previous.stop(); previous.disconnect(); } catch {}
        } else {
          this.impacts[kind] = buffer;
          if (kind === 'landing') this.impacts.catch = buffer;
        }
        this.recordedFoley.add(kind);
      });
      // Soft resonant steel vibration and damped, street-surface wheel noise.
      this.grind.filter.Q.value = 1.65;
      this.roll.filter.Q.value = 0.55;
      this.texture.filter.Q.value = 0.7;
    }
    if (this.context.state === 'suspended' || this.context.state === 'interrupted')
      await this.context.resume().catch(() => {});
  }

  loop(type, frequency) {
    const c = this.context, source = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain();
    source.buffer = this.buffer; source.loop = true; filter.type = type; filter.frequency.value = frequency;
    gain.gain.value = 0; source.connect(filter); filter.connect(gain); gain.connect(this.master); source.start();
    return { source, filter, gain };
  }

  impact(strength = 0.5, metal = false, kind = 'landing') {
    if (!this.context || !this.enabled || this.disposed || this.isBackgroundMuted() || this.context.state !== 'running') return;
    const c = this.context, now = c.currentTime;
    kind = metal ? 'grind' : kind;
    // Keep different events audible when a catch and landing share a frame.
    if (now - (this.lastImpacts.get(kind) ?? -Infinity) < 0.075) return;
    this.lastImpacts.set(kind, now);
    this.lastImpactTime = now;
    const power = Math.max(0.001,Math.min(1,Number(strength) || 0));
    const recorded = this.recordedFoley.has(kind === 'catch' ? 'landing' : kind);
    const pop = kind === 'pop', duration = this.impacts?.[kind]?.duration || (pop ? 0.11 : metal ? 0.25 : 0.24);
    // The catch is a softer contact during flight, not another full landing.
    const length = recorded && kind === 'catch' ? Math.min(.12,duration) : duration;
    const source = c.createBufferSource();
    const filter = c.createBiquadFilter(), gain = c.createGain();
    source.buffer = this.impacts?.[kind] || this.buffer;
    filter.type = metal ? 'bandpass' : 'lowpass';
    filter.frequency.value = recorded ? 10000 : pop ? 6500 : metal ? 2800 : kind === 'push' ? 1500 : 4200;
    if(filter.Q)filter.Q.value = metal ? 2.1 : 0.72;
    // Attack envelope avoids digital clicks; the high-frequency pop gives
    // takeoff snap, low-band impact gives board-and-wheel landing weight.
    gain.gain.setValueAtTime(0.001, now);
    const volume=power*(recorded&&kind==='catch'?.38:1);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001,volume),now+0.003);
    if(recorded && typeof gain.gain.setValueAtTime === 'function')
      gain.gain.setValueAtTime(Math.max(0.001,volume),now+Math.max(.004,length-.018));
    gain.gain.exponentialRampToValueAtTime(0.001, now+length);
    source.connect(filter); filter.connect(gain); gain.connect(this.master);
    this.voices.add(source);
    source.start(now); source.stop(now+length+0.01);
    source.onended = () => { this.voices.delete(source); source.disconnect(); filter.disconnect(); gain.disconnect(); };

    // A short low-frequency pitch fall gives heavier landings substance without
    // shipping samples. Guard for lightweight test/audio shims.
    if(kind === 'landing' && !this.impacts && typeof c.createOscillator === 'function'){
      const tone=c.createOscillator(), toneGain=c.createGain();
      const pitch=85+power*42;
      tone.type='triangle';
      tone.frequency.setValueAtTime(pitch,now);
      tone.frequency.exponentialRampToValueAtTime(Math.max(42,pitch*.58),now+0.11);
      toneGain.gain.setValueAtTime(0.001,now);
      toneGain.gain.exponentialRampToValueAtTime(Math.max(0.001,power*.11),now+0.01);
      toneGain.gain.exponentialRampToValueAtTime(0.001,now+0.13);
      tone.connect(toneGain);toneGain.connect(this.master);
      tone.start(now);tone.stop(now+0.14);
      tone.onended=()=>{tone.disconnect();toneGain.disconnect();};
    }
  }

  countdownCue(seconds) {
    this.cue(seconds === 5 ? 'finalFive' : 'tenSeconds');
  }

  cue(kind) {
    if (!this.enabled || this.disposed || this.isBackgroundMuted() || !this.context || this.context.state !== 'running') return;
    const cues = {
      confirm: [580, 760, .085, .08], back: [520, 390, .085, .065],
      ready: [330, 390, .16, .10], go: [660, 990, .19, .15],
      roundOver: [520, 260, .32, .13], tenSeconds: [660, 760, .2, .18],
      finalFive: [880, 1040, .2, .18],
    };
    const spec = cues[kind];
    if (!spec) return;
    const context = this.context, now = context.currentTime;
    if (now - (this.lastImpacts.get(`cue:${kind}`) ?? -Infinity) < .07) return;
    this.lastImpacts.set(`cue:${kind}`, now);
    const [from, to, duration, level] = spec;
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = kind === 'finalFive' ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(to, now + duration * .7);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + .012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(kind === 'confirm' || kind === 'back' ? this.master : (this.announcer || this.master));
    this.voices.add(oscillator);
    oscillator.start(now);
    oscillator.stop(now + duration + .02);
    oscillator.onended = () => { this.voices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
  }

  update(player, active) {
    if (!player) return;
    const rawSpeed = Number(player.velocity?.length?.() || 0);
    const speed = Number.isFinite(rawSpeed) ? Math.max(0,rawSpeed) : 0;
    const p = player.presentation || {};
    const impact = player.rider?.ragdoll?.groundImpact || null;
    const surface = surfaceAudioFor(player);
    const state = { grounded: Boolean(player.grounded), grind: Boolean(player.grind), bail: player.bailTime > 0,
      speed, pop: p.popTime > 0, flipPhase: p.flipPhase, pushPhase: p.pushPhase || 0,
      pushWeight: p.pushWeight || 0, respawn: player.respawnSerial,
      impactSpeed: Math.max(0, -(player.velocity?.dot?.(player.normal) || 0)) };
    if (this.context) {
      const now = this.context.currentTime, audible = this.enabled && active && !this.isBackgroundMuted() && this.context.state === 'running';
      const level = Math.min(1, speed / 18);
      const rolling = audible && state.grounded && !state.grind && !state.bail;
      const grinding = audible && state.grind && !state.bail;
      const rollLevel = Math.pow(level, 0.65);
      this.roll.gain.gain.setTargetAtTime(rolling ? rollLevel * 0.48 * surface.roll : 0, now, 0.035);
      this.roll.filter.frequency.setTargetAtTime(Math.min(3000,(550 + speed * 70) * surface.rollPitch), now, 0.06);
      this.roll.source?.playbackRate?.setTargetAtTime(0.7 + level * 1.8, now, 0.06);
      this.texture?.gain.gain.setTargetAtTime(rolling ? rollLevel * 0.15 * surface.texture : 0, now, 0.035);
      this.texture?.filter.frequency.setTargetAtTime(1600 * surface.rollPitch, now, .06);
      this.grind.gain.gain.setTargetAtTime(grinding ? 0.18 + level * 0.2 : 0, now, 0.025);
      this.grind.filter.frequency.setTargetAtTime(Math.min(4400,(1650 + speed * 83) * surface.scrapePitch), now, 0.07);
      this.grind.filter.Q?.setTargetAtTime?.(surface.resonance, now, .07);
      this.wind.gain.gain.setTargetAtTime(audible && !state.grounded && !state.grind && !state.bail ? level * 0.05 : 0, now, 0.1);
      this.brake?.gain.gain.setTargetAtTime(rolling && p.state === 'BRAKE' ? level * 0.2 : 0, now, 0.04);
      if (audible && this.previous && state.respawn === this.previous.respawn) {
        if (state.bail && !this.previous.bail) this.impact(0.32, false, 'loss');
        if (state.bail && impact && impact !== this.lastBailImpact)
          this.impact(.45 + Math.min(.5, (Number(impact.speed) || 4) / 14), false, 'bail');
        if (!state.bail) {
          if (state.pop && !this.previous.pop && !state.grounded && !state.grind) this.impact(0.9, false, 'pop');
          if (state.grounded && !this.previous.grounded && !state.grind) {
            const severity = Math.max(p.landingSeverity || 0, Math.min(1, this.previous.impactSpeed / 10));
            this.impact(0.5 + Math.min(0.45, severity * 0.45));
          }
          if (state.grind && !this.previous.grind) this.impact(0.65, true);
          if (state.flipPhase === 'CATCH' && this.previous.flipPhase !== 'CATCH') this.impact(0.32, false, 'catch');
          if (rolling && state.pushWeight > 0.4 && state.pushPhase >= 0.26
            && (this.previous.pushPhase < 0.26 || state.pushPhase < this.previous.pushPhase)) this.impact(0.22, false, 'push');
        }
      }
    }
    // Consume contacts while paused/muted too. Unmuting must never replay an
    // old impact, and returning from a highlight must not invent a second hit.
    this.lastBailImpact = impact;
    this.previous = active ? state : null;
  }

  silence() {
    this.previous = null;
    if (!this.context) return;
    for (const layer of [this.roll, this.texture, this.grind, this.brake, this.wind])
      layer?.gain.gain.setTargetAtTime(0, this.context.currentTime, 0.02);
    for (const voice of this.voices) { try { voice.stop(); } catch {} }
  }

  setMasterVolume(value) {
    this.setEffectsVolume(value);
  }

  setEffectsVolume(value) {
    this.effectsVolume = saveAudioVolume('effects', value);
    this.masterVolume = this.effectsVolume;
    if (this.context && this.master) this.master.gain.setTargetAtTime(
      this.baseGain*this.effectsVolume,this.context.currentTime,0.045);
  }

  setAnnouncerVolume(value) {
    this.announcerVolume = saveAudioVolume('announcer', value);
    if (this.context && this.announcer) this.announcer.gain.setTargetAtTime(
      this.baseGain*this.announcerVolume, this.context.currentTime, .045);
  }

  setBackgroundAudio(value) {
    this.backgroundAudio = saveBackgroundAudio(value);
    if (this.isBackgroundMuted()) this.silence();
  }

  toggle() {
    if (this.disposed) return this.enabled;
    this.enabled = !this.enabled;
    try { localStorage.setItem('streetskate.sound', this.enabled ? 'on' : 'off'); } catch {}
    if (!this.enabled) this.silence(); else this.unlock();
    return this.enabled;
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    this.silence();
    for (const layer of [this.roll, this.texture, this.grind, this.brake, this.wind]) {
      if (!layer) continue;
      try { layer.source.stop(); } catch {}
      layer.source.disconnect();
      layer.filter.disconnect();
      layer.gain.disconnect();
    }
    this.master?.disconnect();
    this.announcer?.disconnect();
    this.compressor?.disconnect();
    globalThis.document?.removeEventListener?.('visibilitychange', this._visibility);
    const context = this.context;
    this.context = null;
    this.previous = null;
    if (context?.state !== 'closed') await context?.close?.().catch(() => {});
  }
}
