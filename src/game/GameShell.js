import { tutorialPages } from './TutorialPages.js';
import { MusicPlayer } from './MusicPlayer.js';
import { isValidGlbHeader } from '../input/GlbHeader.js';
import { inspectGlb } from '../../tools/agent10-glb-inspector.mjs';
import { DEFAULT_CHARACTERS, BOARD_CHOICES, LOCATIONS } from './LoadoutCatalog.js';
import { characterPortrait } from './CharacterPortraits.js';

const safe = value => String(value).replace(/[&<>"']/g, ch =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

const CAMERAS=['follow','classic','fixed'];
const CAMERA_LABELS=['Follow','Classic','Fixed'];
export class GameShell {
  constructor(actions) {
    this.actions=actions;this.phase='title';this.ready=false;this.practice=false;this.remaining=90;
    this.selection=0;this.previousPad={};this.padFocused=false;this.navRepeat=0;this.tutorialSeen=false;this.page=0;
    this.pages=[{image:'/media/trick-guide-16x9.png'},...tutorialPages()];this.cameraIndex=0;this.sound=true;this.finishIndex=0;this.inputGrace=0;
    this.heroes=[...DEFAULT_CHARACTERS];this.heroIndex=0;this.boardIndex=0;this.locationIndex=0;
    this.selectBusy=false;this.selectError='';this.avatarUrl=null;this.pendingMode=null;
    this.heroConfirmed=false;this.boardConfirmed=false;this.focusHint=null;
    this.root=document.createElement('section');this.root.id='game-shell';this.root.setAttribute('aria-label','Game menu');
    this.root.innerHTML='<div class="title-art"></div><div class="shell-content"></div><div class="menu-footnote">↑ ↓ ← → / LEFT STICK · ENTER / A SELECT · ESC / B BACK</div>';
    document.body.append(this.root);this.content=this.root.querySelector('.shell-content');
    this.timer=document.createElement('div');this.timer.id='run-timer';document.querySelector('#app').append(this.timer);
    this.song=document.createElement('div');this.song.id='now-playing';document.body.append(this.song);
    this.music=new MusicPlayer((title,note)=>{this.song.textContent=`♫ ${title} · Backspace / View to skip${note?' · '+note:''}`;});
    this.avatarInput=document.createElement('input');
    this.avatarInput.type='file';this.avatarInput.accept='.glb,model/gltf-binary';this.avatarInput.hidden=true;
    document.body.append(this.avatarInput);
    this.avatarInput.addEventListener('change',async()=>{
      const file=this.avatarInput.files?.[0];this.avatarInput.value='';
      if(!file)return;
      if(file.size>35*1024*1024 || file.size<20 || !/\.glb$/i.test(file.name)) {
        this.selectError='Choose a rigged .GLB file smaller than 35 MB.';this.render();return;
      }
      // Validate both the header and the full GLB structure *before* exposing
      // untrusted bytes to GLTFLoader or creating a persistent object URL.
      // The inspector rejects external/data URI resources and oversized rigs.
      const uploadGeneration=(this.avatarUploadGeneration=(this.avatarUploadGeneration||0)+1);
      try {
        const buffer=await file.arrayBuffer();
        if(uploadGeneration!==this.avatarUploadGeneration)return;
        if(!isValidGlbHeader(buffer.slice(0,20),buffer.byteLength))
          throw new Error('Invalid GLB 2.0 header or JSON chunk.');
        inspectGlb(buffer);
      } catch(error) {
        if(uploadGeneration!==this.avatarUploadGeneration)return;
        this.selectError='Invalid GLB header or content: '+(error?.message||'Unable to read file.');
        this.render();return;
      }
      const next=URL.createObjectURL(file);
      if(this.avatarUrl)URL.revokeObjectURL(this.avatarUrl);
      this.avatarUrl=next;
      this.heroes=this.heroes.filter(h=>h.id!=='custom');
      this.heroes.push({id:'custom',name:file.name.replace(/\.glb$/i,''),subtitle:'YOUR UPLOADED RIDER',url:next,accent:'#ffc469'});
      this.heroIndex=this.heroes.length-1;this.heroConfirmed=false;
      this.focusHint={action:'hero',index:this.heroIndex};
      this.selectError='Avatar ready · select this rider with A / Enter / Click before continuing.';
      this.render();
    });
    window.addEventListener('keydown',e=>this.key(e),true);
    this.render();
  }
  get active(){return this.phase==='playing';}
  get open(){return this.phase==='tutorial';}
  setReady(){this.ready=true;this.render();}
  setScreen(phase){this.phase=phase;this.selection=0;this.navRepeat=.2;this.render();}
  menuButtons(){return [...this.content.querySelectorAll('button[data-menu]')].filter(b=>!b.disabled);}
  focusSelection(){
    const buttons=this.menuButtons();
    if(!buttons.length){this.selection=0;return;}
    this.selection=(this.selection+buttons.length)%buttons.length;
    buttons.forEach((b,i)=>b.classList.toggle('selected',i===this.selection));
    buttons[this.selection]?.focus({preventScroll:true});
  }
  // Spatial controller navigation: left/right stays on the same visual row,
  // up/down targets the closest item in the row immediately above/below.
  moveSelection(axis, sign) {
    const buttons=this.menuButtons();
    // Pointer, keyboard and gamepad can hand focus to the browser between
    // frames; always navigate from the actual focused card if there is one.
    const focusedIndex=buttons.indexOf(document.activeElement);
    if(focusedIndex>=0)this.selection=focusedIndex;
    const current=buttons[this.selection];
    if(!current)return;
    const r=current.getBoundingClientRect();
    const cx=r.left+r.width/2,cy=r.top+r.height/2;
    let best=-1,score=Infinity;
    for(let i=0;i<buttons.length;i++){
      if(i===this.selection)continue;
      const box=buttons[i].getBoundingClientRect();
      const x=box.left+box.width/2-cx,y=box.top+box.height/2-cy;
      const primary=(axis==='x'?x:y)*sign;
      const secondary=axis==='x'?y:x;
      if(primary<=Math.max(4,(axis==='x'?r.width:r.height)*0.12))continue;
      if(axis==='x'&&Math.abs(secondary)>Math.max(r.height,box.height)*0.85)continue;
      const candidate=primary+Math.abs(secondary)*1.7;
      if(candidate<score){best=i;score=candidate;}
    }
    if(best>=0){this.selection=best;this.focusSelection();}
    // DOM-free/flex-list fallback for zero-sized nodes and non-grid menus.
    else if(this.phase!=='select'&&axis==='y'&&buttons.length>1){
      this.selection=(this.selection+sign+buttons.length)%buttons.length;
      this.focusSelection();
    }
  }
  button(label,action,disabled=false){return `<button data-menu data-action="${action}" ${disabled?'disabled':''}>${label}</button>`;}
  render(){
    document.body.dataset.screen=this.phase;this.root.hidden=this.active;
    this.timer.hidden=!this.active;this.updateTimer();
    this.root.className=this.phase==='title'?'title-screen':this.phase==='tutorial'?'tutorial-screen':this.phase==='select'?'loadout-screen':'menu-screen';
    if(this.active)return;
    let title='',body='';
    if(this.phase==='title') {
      body=`<button class="art-hit art-start" data-menu data-action="start" aria-label="Start Game — 90 seconds" ${this.ready?'':'disabled'}><span>START GAME</span></button><button class="art-hit art-back" data-menu data-action="launcher" aria-label="Back to Game Selection"><span>BACK TO GAME SELECTION</span></button><div class="title-tools">${this.button('TUTORIAL','tutorial')}${this.button('OPTIONS / PRACTICE','options')}</div><p class="title-status" role="status">${this.ready?'':this.loadError?'Unable to load the park. Reload to retry.':'Loading the rooftop…'}</p>`;
    } else if(this.phase==='select') {
      const cards=this.heroes.map((hero,i)=>`<button data-menu data-action="hero" data-index="${i}" class="loadout-character ${this.heroConfirmed&&i===this.heroIndex?'is-chosen':''}"
        style="--rider-accent:${hero.accent}" aria-pressed="${this.heroConfirmed&&i===this.heroIndex}">
        <span class="rider-portrait" data-portrait-url="${safe(hero.url)}"><span class="rider-initial">${safe(hero.name[0]||'?')}</span></span>
        <strong>${safe(hero.name)}</strong><small>${safe(hero.subtitle)}</small></button>`).join('');
      const colors=BOARD_CHOICES.map((board,i)=>`<button data-menu data-action="board" data-index="${i}" class="loadout-deck ${this.boardConfirmed&&i===this.boardIndex?'is-chosen':''}"
        style="--deck-gradient:${board.gradient}" aria-pressed="${this.boardConfirmed&&i===this.boardIndex}"><span class="deck-preview"></span><b>${safe(board.label)}</b></button>`).join('');
      const spots=LOCATIONS.map((spot,i)=>`<button data-menu data-action="location" data-index="${i}"
        class="loadout-location ${i===this.locationIndex?'is-chosen':''}" ${spot.available?'':'disabled'} aria-pressed="${i===this.locationIndex}">
        <strong>${safe(spot.name)}</strong><small>${safe(spot.subtitle)}</small></button>`).join('');
      body=`<div class="loadout-shell"><header><small>CHIMP HAWK · YOUR NEXT SESSION</small><h2>BUILD YOUR LINE</h2>
        <p>CHOOSE YOUR RIDER · YOUR DECK · YOUR SPOT</p></header>
        <div class="loadout-section"><div class="loadout-heading"><b>01 / CHOOSE YOUR RIDER</b><button data-menu data-action="upload">↑ UPLOAD YOUR CHARACTER AVATAR .GLB FILE</button></div>
        <div class="loadout-roster">${cards}</div></div>
        <div class="loadout-section"><div class="loadout-heading"><b>02 / GRADIENT GLOW SKATEBOARD</b><span>+20% DECK SIZE</span></div>
        <div class="loadout-boards">${colors}</div></div>
        <div class="loadout-section"><div class="loadout-heading"><b>03 / CHOOSE A LOCATION</b><span>MORE PARKS COMING</span></div>
        <div class="loadout-locations">${spots}</div></div>
        <footer>${this.button('← BACK','back')}${this.button(this.selectBusy?'LOADING RIDER…':'CONTINUE TO TUTORIAL →','confirmLoadout',this.selectBusy||!this.heroConfirmed||!this.boardConfirmed)}</footer>
        <p class="loadout-status" aria-live="polite">${safe(this.selectError||(!this.heroConfirmed||!this.boardConfirmed?'Choose a rider and a deck with A / Enter / Click to unlock CONTINUE.':'Rider and deck selected · Continue to tutorial.'))}</p></div>`;
    } else if(this.phase==='pause') {
      title='PAUSED';body=this.button('RESUME','resume')+this.button('TUTORIAL','tutorial')
        +this.button('MASTER VOL −','volumeDown')
        +this.button('MASTER '+Math.round(this.music.masterVolume*100)+'%','volumeUp')
        +this.button('MASTER VOL +','volumeUp')
        +this.button('OPTIONS','options')+this.button('RESTART RUN','restart')+this.button('MAIN MENU','title');
    } else if(this.phase==='options') {
      title='OPTIONS';body=this.button('PRACTICE · NO TIME LIMIT','practice',!this.ready)
        +this.button('CAMERA · '+CAMERA_LABELS[this.cameraIndex],'camera')
        +this.button('MASTER VOLUME −','volumeDown')
        +this.button('MASTER · '+Math.round(this.music.masterVolume*100)+'%','volumeUp')
        +this.button('MASTER VOLUME +','volumeUp')
        +this.button('SKATE SOUNDS · '+(this.sound?'ON':'OFF'),'sound')
        +this.button('DECK · '+BOARD_CHOICES[this.finishIndex].label,'deck')
        +this.button('BACK','back');
    } else if(this.phase==='results') {
      title='TIME’S UP';body=`<p class="result-score">${this.finalScore.toLocaleString()}<small>POINTS BANKED</small></p>`
        +this.button('RUN IT AGAIN · 90 SEC','start')+this.button('PRACTICE','practice')+this.button('MAIN MENU','title');
    } else if(this.phase==='tutorial') {
      const page=this.pages[this.page];
      const navigation=`<footer>${this.button('← PREVIOUS','previous',this.page===0)}<span>LB / RB OR LEFT / RIGHT · B / ESC BACK</span>${this.button(this.page===this.pages.length-1?(this.pendingMode?'LET’S SKATE':'BACK TO GAME'):'DETAILS / NEXT →',this.page===this.pages.length-1?'closeTutorial':'next')}</footer>`;
      body=page.image?`<div class="tutorial-poster"><img src="${page.image}" alt="Complete keyboard and Xbox trick guide. Next opens readable tables for each section.">${navigation}</div>`:`<div class="tutorial-frame"><header><small>CHIMP HAWK / TUTORIAL ${this.page+1} OF ${this.pages.length}</small><h2>${page.title}</h2><p>${page.subtitle}</p></header><div class="tutorial-body">${page.html}</div>${navigation}</div>`;
    }
    this.content.innerHTML=['title','tutorial','select'].includes(this.phase)?body:`<div class="menu-card"><small>CHIMP HAWK / UNDERGROUND</small><h2>${title}</h2>${body}</div>`;
    for(const button of this.menuButtons()) {
      button.onclick=()=>this.choose(button.dataset.action,Number(button.dataset.index||0));
      button.onpointerenter=()=>{this.selection=this.menuButtons().indexOf(button);this.focusSelection();};
    }
    if(this.phase==='select')this.loadPortraits();
    if(this.phase==='tutorial')this.selection=this.menuButtons().length-1;
    if(this.focusHint){
      const index=this.menuButtons().findIndex(button=>button.dataset.action===this.focusHint.action
        && Number(button.dataset.index||0)===this.focusHint.index);
      if(index>=0)this.selection=index;
      this.focusHint=null;
    }
    this.focusSelection();
  }
  begin(practice=false){
    if(!this.ready)return;
    this.pendingMode=practice?'practice':'timed';
    this.selectError='';this.heroConfirmed=false;this.boardConfirmed=false;
    this.focusHint={action:'hero',index:this.heroIndex};
    this.setScreen('select');
  }
  async loadPortraits(){
    for(const el of this.content.querySelectorAll('[data-portrait-url]')){
      const url=el.dataset.portraitUrl;
      if(!url)continue;
      characterPortrait(url).then(image=>{
        if(!el.isConnected)return;
        const thumb=document.createElement('img');
        thumb.src=image;thumb.alt='';thumb.draggable=false;
        el.replaceChildren(thumb);
      }).catch(()=>{}); // Monogram remains visible if a model is unavailable.
    }
  }
  async confirmLoadout(){
    if(this.selectBusy||this.phase!=='select')return;
    const hero=this.heroes[this.heroIndex];
    const board=BOARD_CHOICES[this.boardIndex];
    const location=LOCATIONS[this.locationIndex];
    if(!this.heroConfirmed||!this.boardConfirmed||!hero||!location?.available)return;
    this.selectBusy=true;this.selectError='Loading '+hero.name+'…';this.render();
    try{
      await this.actions.loadout({hero,board,location});
      this.selectBusy=false;this.selectError='';
      this.finishIndex=board.finishIndex;
      this.tutorialSeen=false;
      this.openTutorial();
    }catch(error){
      this.selectBusy=false;
      this.selectError='Cannot load '+hero.name+': '+(error?.message||'Invalid or missing GLB.');
      this.render();
    }
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
  back(){if(this.phase==='tutorial'){this.pendingMode=null;this.closeTutorial();}else if(this.phase==='options')this.setScreen(this.optionsReturn||'title');else if(this.phase==='pause')this.resume();else if(this.phase==='results')this.choose('title');else if(this.phase==='select')this.setScreen('title');else if(this.phase==='title')this.choose('launcher');}
  choose(action,index=0){
    this.music.unlock();
    switch(action){
      // Same game-selection destination used by CyberArtsBR/Skate's launcher.
      case 'launcher':window.location.assign('https://chimp-jump.onrender.com/');break;
      case 'start':this.begin(false);break;case 'practice':this.begin(true);break;
      case 'hero':this.heroIndex=index;this.heroConfirmed=true;this.focusHint={action:'hero',index};this.render();break;
      case 'board':this.boardIndex=index;this.boardConfirmed=true;this.focusHint={action:'board',index};this.render();break;
      case 'location':if(LOCATIONS[index]?.available){this.locationIndex=index;this.focusHint={action:'location',index};this.render();}break;
      case 'upload':this.avatarInput.click();break;
      case 'confirmLoadout':void this.confirmLoadout();break;
      case 'restart':this.start(this.practice);break;case 'resume':this.resume();break;
      case 'tutorial':this.openTutorial();break;
      case 'options':this.optionsReturn=this.phase;this.setScreen('options');break;
      case 'camera':this.cameraIndex=(this.cameraIndex+1)%CAMERAS.length;this.actions.camera(CAMERAS[this.cameraIndex]);this.render();break;
      case 'volumeDown':this.adjustMaster(-.1);break;
      case 'volumeUp':this.adjustMaster(.1);break;
      case 'sound':this.sound=!this.sound;this.actions.sound(this.sound);this.render();break;
      case 'deck':this.finishIndex=(this.finishIndex+1)%BOARD_CHOICES.length;this.actions.deck(this.finishIndex);this.render();break;
      case 'title':this.actions.pause(true);this.setScreen('title');break;
      case 'back':this.back();break;
      case 'previous':this.page=Math.max(0,this.page-1);this.render();break;
      case 'next':this.page=Math.min(this.pages.length-1,this.page+1);this.render();break;
      case 'closeTutorial':this.closeTutorial();break;
    }
  }
  adjustMaster(step){
    this.music.setMasterVolume(Math.round(Math.max(0,Math.min(1,this.music.masterVolume+step))*100)/100);
    this.actions.masterVolume?.(this.music.masterVolume);
    this.render();
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
      else if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD'].includes(event.code)){
        const axis=['ArrowLeft','ArrowRight','KeyA','KeyD'].includes(event.code)?'x':'y';
        this.moveSelection(axis,['ArrowUp','ArrowLeft','KeyW','KeyA'].includes(event.code)?-1:1);
      }
      else if(event.code==='Enter'||event.code==='Space')this.menuButtons()[this.selection]?.click();
    }
  }
  updateTimer(){this.timer.textContent=this.practice?'PRACTICE · ∞':`${Math.floor(Math.ceil(this.remaining)/60)}:${String(Math.ceil(this.remaining)%60).padStart(2,'0')}`;this.timer.classList.toggle('time-low',!this.practice&&this.remaining<=15);}
  update(dt){
    this.inputGrace=Math.max(0,this.inputGrace-dt);this.navRepeat=Math.max(0,this.navRepeat-dt);
    const focused=document.hasFocus();
    const pad=[...(navigator.getGamepads?.()||[])].find(p=>p?.connected);
    const b=i=>!!pad?.buttons[i]?.pressed;
    const stickX=pad?.axes?.[0]||0,stickY=pad?.axes?.[1]||0;
    const keys={a:b(0),back:b(1),select:b(8),start:b(9),
      shoulderLeft:b(4),shoulderRight:b(5),
      up:b(12)||stickY<-.65,down:b(13)||stickY>.65,
      left:b(14)||stickX<-.65,right:b(15)||stickX>.65};
    // Read the physical state even when unfocused so regaining focus cannot
    // synthesize a stale edge from a button held while the tab was inactive.
    if(!focused){this.padFocused=false;this.previousPad=keys;this.navRepeat=.22;return;}
    if(!this.padFocused){this.previousPad=keys;this.padFocused=true;}
    const edge=k=>keys[k]&&!this.previousPad[k];
    if(Object.keys(keys).some(edge))this.music.unlock();
    if(edge('select'))this.music.next();
    if(!this.active){
      const direction=keys.left?'left':keys.right?'right':keys.up?'up':keys.down?'down':null;
      if(this.open){
        if(edge('back'))this.back();
        else if(edge('shoulderLeft')||edge('left'))this.choose('previous');
        else if(edge('shoulderRight')||edge('right'))this.choose('next');
        else if(edge('a'))this.menuButtons()[this.selection]?.click();
      } else {
        if(direction&&(!this.navRepeat||edge(direction))){
          this.moveSelection(direction==='left'||direction==='right'?'x':'y',
            direction==='left'||direction==='up'?-1:1);
          this.navRepeat=.22;
        }
        if(edge('back'))this.back();
        else if(edge('a'))this.menuButtons()[this.selection]?.click();
        else if(edge('start')&&this.phase==='pause')this.resume();
      }
    }
    this.previousPad=keys;
    if(this.active&&!this.practice&&document.hasFocus()){
      this.remaining=Math.max(0,this.remaining-dt);this.updateTimer();
      if(!this.remaining){this.finalScore=this.actions.score();this.actions.pause(true);this.music.next();this.setScreen('results');}
    }
  }
}
