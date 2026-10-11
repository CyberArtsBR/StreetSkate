// Original synthesized skate sounds: no downloads or third-party samples.
export class SkateAudio {
  constructor() {
    this.enabled = true;
    try { this.enabled = localStorage.getItem('streetskate.sound') !== 'off'; } catch {}
    this.previous = null;
    this.baseGain = 0.34;
    this.masterVolume = 0.5;
    this.lastImpactTime = -Infinity;
    this.disposed = false;
  }

  async unlock() {
    if (!this.enabled || this.disposed) return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    if (!this.context) {
      const c = this.context = new Audio();
      this.master = c.createGain(); this.master.gain.value = this.baseGain*this.masterVolume; this.master.connect(c.destination);
      this.buffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const samples = this.buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      this.roll = this.loop('lowpass', 450);
      this.grind = this.loop('bandpass', 2100);
      this.wind = this.loop('lowpass', 700);
      // Soft resonant steel vibration and damped, street-surface wheel noise.
      this.grind.filter.Q.value = 1.65;
      this.roll.filter.Q.value = 0.55;
    }
    if (this.context.state === 'suspended') await this.context.resume().catch(() => {});
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
    // Suppress duplicate transitions in one frame while keeping separate hits.
    if (now - this.lastImpactTime < 0.075) return;
    this.lastImpactTime = now;
    const power = Math.max(0.001,Math.min(1,Number(strength) || 0));
    const pop = kind === 'pop', length = pop ? 0.075 : metal ? 0.19 : 0.15;
    const source = c.createBufferSource();
    const filter = c.createBiquadFilter(), gain = c.createGain();
    source.buffer = this.buffer;
    filter.type = pop ? 'highpass' : metal ? 'bandpass' : 'lowpass';
    filter.frequency.value = pop ? 1150 : metal ? 2450 : 540;
    if(filter.Q)filter.Q.value = metal ? 2.1 : 0.72;
    // Attack envelope avoids digital clicks; the high-frequency pop gives
    // takeoff snap, low-band impact gives board-and-wheel landing weight.
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001,power*(pop ? 0.32 : metal ? 0.48 : 0.62)),now+0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now+length);
    source.connect(filter); filter.connect(gain); gain.connect(this.master);
    source.start(now); source.stop(now+length+0.01);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };

    // A short low-frequency pitch fall gives heavier landings substance without
    // shipping samples. Guard for lightweight test/audio shims.
    if(!metal && !pop && typeof c.createOscillator === 'function'){
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
    oscillator.start(now);
    oscillator.stop(now + 0.22);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }

  update(player, active) {
    if (!player) return;
    const rawSpeed = Number(player.velocity?.length?.() || 0);
    const speed = Number.isFinite(rawSpeed) ? Math.max(0,rawSpeed) : 0;
    const state = { grounded: Boolean(player.grounded), grind: Boolean(player.grind), bail: player.bailTime > 0, speed };
    if (this.context) {
      const now = this.context.currentTime, audible = this.enabled && active;
      const level = Math.min(1, speed / 18);
      const rolling = audible && state.grounded && !state.grind && !state.bail;
      const grinding = audible && state.grind && !state.bail;
      this.roll.gain.gain.setTargetAtTime(rolling ? level * 0.19 : 0, now, 0.06);
      this.roll.filter.frequency.setTargetAtTime(Math.min(1300,220 + speed * 43), now, 0.08);
      this.grind.gain.gain.setTargetAtTime(grinding ? 0.09 + level * 0.13 : 0, now, 0.035);
      this.grind.filter.frequency.setTargetAtTime(Math.min(3900,1650 + speed * 83), now, 0.07);
      this.wind.gain.gain.setTargetAtTime(audible && !state.grounded && !state.grind && !state.bail ? level * 0.05 : 0, now, 0.1);
      if (audible && this.previous) {
        if (!state.grounded && this.previous.grounded && !state.grind) this.impact(0.26,false,'pop');
        if (state.grounded && !this.previous.grounded) this.impact(0.35 + Math.min(0.45, Math.max(0,player.presentation?.landingSeverity || 0) * 0.45));
        if (state.grind && !this.previous.grind) this.impact(0.52, true);
        if (state.bail && !this.previous.bail) this.impact(0.72);
      }
    }
    this.previous = active ? state : null;
  }

  silence() {
    if (!this.context) return;
    for (const layer of [this.roll, this.grind, this.wind]) layer.gain.gain.setTargetAtTime(0, this.context.currentTime, 0.02);
    this.previous = null;
  }

  setMasterVolume(value) {
    this.masterVolume = Math.max(0,Math.min(1,Number(value)||0));
    if (this.context && this.master) this.master.gain.setTargetAtTime(
      this.baseGain*this.masterVolume,this.context.currentTime,0.045);
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
    for (const layer of [this.roll, this.grind, this.wind]) {
      if (!layer) continue;
      try { layer.source.stop(); } catch {}
      layer.source.disconnect();
      layer.filter.disconnect();
      layer.gain.disconnect();
    }
    this.master?.disconnect();
    const context = this.context;
    this.context = null;
    this.previous = null;
    if (context?.state !== 'closed') await context?.close?.().catch(() => {});
  }
}
