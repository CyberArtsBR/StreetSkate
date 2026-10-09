export const TRACKS = [
  ['Chimpion Drip','chimpion-drip.mp3'], ['Slaying rails','slaying-rails.mp3'],
  ['West Park','west-park.mp3'], ['Old School flip','old-school-flip.mp3'],
  ['Aerial Flute','aerial-flute.mp3'], ['Skate Vibe','skate-vibe.mp3'], ['808 Bas','808-bas.mp3'],
];

export class MusicPlayer {
  constructor(onChange = () => {}) {
    this.audio = new Audio(); this.audio.preload = 'metadata'; this.audio.volume = 0.55;
    this.queue = []; this.current = -1; this.onChange = onChange; this.unlocked = false;
    this.failed = new Set(); this.playPending = null;
    this.audio.addEventListener('ended', () => this.next());
    this.audio.addEventListener('error', () => {
      this.failed.add(this.current);
      if(this.failed.size<TRACKS.length)this.next();
      else this.onChange(this.title, 'Soundtrack unavailable — reload to retry');
    });
    this.unlock = this.unlock.bind(this);
    window.addEventListener('pointerdown', this.unlock, { passive:true });
    window.addEventListener('keydown', this.unlock, { passive:true });
    document.addEventListener('visibilitychange', () => { if(!document.hidden)this.unlock(); });
    this.next();
  }
  get title() { return TRACKS[this.current]?.[0] || ''; }
  shuffle() {
    this.queue = TRACKS.map((_,i)=>i).filter(i=>!this.failed.has(i));
    for(let i=this.queue.length-1;i>0;i--) {const j=Math.floor(Math.random()*(i+1));[this.queue[i],this.queue[j]]=[this.queue[j],this.queue[i]];}
    if(this.queue.at(-1)===this.current) [this.queue[0],this.queue[this.queue.length-1]]=[this.queue.at(-1),this.queue[0]];
  }
  next() {
    this.queue=this.queue.filter(i=>!this.failed.has(i));
    if(!this.queue.length)this.shuffle();
    if(!this.queue.length)return;
    this.current=this.queue.pop();
    this.playPending=null;
    this.audio.src='/media/'+TRACKS[this.current][1];
    this.onChange(this.title,'');
    // Attempt title-screen playback immediately. Browsers may require a click
    // or keyboard gesture; the title screen explains how to enable sound.
    this.play();
  }
  async play() {
    if(this.playPending||this.failed.size===TRACKS.length)return;
    const source=this.audio.src;
    const pending=this.audio.play();this.playPending=pending;
    try { await pending; this.unlocked=true; if(source===this.audio.src)this.onChange(this.title,''); }
    catch(error) { if(source===this.audio.src&&error.name==='NotAllowedError')this.onChange(this.title,'Click or press Enter once to enable music'); }
    finally {if(this.playPending===pending)this.playPending=null;}
  }
  unlock() { if(this.audio.paused&&!this.audio.ended) this.play(); }
  setVolume(value) { this.audio.volume=Math.max(0,Math.min(1,value)); }
}
