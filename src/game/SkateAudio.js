// Original synthesized skate sounds: no downloads or third-party samples.
export class SkateAudio {
  constructor() {
    this.enabled = true;
    try { this.enabled = localStorage.getItem('streetskate.sound') !== 'off'; } catch {}
    this.previous = null;
    this.baseGain = 0.34;
    this.masterVolume = 0.5;
  }

  async unlock() {
    if (!this.enabled) return;
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
    }
    if (this.context.state === 'suspended') await this.context.resume().catch(() => {});
  }

  loop(type, frequency) {
    const c = this.context, source = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain();
    source.buffer = this.buffer; source.loop = true; filter.type = type; filter.frequency.value = frequency;
    gain.gain.value = 0; source.connect(filter); filter.connect(gain); gain.connect(this.master); source.start();
    return { source, filter, gain };
  }

  impact(strength = 0.5, metal = false) {
    if (!this.context || !this.enabled) return;
    const c = this.context, now = c.currentTime, source = c.createBufferSource();
    const filter = c.createBiquadFilter(), gain = c.createGain();
    source.buffer = this.buffer; filter.type = 'bandpass'; filter.frequency.value = metal ? 2800 : 620;
    gain.gain.setValueAtTime(Math.max(0.001, strength), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (metal ? 0.15 : 0.09));
    source.connect(filter); filter.connect(gain); gain.connect(this.master); source.start(); source.stop(now + 0.18);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }

  update(player, active) {
    if (!player) return;
    const speed = player.velocity.length();
    const state = { grounded: player.grounded, grind: Boolean(player.grind), bail: player.bailTime > 0, speed };
    if (this.context) {
      const now = this.context.currentTime, audible = this.enabled && active;
      const level = Math.min(1, speed / 18);
      this.roll.gain.gain.setTargetAtTime(audible && state.grounded ? level * 0.18 : 0, now, 0.06);
      this.roll.filter.frequency.setTargetAtTime(240 + speed * 45, now, 0.08);
      this.grind.gain.gain.setTargetAtTime(audible && state.grind ? 0.11 + level * 0.09 : 0, now, 0.035);
      this.grind.filter.frequency.setTargetAtTime(1400 + speed * 80, now, 0.07);
      this.wind.gain.gain.setTargetAtTime(audible && !state.grounded && !state.grind ? level * 0.045 : 0, now, 0.1);
      if (audible && this.previous) {
        if (!state.grounded && this.previous.grounded && !state.grind) this.impact(0.48);
        if (state.grounded && !this.previous.grounded) this.impact(0.35 + Math.min(0.45, (player.presentation?.landingSeverity || 0) * 0.45));
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
    this.enabled = !this.enabled;
    try { localStorage.setItem('streetskate.sound', this.enabled ? 'on' : 'off'); } catch {}
    if (!this.enabled) this.silence(); else this.unlock();
    return this.enabled;
  }
}
