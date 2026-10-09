import { tutorialPages } from './TutorialPages.js';
import { MusicPlayer } from './MusicPlayer.js';

const CAMERAS=['follow','classic','fixed','firstperson'];
const CAMERA_LABELS=['Follow','Classic','Fixed','First person'];
export class GameShell {
  constructor(actions) {
    this.actions=actions;this.phase='title';this.ready=false;this.practice=false;this.remaining=90;
    this.selection=0;this.previousPad={};this.navRepeat=0;this.tutorialSeen=false;this.page=0;
    this.pages=[{image:'/media/trick-guide-16x9.png'},...tutorialPages()];this.cameraIndex=0;this.sound=true;this.finishIndex=0;this.inputGrace=0;
    this.root=document.createElement('section');this.root.id='game-shell';this.root.setAttribute('aria-label','Game menu');
    this.root.innerHTML='<div class="title-art"></div><div class="shell-content"></div><div class="menu-footnote">↑ ↓ / LEFT STICK · ENTER / A SELECT · ESC / B BACK</div>';
    document.body.append(this.root);this.content=this.root.querySelector('.shell-content');
    this.timer=document.createElement('div');this.timer.id='run-timer';document.querySelector('#app').append(this.timer);
    this.song=document.createElement('div');this.song.id='now-playing';document.body.append(this.song);
    this.music=new MusicPlayer((title,note)=>{this.song.textContent=`♫ ${title} · Backspace / View to skip${note?' · '+note:''}`;});
    window.addEventListener('keydown',e=>this.key(e),true);
    this.render();
  }
  get active(){return this.phase==='playing';}
  get open(){return this.phase==='tutorial';}
  setReady(){this.ready=true;this.render();}
  setScreen(phase){this.phase=phase;this.selection=0;this.navRepeat=.2;this.render();}
  menuButtons(){return [...this.content.querySelectorAll('button[data-menu]')].filter(b=>!b.disabled);}
  focusSelection(){const buttons=this.menuButtons();this.selection=(this.selection+buttons.length)%Math.max(1,buttons.length);buttons.forEach((b,i)=>b.classList.toggle('selected',i===this.selection));buttons[this.selection]?.focus({preventScroll:true});}
  button(label,action,disabled=false){return `<button data-menu data-action="${action}" ${disabled?'disabled':''}>${label}</button>`;}
  render(){
    document.body.dataset.screen=this.phase;this.root.hidden=this.active;
    this.timer.hidden=!this.active;this.updateTimer();
    this.root.className=this.phase==='title'?'title-screen':this.phase==='tutorial'?'tutorial-screen':'menu-screen';
    if(this.active)return;
    let title='',body='';
    if(this.phase==='title') {
      body=`<button class="art-hit art-start" data-menu data-action="start" aria-label="Start Game — 90 seconds" ${this.ready?'':'disabled'}></button><button class="art-hit art-back" data-menu data-action="launcher" aria-label="Back to Game Selection"></button><div class="title-tools">${this.button('TUTORIAL','tutorial')}${this.button('OPTIONS / PRACTICE','options')}</div><p class="title-status" role="status">${this.ready?'':this.loadError?'Unable to load the park. Reload to retry.':'Loading the rooftop…'}</p>`;
    } else if(this.phase==='pause') {
      title='PAUSED';body=this.button('RESUME','resume')+this.button('TUTORIAL','tutorial')+this.button('OPTIONS','options')+this.button('RESTART RUN','restart')+this.button('MAIN MENU','title');
    } else if(this.phase==='options') {
      title='OPTIONS';body=this.button('PRACTICE · NO TIME LIMIT','practice',!this.ready)
        +this.button('CAMERA · '+CAMERA_LABELS[this.cameraIndex],'camera')
        +this.button(`MUSIC · ${Math.round(this.music.audio.volume*100)}%`,'volume')
        +this.button('SKATE SOUNDS · '+(this.sound?'ON':'OFF'),'sound')
        +this.button('DECK · '+['SUNSET','OCEAN','AQUA','LIME','GOLD','NEBULA','GRAPHITE','PEARL'][this.finishIndex],'deck')
        +this.button('BACK','back');
    } else if(this.phase==='results') {
      title='TIME’S UP';body=`<p class="result-score">${this.finalScore.toLocaleString()}<small>POINTS BANKED</small></p>`
        +this.button('RUN IT AGAIN · 90 SEC','start')+this.button('PRACTICE','practice')+this.button('MAIN MENU','title');
    } else if(this.phase==='tutorial') {
      const page=this.pages[this.page];
      const navigation=`<footer>${this.button('← PREVIOUS','previous',this.page===0)}<span>LB / RB OR LEFT / RIGHT · B / ESC BACK</span>${this.button(this.page===this.pages.length-1?(this.pendingMode?'LET’S SKATE':'BACK TO GAME'):'DETAILS / NEXT →',this.page===this.pages.length-1?'closeTutorial':'next')}</footer>`;
      body=page.image?`<div class="tutorial-poster"><img src="${page.image}" alt="Complete keyboard and Xbox trick guide. Next opens readable tables for each section.">${navigation}</div>`:`<div class="tutorial-frame"><header><small>CHIMP HAWK / TUTORIAL ${this.page+1} OF ${this.pages.length}</small><h2>${page.title}</h2><p>${page.subtitle}</p></header><div class="tutorial-body">${page.html}</div>${navigation}</div>`;
    }
    this.content.innerHTML=this.phase==='title'||this.phase==='tutorial'?body:`<div class="menu-card"><small>CHIMP HAWK / UNDERGROUND</small><h2>${title}</h2>${body}</div>`;
    for(const button of this.menuButtons()) {button.onclick=()=>this.choose(button.dataset.action);button.onpointerenter=()=>{this.selection=this.menuButtons().indexOf(button);this.focusSelection();};}
    if(this.phase==='tutorial')this.selection=this.menuButtons().length-1;
    this.focusSelection();
  }
  begin(practice=false){
    if(!this.ready)return;
    if(!this.tutorialSeen){this.pendingMode=practice?'practice':'timed';this.openTutorial();return;}
    this.start(practice);
  }
  start(practice){
    this.practice=practice;this.remaining=90;this.inputGrace=.3;this.cameraIndex=0;
    this.music.next();this.setScreen('playing');this.actions.start(practice);this.actions.camera('follow');
  }
  pause(){if(this.active){this.setScreen('pause');this.actions.pause(true);}}
  resume(){this.setScreen('playing');this.inputGrace=.18;this.actions.pause(false);}
  syncPause(value){if(value&&this.active)this.setScreen('pause');else if(!value&&this.phase==='pause')this.setScreen('playing');}
  openTutorial(){this.tutorialReturn=this.phase;this.page=0;this.actions.pause(true);this.setScreen('tutorial');}
  closeTutorial(){
    this.tutorialSeen=true;
    if(this.pendingMode){const practice=this.pendingMode==='practice';this.pendingMode=null;this.start(practice);}
    else if(this.tutorialReturn==='playing')this.resume();
    else this.setScreen(this.tutorialReturn==='tutorial'?'title':this.tutorialReturn);
  }
  back(){if(this.phase==='tutorial'){this.pendingMode=null;this.closeTutorial();}else if(this.phase==='options')this.setScreen(this.optionsReturn||'title');else if(this.phase==='pause')this.resume();else if(this.phase==='results')this.choose('title');else if(this.phase==='title')this.choose('launcher');}
  choose(action){
    this.music.unlock();
    switch(action){
      // Same game-selection destination used by CyberArtsBR/Skate's launcher.
      case 'launcher':window.location.assign('https://chimp-jump.onrender.com/');break;
      case 'start':this.begin(false);break;case 'practice':this.begin(true);break;
      case 'restart':this.start(this.practice);break;case 'resume':this.resume();break;
      case 'tutorial':this.openTutorial();break;
      case 'options':this.optionsReturn=this.phase;this.setScreen('options');break;
      case 'camera':this.cameraIndex=(this.cameraIndex+1)%4;this.actions.camera(CAMERAS[this.cameraIndex]);this.render();break;
      case 'volume':this.music.setVolume(this.music.audio.volume>=.99?0:Math.min(1,this.music.audio.volume+.1));this.render();break;
      case 'sound':this.sound=!this.sound;this.actions.sound(this.sound);this.render();break;
      case 'deck':this.finishIndex=(this.finishIndex+1)%8;this.actions.deck(this.finishIndex);this.render();break;
      case 'title':this.actions.pause(true);this.setScreen('title');break;
      case 'back':this.back();break;
      case 'previous':this.page=Math.max(0,this.page-1);this.render();break;
      case 'next':this.page=Math.min(this.pages.length-1,this.page+1);this.render();break;
      case 'closeTutorial':this.closeTutorial();break;
    }
  }
  key(event){
    if(/INPUT|TEXTAREA|SELECT/.test(event.target?.tagName))return;
    if(event.code==='Backspace'){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)this.music.next();return;}
    if(event.code==='KeyH'){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat){if(this.open)this.closeTutorial();else this.openTutorial();}return;}
    if(this.active)return;
    this.music.unlock();
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD','Space','Enter','Escape'].includes(event.code)){
      event.preventDefault();event.stopImmediatePropagation();if(event.repeat)return;
      if(event.code==='Escape')this.back();
      else if(['ArrowLeft','KeyA'].includes(event.code)&&this.open)this.choose('previous');
      else if(['ArrowRight','KeyD'].includes(event.code)&&this.open)this.choose('next');
      else if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD'].includes(event.code)){this.selection+=['ArrowUp','ArrowLeft','KeyW','KeyA'].includes(event.code)?-1:1;this.focusSelection();}
      else if(event.code==='Enter'||event.code==='Space')this.menuButtons()[this.selection]?.click();
    }
  }
  updateTimer(){this.timer.textContent=this.practice?'PRACTICE · ∞':`${Math.floor(Math.ceil(this.remaining)/60)}:${String(Math.ceil(this.remaining)%60).padStart(2,'0')}`;this.timer.classList.toggle('time-low',!this.practice&&this.remaining<=15);}
  update(dt){
    this.inputGrace=Math.max(0,this.inputGrace-dt);this.navRepeat=Math.max(0,this.navRepeat-dt);
    if(!document.hasFocus())return;
    const pad=[...(navigator.getGamepads?.()||[])].find(p=>p?.connected);
    const b=i=>!!pad?.buttons[i]?.pressed;
    const keys={a:b(0),back:b(1),select:b(8),start:b(9),up:b(12)||(pad?.axes[1]||0)<-.6,down:b(13)||(pad?.axes[1]||0)>.6,left:b(14)||b(4),right:b(15)||b(5)};
    const edge=k=>keys[k]&&!this.previousPad[k];
    if(Object.keys(keys).some(edge))this.music.unlock();
    if(edge('select'))this.music.next();
    if(!this.active){
      if((keys.up||keys.down)&&(!this.navRepeat||edge('up')||edge('down'))){this.selection+=keys.up?-1:1;this.focusSelection();this.navRepeat=.22;}
      if(edge('back'))this.back();
      else if(this.open&&edge('left'))this.choose('previous');
      else if(this.open&&edge('right'))this.choose('next');
      else if(edge('a'))this.menuButtons()[this.selection]?.click();
      else if(edge('start')&&this.phase==='pause')this.resume();
    }
    this.previousPad=keys;
    if(this.active&&!this.practice&&document.hasFocus()){
      this.remaining=Math.max(0,this.remaining-dt);this.updateTimer();
      if(!this.remaining){this.finalScore=this.actions.score();this.actions.pause(true);this.music.next();this.setScreen('results');}
    }
  }
}
