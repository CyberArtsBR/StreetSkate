import { TUTORIAL_PAGES } from './TutorialPages.js';
import { MusicPlayer } from './MusicPlayer.js';

/** Controller-first 16:9 frontend around the existing immutable skate simulation. */
export class GameShell {
  constructor({ app, ready, startRun, pauseGame, resumeGame, getScore, setCameraMode, openTricks }) {
    this.app = app;
    this.ready = ready;
    this.startRun = startRun;
    this.pauseGame = pauseGame;
    this.resumeGame = resumeGame;
    this.getScore = getScore;
    this.setCameraMode = setCameraMode;
    this.openTricks = openTricks;
    this.music = new MusicPlayer();
    this.screen = 'title';
    this.practice = false;
    this.remaining = 90;
    this.page = 0;
    this.tutorialReturn = 'title';
    this.optionsReturn = 'title';
    this.selected = 0;
    this.padPrevious = {};
    this.navCooldown = 0;
    this.root = document.createElement('section');
    this.root.className = 'ch-shell';
    this.root.setAttribute('aria-label','Chimp Hawk Underground menu');
    app.append(this.root);
    this.timer = document.createElement('div');
    this.timer.className = 'ch-timer';
    this.timer.innerHTML = '<small>RUN TIME</small><strong>01:30</strong>';
    app.append(this.timer);
    this.root.addEventListener('click', event => {
      const control = event.target.closest('[data-ch-action]');
      if (control) this.act(control.dataset.chAction);
    });
    window.addEventListener('pointerdown', () => this.music.unlock(), { passive: true });
    window.addEventListener('keydown', event => this.onKey(event), true);
    this.render();
  }

  isPlaying() { return this.screen === 'playing'; }
  isPause() { return this.screen === 'pause'; }
  isBlocking() { return this.screen !== 'playing'; }
  activateAudio() { this.music.unlock(); }

  start(practice = false) {
    if (!this.ready()) return;
    this.practice = practice;
    this.remaining = practice ? Infinity : 90;
    this.startRun(practice);
    this.music.next();
    this.screen = 'playing';
    this.music.unlock();
    this.render();
  }

  pause() {
    if (!this.isPlaying()) return;
    this.pauseGame();
    this.screen = 'pause';
    this.render();
  }

  resume() {
    if (!this.isPause()) return;
    this.resumeGame();
    this.screen = 'playing';
    this.render();
  }

  openTutorial(origin = 'title') {
    this.tutorialReturn = origin;
    this.page = 0;
    this.screen = 'tutorial';
    this.render();
  }

  act(action) {
    this.music.unlock();
    if (action === 'start') { this.openTutorial('start'); return; }
    if (action === 'practice') { this.start(true); return; }
    if (action === 'begin') { this.start(false); return; }
    if (action === 'resume') { this.resume(); return; }
    if (action === 'pause') { this.pause(); return; }
    if (action === 'options') { this.optionsReturn = this.screen; this.screen = 'options'; this.render(); return; }
    if (action === 'tutorial') { this.openTutorial(this.screen); return; }
    if (action === 'tricks') { this.openTricks(); return; }
    if (action === 'next') {
      if (this.page < TUTORIAL_PAGES.length-1) { this.page++; this.render(); }
      else if (this.tutorialReturn === 'start') this.start(false);
      else { this.screen = this.tutorialReturn === 'pause' ? 'pause' : 'title'; this.render(); }
      return;
    }
    if (action === 'previous') { this.page = Math.max(0,this.page-1); this.render(); return; }
    if (action === 'back') {
      if (this.screen === 'tutorial') {
        this.screen = this.tutorialReturn === 'start' ? 'title' : this.tutorialReturn;
      } else if (this.screen === 'options') this.screen = this.optionsReturn;
      else if (this.screen === 'results') this.screen='title';
      else if (this.screen === 'pause') { this.resume(); return; }
      this.render(); return;
    }
    if (action === 'quit') { this.pauseGame(); this.screen='title'; this.render(); return; }
    if (action === 'music') { this.music.next(); this.render(); return; }
    if (action === 'camera') { this.setCameraMode(); this.render(); return; }
    if (action === 'retry') { this.openTutorial('start'); return; }
  }

  onKey(event) {
    if (event.code === 'Backspace' && !/INPUT|TEXTAREA/.test(event.target?.tagName)) {
      event.preventDefault(); this.music.unlock(); this.music.next(); return;
    }
    if (this.isPlaying()) {
      if (event.code === 'Escape' && !event.repeat) {
        event.preventDefault(); event.stopPropagation(); this.pause();
      }
      return;
    }
    const key = event.code;
    if (['ArrowDown','ArrowUp','Enter','Space','Escape','KeyW','KeyS'].includes(key)) {
      event.preventDefault(); event.stopPropagation();
      if (event.repeat) return;
      if (key === 'ArrowDown' || key === 'KeyS') this.navigate(1);
      else if (key === 'ArrowUp' || key === 'KeyW') this.navigate(-1);
      else if (key === 'Escape') this.act('back');
      else this.confirm();
    }
  }

  navigate(step) {
    const buttons = [...this.root.querySelectorAll('button[data-ch-action]:not(:disabled)')];
    if (!buttons.length) return;
    this.selected = (this.selected+step+buttons.length)%buttons.length;
    buttons[this.selected].focus({ preventScroll:true });
  }

  confirm() {
    const buttons = [...this.root.querySelectorAll('button[data-ch-action]:not(:disabled)')];
    buttons[this.selected]?.click();
  }

  pollGamepad(dt) {
    this.navCooldown = Math.max(0,this.navCooldown-dt);
    const pad = [...(navigator.getGamepads?.()||[])].find(p=>p?.connected);
    if (!pad) { this.padPrevious = {}; return; }
    const held = key => !!pad.buttons[key]?.pressed;
    const edge = key => held(key) && !this.padPrevious[key];
    const wasPlaying = this.isPlaying();
    if (wasPlaying) {
      if (edge(9)) this.pause();
    } else {
      if (edge(0)) this.confirm();
      if (edge(1)) this.act('back');
      if (edge(9) && this.screen === 'pause') this.act('resume');
      const direction = (held(13) || (pad.axes[1]||0)>0.65 ? 1 : 0)
        - (held(12) || (pad.axes[1]||0)<-0.65 ? 1 : 0);
      if (direction && this.navCooldown<=0) { this.navigate(direction); this.navCooldown=0.2; }
    }
    // View/Select is handled here on menus and during gameplay.
    if (edge(8)) this.music.next();
    this.padPrevious = Object.fromEntries(Array.from({length:17},(_,i)=>[i,held(i)]));
  }

  tick(dt, canSimulate) {
    this.pollGamepad(dt);
    if (!this.isPlaying() || !canSimulate) return;
    if (!this.practice) {
      this.remaining = Math.max(0,this.remaining-dt);
      if (this.remaining <= 0) {
        this.pauseGame();
        this.screen='results';
        this.render();
      }
    }
    this.updateTimer();
  }

  updateTimer() {
    const seconds = Math.ceil(this.remaining);
    this.timer.querySelector('strong').textContent = this.practice ? '∞' :
      String(Math.floor(seconds/60)).padStart(2,'0') + ':' +
      String(seconds%60).padStart(2,'0');
  }

  render() {
    this.root.hidden = this.isPlaying();
    this.app.dataset.chScreen = this.screen;
    this.timer.hidden = !this.isPlaying();
    this.updateTimer();
    if (this.isPlaying()) return;
    const button = (action,label,primary=false) =>
      '<button type="button" data-ch-action="'+action+'" class="'+(primary?'primary':'')+'">'+label+'</button>';
    let content = '';
    if (this.screen === 'title') {
      content = '<p class="ch-eyebrow">THE CHIMPIONS · ROOFTOP SKATE SESSIONS</p><h1>CHIMP HAWK<br><em>UNDERGROUND</em></h1><p class="ch-sub">MAKE YOUR LINE. OWN THE SKYLINE.</p>'
        + button('start', this.ready() ? 'START GAME · 90 SEC' : 'LOADING PARK…',true)
        + button('options','OPTIONS') + button('tutorial','HOW TO PLAY')
        + '<p class="ch-mini">A / ENTER SELECT · ↑↓ NAVIGATE · SELECT / BACKSPACE MUSIC</p>';
    } else if (this.screen === 'options') {
      content = '<p class="ch-eyebrow">SETTINGS</p><h2>OPTIONS</h2><p class="ch-sub">Practice has no timer or score deadline.</p>'
        + button('practice','PRACTICE · UNLIMITED',true)
        + button('camera','CYCLE CAMERA') + button('music','NEXT TRACK') + button('back','BACK');
    } else if (this.screen === 'pause') {
      content = '<p class="ch-eyebrow">SESSION PAUSED</p><h2>PAUSE MENU</h2>'
        + button('resume','RESUME',true) + button('tutorial','HOW TO PLAY')
        + button('tricks','TRICK BOOK') + button('options','OPTIONS')
        + button('music','NEXT TRACK') + button('quit','MAIN MENU');
    } else if (this.screen === 'tutorial') {
      const p = TUTORIAL_PAGES[this.page];
      content = '<p class="ch-eyebrow">'+p.kicker+'</p><h2>'+p.title+'</h2><div class="ch-tutorial">'
        + p.rows.map(([key,value])=>'<div><b>'+key+'</b><span>'+value+'</span></div>').join('')
        + '</div><p class="ch-tip">'+p.tip+'</p>'
        + '<p class="ch-page">'+(this.page+1)+' / '+TUTORIAL_PAGES.length+'</p>'
        + button('previous','PREVIOUS') + button('next',this.page===TUTORIAL_PAGES.length-1 && this.tutorialReturn==='start' ? 'START 90-SECOND RUN' : 'NEXT',true)
        + button('back','BACK');
    } else if (this.screen === 'results') {
      content = '<p class="ch-eyebrow">TIME IS UP</p><h2>RUN COMPLETE</h2>'
        + '<p class="ch-result">'+Number(this.getScore()||0).toLocaleString()+' POINTS</p>'
        + button('retry','PLAY AGAIN',true) + button('practice','PRACTICE') + button('quit','MAIN MENU');
    }
    this.root.innerHTML = '<div class="ch-menu"><div class="ch-menu-content">'+content+'</div><p class="ch-track">♫ '+this.music.trackName+'</p></div>';
    const buttons = [...this.root.querySelectorAll('button:not(:disabled)')];
    this.selected = 0;
    // Leave pointer interactions unfocused, but enable predictable controller focus.
    if (buttons.length && this.padPrevious[0]) buttons[0].focus({preventScroll:true});
  }
}
