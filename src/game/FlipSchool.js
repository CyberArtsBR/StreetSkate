import { gameAssetUrl } from './AssetPaths.js';
import { FLIP_LESSONS, FLIP_LESSON_TIMING, flipLessonFrame, flipLessonSteps } from './FlipLessons.js';

const MODES=['xbox','playstation','keyboard'];
const pad=`<svg class="flip-pad" viewBox="0 0 260 145" aria-hidden="true">
  <path d="M63 20 Q42 15 32 46 L13 112 Q6 138 27 137 Q37 137 62 104 H198 Q223 137 233 137 Q254 138 247 112 L228 46 Q218 15 197 20 Z" fill="#1e303a" stroke="#718994" stroke-width="2"/>
  <circle cx="69" cy="57" r="25" fill="#101f28" stroke="#627a85"/>
  <g data-stick><circle cx="69" cy="57" r="14" fill="#91a8b0" stroke="#dae5e1" stroke-width="2"/></g>
  <path d="M95 84v30m-15-15h30" stroke="#8da5ae" stroke-width="9"/>
  <circle cx="160" cy="100" r="15" fill="#101f28" stroke="#627a85"/>
  <g data-pad="flip"><circle cx="184" cy="57" r="14"/><text x="184" y="62" data-pad-flip>X</text></g>
  <g data-pad="ollie"><circle cx="210" cy="83" r="14"/><text x="210" y="88" data-pad-ollie>A</text></g>
  <circle cx="236" cy="57" r="10" fill="#394d56"/><circle cx="210" cy="31" r="10" fill="#394d56"/>
  <path d="M118 51h7m10 0h7" stroke="#879ca5" stroke-width="3" stroke-linecap="round"/>
</svg>`;

export function renderFlipSchool(index=0,mode='xbox',tutorialFlow=false){
  const lesson=FLIP_LESSONS[index]||FLIP_LESSONS[0];
  return `<article class="flip-school" aria-label="Flip trick video tutorials">
    <header class="flip-school-header"><div><span class="flip-eyebrow">CHIMP HAWK / FIELD NOTES 01</span><h2>FLIP <em>SCHOOL.</em></h2><p>Watch the board. Learn the buttons. Find your line.</p></div><span class="flip-header-stamp">8 TRICKS<br><b>ONE CLEAN LANDING.</b></span></header>
    <div class="flip-school-layout">
      <nav class="flip-lesson-list" aria-label="Choose a flip trick"><span class="flip-eyebrow">THE TRICK LIST</span>
        ${FLIP_LESSONS.map((entry,i)=>`<button data-menu data-action="flipLesson" data-index="${i}" aria-pressed="${i===index}" class="flip-lesson${i===index?' is-current':''}"><span class="flip-lesson-number">${String(i+1).padStart(2,'0')}</span><span>${entry.trick.name}<small>${entry.arrow} ${entry.label} + flip</small></span><span class="flip-lesson-arrow" aria-hidden="true">↗</span></button>`).join('')}
        <p class="flip-list-note">Hold a direction only for the trick tap. Holding it longer can rotate your rider.</p>
      </nav>
      <section class="flip-lesson-detail" aria-label="${lesson.trick.name} lesson">
        <div class="flip-detail-heading"><div><span class="flip-eyebrow">LESSON ${String(index+1).padStart(2,'0')} / 08</span><h3>${lesson.trick.name}</h3></div><span class="flip-loop-label">↻ VIDEO LOOP</span></div>
        <div class="flip-video-stage">
          <video data-flip-video muted loop playsinline preload="metadata" poster="${gameAssetUrl(lesson.poster)}" aria-label="${lesson.trick.name} animated demonstration"></video>
          <span class="flip-video-caption">IN-GAME ANIMATION / SIDE VIEW</span>
          <div class="flip-input-overlay" data-input-mode="${mode}">
            <span class="flip-overlay-label" data-overlay-label>CONTROLLER INPUT</span>${pad}
            <div class="flip-keyboard" aria-hidden="true"><kbd data-key="direction">${lesson.keys}</kbd><kbd data-key="ollie">SPACE</kbd><kbd data-key="flip">←</kbd></div>
            <span class="flip-live-cue" data-live-cue>Get ready</span>
          </div>
          <p class="flip-video-error" data-video-error role="status" hidden>Clip unavailable. Follow the steps below, or select Replay to retry.</p>
        </div>
        <div class="flip-player-controls"><div class="flip-transport">
          <button data-menu data-action="flipPlay" aria-label="Pause demonstration">Ⅱ PAUSE</button>
          <button data-menu data-action="flipReplay">↻ REPLAY</button>
          <button data-menu data-action="flipSpeed" aria-label="Change playback speed">0.5× SLOW</button>
        </div><div class="flip-input-modes" role="group" aria-label="Instruction controls">
          ${MODES.map((value,i)=>`<button data-menu data-action="flipInput" data-index="${i}" aria-pressed="${value===mode}">${['XBOX','PLAYSTATION','KEYBOARD'][i]}</button>`).join('')}
        </div></div>
        <div class="flip-progress" role="progressbar" aria-label="Demonstration progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div>
        <ol class="flip-steps" aria-label="Button order" data-flip-steps></ol>
        <div class="flip-coach-note"><span>LANDING NOTE</span><p>${lesson.tip}</p><small>Next: ${lesson.upgrade}. Tap flip again early, before the first flip finishes. Advanced flips need more airtime.</small></div>
      </section>
    </div>
    <footer class="flip-school-footer"><button data-menu data-action="back">← BACK</button><p>Left stick / D-pad to navigate · A / Cross to select · B / Circle to return</p>${tutorialFlow?'<button data-menu data-action="tutorialNext">NEXT: CONTROLS →</button>':''}<button data-menu data-action="practice" class="flip-practice">FREE PRACTICE ↗</button></footer>
  </article>`;
}

export class FlipSchoolPlayer {
  constructor(root,index=0,mode='xbox'){
    this.root=root;this.lesson=FLIP_LESSONS[index]||FLIP_LESSONS[0];this.mode=mode;
    this.video=root.querySelector('[data-flip-video]');
    this.error=root.querySelector('[data-video-error]');
    this.playButton=root.querySelector('[data-action="flipPlay"]');
    this.speedButton=root.querySelector('[data-action="flipSpeed"]');
    this.progress=root.querySelector('.flip-progress');this.fill=this.progress.firstElementChild;
    this.stick=root.querySelector('[data-stick]');this.cue=root.querySelector('[data-live-cue]');
    this.events=new AbortController();const options={signal:this.events.signal};
    this.video.muted=true;this.video.defaultPlaybackRate=.5;this.video.playbackRate=.5;
    this.video.addEventListener('play',()=>{this.syncPlayButton();this.schedule();},options);
    this.video.addEventListener('pause',()=>{this.syncPlayButton();this.cancel();},options);
    this.video.addEventListener('seeked',()=>this.update(),options);
    this.video.addEventListener('error',()=>{this.error.hidden=false;this.cancel();this.syncPlayButton();},options);
    this.video.addEventListener('loadeddata',()=>{this.error.hidden=true;this.update();},options);
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden){this.resumeOnVisible=!this.video.paused;this.video.pause();}
      else if(this.resumeOnVisible){this.resumeOnVisible=false;this.play();}
    },options);
    this.setInputMode(mode);
    this.video.src=gameAssetUrl(this.lesson.video);
    this.update();
    if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches&&!document.hidden)this.play();
    else this.syncPlayButton();
  }
  setInputMode(mode){
    this.mode=MODES.includes(mode)?mode:'xbox';this.key='';
    this.root.querySelector('.flip-input-overlay').dataset.inputMode=this.mode;
    this.root.querySelector('[data-overlay-label]').textContent=this.mode==='keyboard'?'KEYBOARD INPUT':this.mode==='playstation'?'PLAYSTATION INPUT':'XBOX INPUT';
    this.root.querySelector('[data-pad-ollie]').textContent=this.mode==='playstation'?'✕':'A';
    this.root.querySelector('[data-pad-flip]').textContent=this.mode==='playstation'?'□':'X';
    this.root.querySelectorAll('[data-action="flipInput"]').forEach((button,i)=>button.setAttribute('aria-pressed',String(MODES[i]===this.mode)));
    this.steps=flipLessonSteps(this.lesson,this.mode);
    this.root.querySelector('[data-flip-steps]').innerHTML=this.steps.map((step,i)=>`<li><span class="flip-step-number">0${i+1}</span><div><b>${step.title}</b><strong>${step.input}</strong><small>${step.detail}</small></div></li>`).join('');
    this.stepNodes=[...this.root.querySelectorAll('.flip-steps li')];this.update();
  }
  update(time=this.video.currentTime){
    if(this.destroyed)return;
    const state=flipLessonFrame(this.lesson,time);
    const key=[this.mode,state.step,state.ollie,state.flip,state.direction].join(':');
    if(key!==this.key){
      this.key=key;
      this.stepNodes.forEach((node,i)=>{node.classList.toggle('is-active',i===state.step);if(i===state.step)node.setAttribute('aria-current','step');else node.removeAttribute('aria-current');});
      for(const input of ['ollie','flip']){
        this.root.querySelector(`[data-pad="${input}"]`).classList.toggle('is-active',state[input]);
        this.root.querySelector(`[data-key="${input}"]`).classList.toggle('is-active',state[input]);
      }
      this.root.querySelector('[data-key="direction"]').classList.toggle('is-active',state.direction);
      this.stick.setAttribute('transform',state.direction?`translate(${this.lesson.x*10} ${this.lesson.y*10})`:'translate(0 0)');
      this.stick.classList.toggle('is-active',state.direction);
      this.cue.textContent=state.step===2&&!state.flip?'Release · watch the catch':this.steps[state.step].input;
    }
    const percent=Math.min(100,100*time/FLIP_LESSON_TIMING.duration);
    this.fill.style.transform=`scaleX(${percent/100})`;
    const value=String(Math.round(percent));if(this.progress.getAttribute('aria-valuenow')!==value)this.progress.setAttribute('aria-valuenow',value);
  }
  schedule(){
    this.cancel();if(this.destroyed||this.video.paused||document.hidden)return;
    if(this.video.requestVideoFrameCallback)this.frame=this.video.requestVideoFrameCallback((_,metadata)=>{this.frame=null;this.update(metadata.mediaTime);this.schedule();});
    else this.animation=requestAnimationFrame(()=>{this.animation=null;this.update();this.schedule();});
  }
  cancel(){if(this.frame!=null)this.video.cancelVideoFrameCallback(this.frame);if(this.animation!=null)cancelAnimationFrame(this.animation);this.frame=this.animation=null;}
  syncPlayButton(){const paused=this.video.paused;this.playButton.textContent=paused?'▶ PLAY':'Ⅱ PAUSE';this.playButton.setAttribute('aria-label',paused?'Play demonstration':'Pause demonstration');}
  play(){if(this.destroyed)return;this.video.play().catch(()=>{if(!this.destroyed)this.syncPlayButton();});}
  toggle(){if(this.video.paused)this.play();else this.video.pause();}
  replay(){if(this.video.error)this.video.load();this.video.currentTime=0;this.update(0);this.play();}
  toggleSpeed(){this.video.defaultPlaybackRate=this.video.playbackRate===.5?1:.5;this.video.playbackRate=this.video.defaultPlaybackRate;this.speedButton.textContent=this.video.playbackRate===.5?'0.5× SLOW':'1× NORMAL';}
  dispose(){this.destroyed=true;this.events.abort();this.cancel();this.video.pause();this.video.removeAttribute('src');this.video.load();}
}
