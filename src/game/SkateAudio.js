// Original synthesized skate sounds: no downloads or third-party samples.
import { readAudioVolume, saveAudioVolume } from './AudioSettings.js';
import { createSkateImpact } from './SkateSoundSynthesis.js';
export class SkateAudio {
  constructor() {
    this.enabled = true;
    try { this.enabled = localStorage.getItem('streetskate.sound') !== 'off'; } catch {}
    this.previous = null;
    this.baseGain = 0.85;
    this.effectsVolume = readAudioVolume('effects');
    this.masterVolume = this.effectsVolume;
    this.lastImpactTime = -Infinity;
    this.lastImpacts = new Map();
    this.voices = new Set();
    this.disposed = false;
  }

  async unlock() {
    if (!this.enabled || this.disposed) return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    if (!this.context) {
      const c = this.context = new Audio();
      this.master = c.createGain(); this.master.gain.value = this.baseGain*this.effectsVolume;
      // Tame overlapping truck hits while preserving the initial pop attack.
      this.compressor = c.createDynamicsCompressor();
      this.compressor.threshold.value = -12;
      this.compressor.knee.value = 10; this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.004; this.compressor.release.value = 0.12;
      this.master.connect(this.compressor); this.compressor.connect(c.destination);
      this.buffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const samples = this.buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      this.roll = this.loop('lowpass', 450);
      this.texture = this.loop('bandpass', 1600);
      this.grind = this.loop('bandpass', 2100);
      this.brake = this.loop('highpass', 1400);
      this.wind = this.loop('lowpass', 700);
      this.impacts = Object.fromEntries(['pop','landing','grind','bail','catch','push']
        .map(kind => [kind, createSkateImpact(c, kind)]));
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
    if (!this.context || !this.enabled || this.disposed || this.context.state !== 'running') return;
    const c = this.context, now = c.currentTime;
    kind = metal ? 'grind' : kind;
    // Keep different events audible when a catch and landing share a frame.
    if (now - (this.lastImpacts.get(kind) ?? -Infinity) < 0.075) return;
    this.lastImpacts.set(kind, now);
    this.lastImpactTime = now;
    const power = Math.max(0.001,Math.min(1,Number(strength) || 0));
    const pop = kind === 'pop', length = this.impacts?.[kind]?.duration || (pop ? 0.11 : metal ? 0.25 : 0.24);
    const source = c.createBufferSource();
    const filter = c.createBiquadFilter(), gain = c.createGain();
    source.buffer = this.impacts?.[kind] || this.buffer;
    filter.type = metal ? 'bandpass' : 'lowpass';
    filter.frequency.value = pop ? 6500 : metal ? 2800 : kind === 'push' ? 1500 : 4200;
    if(filter.Q)filter.Q.value = metal ? 2.1 : 0.72;
    // Attack envelope avoids digital clicks; the high-frequency pop gives
    // takeoff snap, low-band impact gives board-and-wheel landing weight.
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001,power),now+0.003);
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
    if (!this.enabled || this.disposed || !this.context || this.context.state !== 'running') return;
    const context = this.context, now = context.currentTime;
    // Short synthesized arcade cues: one per crossed threshold, honoring
    // the existing sound toggle and master-volume gain. No audio asset needed.
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = seconds === 5 ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(seconds === 5 ? 880 : 660, now);
    oscillator.frequency.exponentialRampToValueAtTime(seconds === 5 ? 1040 : 760, now + 0.14);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    oscillator.connect(gain);
    gain.connect(this.master);
    this.voices.add(oscillator);
    oscillator.start(now);
    oscillator.stop(now + 0.22);
    oscillator.onended = () => { this.voices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
  }

  update(player, active) {
    if (!player) return;
    const rawSpeed = Number(player.velocity?.length?.() || 0);
    const speed = Number.isFinite(rawSpeed) ? Math.max(0,rawSpeed) : 0;
    const p = player.presentation || {};
    const state = { grounded: Boolean(player.grounded), grind: Boolean(player.grind), bail: player.bailTime > 0,
      speed, pop: p.popTime > 0, flipPhase: p.flipPhase, pushPhase: p.pushPhase || 0,
      pushWeight: p.pushWeight || 0, respawn: player.respawnSerial,
      impactSpeed: Math.max(0, -(player.velocity?.dot?.(player.normal) || 0)) };
    if (this.context) {
      const now = this.context.currentTime, audible = this.enabled && active && this.context.state === 'running';
      const level = Math.min(1, speed / 18);
      const rolling = audible && state.grounded && !state.grind && !state.bail;
      const grinding = audible && state.grind && !state.bail;
      const rollLevel = Math.pow(level, 0.65);
      this.roll.gain.gain.setTargetAtTime(rolling ? rollLevel * 0.48 : 0, now, 0.035);
      this.roll.filter.frequency.setTargetAtTime(Math.min(2200,550 + speed * 70), now, 0.06);
      this.roll.source?.playbackRate?.setTargetAtTime(0.7 + level * 1.8, now, 0.06);
      this.texture?.gain.gain.setTargetAtTime(rolling ? rollLevel * 0.15 : 0, now, 0.035);
      this.grind.gain.gain.setTargetAtTime(grinding ? 0.18 + level * 0.2 : 0, now, 0.025);
      this.grind.filter.frequency.setTargetAtTime(Math.min(3900,1650 + speed * 83), now, 0.07);
      this.wind.gain.gain.setTargetAtTime(audible && !state.grounded && !state.grind && !state.bail ? level * 0.05 : 0, now, 0.1);
      this.brake?.gain.gain.setTargetAtTime(rolling && p.state === 'BRAKE' ? level * 0.2 : 0, now, 0.04);
      if (audible && this.previous && state.respawn === this.previous.respawn) {
        if (state.bail && !this.previous.bail) this.impact(0.85, false, 'bail');
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
    this.compressor?.disconnect();
    const context = this.context;
    this.context = null;
    this.previous = null;
    if (context?.state !== 'closed') await context?.close?.().catch(() => {});
  }
}
