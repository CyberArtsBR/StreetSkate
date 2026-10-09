/** A shuffle bag, never a random same-track repeat, shared by title and gameplay. */
export class MusicPlayer {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.volume = 0.36;
    this.tracks = [];
    this.queue = [];
    this.current = -1;
    this.enabled = true;
    this.unlocked = false;
    this.audio.addEventListener('ended', () => this.next());
    this.audio.addEventListener('error', () => {
      // A missing file must never trap the menu or cause a tight retry loop.
      this.queue = this.queue.filter(i => i !== this.current);
      if (this.tracks.length > 1) this.next();
    });
    this.load();
  }

  async load() {
    try {
      const response = await fetch('/audio/music/playlist.json', { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      this.tracks = (Array.isArray(data) ? data : data.tracks || [])
        .filter(t => (typeof t === 'string' && t) || (t && typeof t.src === 'string'))
        .map(t => typeof t === 'string' ? { src: t, title: t.split('/').at(-1).replace(/\.mp3$/i, '') } : t);
      if (this.unlocked) this.next();
    } catch (error) { console.warn('Music playlist unavailable:', error); }
  }

  unlock() {
    if (!this.enabled) return;
    this.unlocked = true;
    if (!this.tracks.length) return;
    if (this.current < 0) this.next();
    else this.audio.play().catch(() => {});
  }

  refill() {
    const choices = this.tracks.map((_, i) => i).filter(i => i !== this.current);
    for (let i = choices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [choices[i], choices[j]] = [choices[j], choices[i]];
    }
    this.queue = choices.length ? choices : this.tracks.map((_, i) => i);
  }

  next() {
    if (!this.tracks.length) return;
    if (!this.queue.length) this.refill();
    const next = this.queue.shift();
    if (next === undefined) return;
    this.current = next;
    this.audio.src = this.tracks[next].src;
    this.audio.load();
    if (this.unlocked && this.enabled) this.audio.play().catch(() => {});
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) this.unlock(); else this.audio.pause();
    return this.enabled;
  }

  get trackName() { return this.tracks[this.current]?.title || 'Soundtrack unavailable'; }
}
