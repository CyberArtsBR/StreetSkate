export const TRACKS = [
  ['Chimpion Drip','chimpion-drip.mp3'], ['Slaying rails','slaying-rails.mp3'],
  ['West Park','west-park.mp3'], ['Old School flip','old-school-flip.mp3'],
  ['Aerial Flute','aerial-flute.mp3'], ['Skate Vibe','skate-vibe.mp3'], ['808 Bas','808-bas.mp3'],
];

const clamp = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : 0.5;

export class MusicPlayer {
  constructor(onChange = () => {}) {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.baseVolume = 0.55;
    let saved = 0.5;
    try {
      const stored = localStorage.getItem('streetskate.masterVolume');
      if (stored !== null) saved = Number(stored);
    } catch {}
    this.masterVolume = clamp(saved);
    this.audio.volume = this.baseVolume * this.masterVolume;
    this.queue = [];
    this.current = -1;
    this.onChange = onChange;
    this.unlocked = false;
    this.failed = new Set();
    this.playPending = null;
    this.generation = 0;
    this.disposed = false;
    this._ended = () => this.next();
    this._error = () => {
      if (this.disposed || this.current < 0) return;
      this.failed.add(this.current);
      if (this.failed.size < TRACKS.length) this.next();
      else this.onChange(this.title, 'Soundtrack unavailable — reload to retry');
    };
    this._visibility = () => { if (!document.hidden) this.unlock(); };
    this.unlock = this.unlock.bind(this);
    this.audio.addEventListener('ended', this._ended);
    this.audio.addEventListener('error', this._error);
    window.addEventListener('pointerdown', this.unlock, { passive: true });
    window.addEventListener('keydown', this.unlock, { passive: true });
    window.addEventListener('touchstart', this.unlock, { passive: true });
    document.addEventListener('visibilitychange', this._visibility);
    this.next();
  }

  get title() { return TRACKS[this.current]?.[0] || ''; }

  shuffle() {
    this.queue = TRACKS.map((_, i) => i).filter(i => !this.failed.has(i));
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
    // Pop() is the next play. Never repeat the last song at a cycle boundary.
    const last = this.queue.length - 1;
    if (last > 0 && this.queue[last] === this.current) {
      [this.queue[last], this.queue[0]] = [this.queue[0], this.queue[last]];
    }
  }

  next() {
    if (this.disposed) return;
    this.queue = this.queue.filter(i => !this.failed.has(i));
    if (!this.queue.length) this.shuffle();
    if (!this.queue.length) return;
    this.current = this.queue.pop();
    this.generation++;
    // Invalidate old play promises before replacing the source; a rapid skip
    // must not allow a stale rejection to block the replacement track.
    this.playPending = null;
    this.audio.pause();
    this.audio.src = '/media/' + TRACKS[this.current][1];
    this.onChange(this.title, '');
    void this.play();
  }

  async play() {
    if (this.disposed || this.playPending || this.failed.size === TRACKS.length) return;
    const generation = this.generation;
    let pending;
    try {
      pending = Promise.resolve(this.audio.play());
      this.playPending = pending;
      await pending;
      if (generation !== this.generation || this.disposed) return;
      this.unlocked = true;
      this.onChange(this.title, '');
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      if (error?.name === 'NotAllowedError') {
        // Retry on an ordinary input; avoid a second explicit Enter/click instruction.
        this.onChange(this.title, '');
      } else if (error?.name !== 'AbortError') {
        this.onChange(this.title, 'Unable to play track · skip to retry');
      }
    } finally {
      if (this.playPending === pending) this.playPending = null;
    }
  }

  unlock() {
    if (!this.disposed && this.audio.paused && !this.audio.ended) void this.play();
  }

  setVolume(value) { this.audio.volume = clamp(value); }

  setMasterVolume(value) {
    this.masterVolume = clamp(value);
    this.audio.volume = this.baseVolume * this.masterVolume;
    try { localStorage.setItem('streetskate.masterVolume', String(this.masterVolume)); } catch {}
    this.onChange(this.title, '');
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.audio.pause();
    this.audio.removeEventListener('ended', this._ended);
    this.audio.removeEventListener('error', this._error);
    window.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
    window.removeEventListener('touchstart', this.unlock);
    document.removeEventListener('visibilitychange', this._visibility);
    this.audio.removeAttribute?.('src');
    this.audio.load?.();
    this.queue.length = 0;
  }
}
