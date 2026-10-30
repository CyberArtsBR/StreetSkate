import { gameAssetUrl } from './AssetPaths.js';
import { tutorialPages } from './TutorialPages.js';
import { FlipSchoolPlayer, renderFlipSchool } from './FlipSchool.js';
import { FLIP_LESSONS } from './FlipLessons.js';
import { nextMenuIndex } from '../input/MenuNavigation.js';
import { MusicPlayer } from './MusicPlayer.js';
import { readAudioVolume, saveAudioVolume } from './AudioSettings.js';
import { DEFAULT_BOARD_FINISH } from '../skateboard/BoardFinishes.js';
import { sessionWarning, countdownCrossing } from './SessionCountdown.js';
import { setHudGlyphValue } from './HudGlyphs.js';
import { isValidGlbHeader } from '../input/GlbHeader.js';
import { inspectGlb } from '../../tools/agent10-glb-inspector.mjs';
import { DEFAULT_CHARACTERS, BOARD_CHOICES, LOCATIONS } from './LoadoutCatalog.js';
import { characterPortrait, forgetCharacterPortrait } from './CharacterPortraits.js';
import { boardPortraits } from './BoardPortraits.js';
import { graffitiLettering } from './GraffitiLettering.js';
import { GRAPHICS_PRESET_ORDER, GRAPHICS_PRESETS, GRAPHICS_DESCRIPTIONS, DEFAULT_GRAPHICS_PRESET } from '../graphics/GraphicsSettings.js';
import { RUN_SCORE_RULES } from './RunFinalScore.js';
import { STICK_DEAD_ZONES } from '../input/SkateInput.js';

const safe = value => String(value).replace(/[&<>"']/g, ch =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

const stored = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const persist = (key, value) => { try { localStorage.setItem(key, String(value)); } catch {} };
const CAMERAS=['follow','classic','fixed'];
const CAMERA_LABELS=['Follow','Classic','Fixed'];
const number = value => Number.isFinite(Number(value)) ? Math.max(0,Number(value)) : 0;
const points = value => Math.round(number(value)).toLocaleString();
const seconds = value => `${number(value).toFixed(1)} s`;
const meters = value => number(value)>=1000 ? `${(number(value)/1000).toFixed(2)} km` : `${Math.round(number(value))} m`;
export class GameShell {
  constructor(actions) {
    this.actions=actions;this.phase='title';this.ready=false;this.practice=false;this.remaining=90;
    this.selection=0;this.previousPad={};this.padFocused=false;this.padIdentity=null;this.navRepeat=0;this.tutorialSeen=false;this.page=0;
    this.pages=[{image:gameAssetUrl('/media/trick-guide-16x9.png')},...tutorialPages()];
    this.flipLessonIndex=0;this.flipInputMode='xbox';this.flipPlayer=null;
    this.cameraIndex=Math.max(0,CAMERAS.indexOf(stored('streetskate.camera','follow')));
    this.graphicsIndex=GRAPHICS_PRESET_ORDER.indexOf(DEFAULT_GRAPHICS_PRESET);
    this.bloomEnabled=stored('streetskate.bloomEnabled','on')!=='off';
    this.smoothEdges=stored('streetskate.smoothEdges','off')==='on';
    this.songToastRemaining=4;
    this.sound=stored('streetskate.sound','on')!=='off';
    const savedFinish=Number(stored('streetskate.boardFinish',DEFAULT_BOARD_FINISH));
    this.finishIndex=Number.isInteger(savedFinish)&&savedFinish>=0&&savedFinish<BOARD_CHOICES.length?savedFinish:DEFAULT_BOARD_FINISH;
    this.inputGrace=0;
    this.effectsVolume=readAudioVolume('effects');
    this.heroes=[...DEFAULT_CHARACTERS];this.heroIndex=0;this.boardIndex=this.finishIndex;this.locationIndex=0;
    this.selectBusy=false;this.selectError='';this.avatarUrl=null;this.pendingMode=null;
    this.loadoutGeneration=0;this.avatarUploadGeneration=0;
    this.mapUploadGeneration=0;this.mapUploadBusy=false;this.mapUploadStatus='';this.testMapName=null;
    this.runSummary=null;this.timeupEndsAt=0;this.replayDisplayKey='';
    this.heroConfirmed=false;this.boardConfirmed=false;this.focusHint=null;
    this.root=document.createElement('section');this.root.id='game-shell';this.root.setAttribute('aria-label','Game menu');
    this.root.innerHTML='<div class="title-art"></div><div class="shell-content"></div><div class="menu-footnote">↑ ↓ ← → / LEFT STICK · ENTER / A SELECT · ESC / B BACK</div>';
    document.body.append(this.root);this.content=this.root.querySelector('.shell-content');
    this.timer=document.createElement('div');this.timer.id='run-timer';this.timer.setAttribute('role','timer');
    this.timerValue=document.createElement('span');this.timer.append(this.timerValue);document.querySelector('#app').append(this.timer);
    this.song=document.createElement('aside');this.song.id='now-playing';this.song.setAttribute('aria-label','Soundtrack');
    this.song.innerHTML='<span class="song-emblem" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M10 17V6l10-2v11M10 9l10-2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="7" cy="17" rx="3" ry="2.5" fill="currentColor"/><ellipse cx="17" cy="15" rx="3" ry="2.5" fill="currentColor"/></svg></span><div class="song-copy"><span class="song-label">NOW PLAYING</span><strong class="song-title" aria-live="polite"></strong><span class="song-skip">Press <kbd>Select</kbd> / <kbd>Backspace</kbd> to skip</span><span class="song-note" hidden></span></div>';
    document.body.append(this.song);
    const songTitle=this.song.querySelector('.song-title'),songNote=this.song.querySelector('.song-note');
    this.music=new MusicPlayer((title,note)=>{
      songTitle.textContent=title;songNote.textContent=note||'';songNote.hidden=!note;
      this.songToastRemaining=4;this.song.classList.remove('song-compact');
    });
    this.avatarInput=document.createElement('input');
    this.avatarInput.type='file';this.avatarInput.accept='.glb,model/gltf-binary';this.avatarInput.hidden=true;
    document.body.append(this.avatarInput);
    this.avatarInput.addEventListener('change',async()=>{
      // Even a rejected replacement cancels the previous asynchronous read.
      const uploadGeneration=++this.avatarUploadGeneration;
      const file=this.avatarInput.files?.[0];this.avatarInput.value='';
      if(!file)return;
      if(file.size>35*1024*1024 || file.size<20 || !/\.glb$/i.test(file.name)) {
        this.selectError='Choose a rigged .GLB file smaller than 35 MB.';this.render();return;
      }
      // Validate both the header and the full GLB structure *before* exposing
      // untrusted bytes to GLTFLoader or creating a persistent object URL.
      // The inspector rejects external/data URI resources and oversized rigs.
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
      if(this.avatarUrl){
        forgetCharacterPortrait(this.avatarUrl);
        URL.revokeObjectURL(this.avatarUrl);
      }
      this.avatarUrl=next;
      this.heroes=this.heroes.filter(h=>h.id!=='custom');
      this.heroes.push({id:'custom',name:file.name.replace(/\.glb$/i,''),subtitle:'YOUR UPLOADED RIDER',url:next,uploadFilename:file.name,accent:'#ffc469'});
      this.heroIndex=this.heroes.length-1;this.heroConfirmed=false;
      this.focusHint={action:'hero',index:this.heroIndex};
      this.selectError='Avatar ready · select this rider with A / Enter / Click before continuing.';
      this.render();
    });
    this.mapInput=document.createElement('input');
    this.mapInput.type='file';this.mapInput.accept='.glb,model/gltf-binary';this.mapInput.hidden=true;
    this.mapInput.setAttribute('aria-label','Choose a test map GLB');
    document.body.append(this.mapInput);
    this.mapInput.addEventListener('change',()=>{
      const file=this.mapInput.files?.[0];this.mapInput.value='';
      if(file)this.uploadTestMap(file);
    });
    window.addEventListener('keydown',e=>this.key(e),true);
    this.render();
  }
  get active(){return this.phase==='playing';}
  get open(){return this.phase==='tutorial';}
  setReady(){this.ready=true;this.render();}
  setScreen(phase){
    if(this.phase==='options'&&phase!=='options'&&this.mapUploadBusy){
      this.mapUploadGeneration++;this.mapUploadBusy=false;this.mapUploadStatus='';this.actions.cancelLoadout?.();
    }
    if(this.phase==='highlights'&&phase!=='highlights')this.actions.stopHighlights?.();
    // Leaving the selector invalidates any pending rider swap's UI completion.
    // A previously started loader may still resolve, but must never reopen a
    // tutorial or overwrite the player's new screen after Back/Escape.
    if(this.phase==='select'&&phase!=='select'){
      this.loadoutGeneration++;
      if(this.selectBusy)this.actions.cancelLoadout?.();
      this.selectBusy=false;
    }
    this.phase=phase;this.selection=0;this.navRepeat=.2;this.render();
  }
  menuButtons(){return [...this.content.querySelectorAll('button[data-menu]')].filter(b=>!b.disabled);}
  focusSelection(reveal=true){
    const buttons=this.menuButtons();
    if(!buttons.length){this.selection=0;return;}
    this.selection=(this.selection+buttons.length)%buttons.length;
    buttons.forEach((b,i)=>b.classList.toggle('selected',i===this.selection));
    const target=buttons[this.selection];
    target?.focus({preventScroll:true});
    // Controller focus may be below the fold in the scrollable loadout.
    // Reveal it without scrolling the entire window or stealing pointer focus.
    if(reveal&&['select','pause','options','graphics','results','flipSchool','tutorial'].includes(this.phase))
      target?.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'auto'});
  }
  // Keyboard and gamepad share the same logical layout-aware focus route.
  moveSelection(axis, sign) {
    const buttons=this.menuButtons();
    if(!buttons.length)return;
    const focusedIndex=buttons.indexOf(document.activeElement);
    if(focusedIndex>=0)this.selection=focusedIndex;
    this.selection=nextMenuIndex(buttons,this.selection,axis,sign,this.phase==='select');
    this.focusSelection();
  }
  button(label,action,disabled=false){return `<button data-menu data-action="${action}" ${disabled?'disabled':''}>${label}</button>`;}
  volumeControl(channel, label, value){
    return `<div class="audio-volume-control" role="group" aria-label="${label} volume">
      <span>${label} <strong>${Math.round(value*100)}%</strong></span>
      <button data-menu data-action="${channel}Down" aria-label="Decrease ${label.toLowerCase()} volume">−</button>
      <button data-menu data-action="${channel}Up" aria-label="Increase ${label.toLowerCase()} volume">+</button>
      <span class="audio-meter" aria-hidden="true" style="--volume:${Math.round(value*100)}%"></span></div>`;
  }
  boardLabel(){return BOARD_CHOICES[this.boardIndex]?.label||'';}
  locationName(){return this.testMapName||LOCATIONS[this.locationIndex]?.name||'';}
  renderMenuFrame(title, body){
    const hero=this.heroes[this.heroIndex];
    const spot=LOCATIONS[this.locationIndex];
    const captions={pause:'Take a breath. Your next line is waiting.',options:'Your setup. Your sound. Your session.',graphics:'Set the look. Find your flow.'};
    return `<div class="menu-stage">
      <aside class="menu-session-art" data-location="${safe(spot.id)}" aria-label="Session preview">
        <span class="menu-art-kicker">CHIMP HAWK / UNDERGROUND</span>
        <div class="menu-art-title" aria-hidden="true">${this.phase==='pause'?'STAY<br>IN FLOW.':'MAKE<br>IT YOURS.'}</div>
        <span class="menu-rider" style="--rider-accent:${hero.accent}" data-portrait-url="${safe(hero.url)}" data-preview-state="loading"></span>
        <div class="menu-art-caption"><span>YOUR SESSION</span><strong>${safe(hero.name)}</strong><small>${safe(this.locationName())}</small></div>
        <span class="menu-art-stamp" aria-hidden="true">SKATE / REPEAT</span><div class="menu-music-slot"></div>
      </aside>
      <div class="menu-card ${this.phase==='graphics'?'graphics-card':''}"><header class="menu-card-heading"><small>THE SESSION LAB</small><h2>${safe(title)}</h2><p>${captions[this.phase]||''}</p></header>${body}</div>
    </div>`;
  }
  render(){
    this.flipPlayer?.dispose();this.flipPlayer=null;
    // Keep the music panel alive while replacing menu contents; selection
    // screens give it a layout slot so it never covers their heading/cards.
    if(this.song&&this.song.parentElement!==document.body)document.body.append(this.song);
    document.body.dataset.screen=this.phase;this.root.hidden=this.active;
    this.actions.screenChanged?.(this.phase);
    this.timer.hidden=!this.active;this.updateTimer();
    this.song.classList.remove('song-compact');this.songToastRemaining=4;
    this.root.className=this.phase==='title'?'title-screen':this.phase==='tutorial'?'tutorial-screen':this.phase==='select'?'loadout-screen':this.phase==='results'?'results-screen':this.phase==='timeup'?'timeup-screen':this.phase==='highlights'?'highlights-screen':'menu-screen';
    if(this.phase==='flipSchool')this.root.className='flip-school-screen';
    this.root.classList.toggle('run-art-screen',['select','pause','timeup','results'].includes(this.phase));
    if(this.active)return;
    let title='',body='';
    if(this.phase==='title') {
      body=`<button class="art-hit art-start" data-menu data-action="start" aria-label="Start Game — 90 seconds" ${this.ready?'':'disabled'}><span>START GAME</span></button><button class="art-hit art-back" data-menu data-action="launcher" aria-label="Back to Game Selection"><span>BACK TO GAME SELECTION</span></button><div class="title-tools">${this.button('PRACTICE','practice',!this.ready)}${this.button('TUTORIAL','tutorial')}${this.button('OPTIONS','options')}${this.actions.portalsAvailable?.()?this.button('PORTALS RANKINGS','portals'):''}${this.actions.portalsOnlineAvailable?.()?this.button('PLAY ONLINE · BETA','online'):''}</div><p class="title-status" role="status">${this.ready?'':this.loadError?`Unable to load the park: ${safe(this.loadErrorDetail||'Reload to retry.')}`:'Loading Skate Paradise…'}</p>`;
    } else if(this.phase==='select') {
      const cards=this.heroes.map((hero,i)=>`<button data-menu data-action="hero" data-index="${i}" class="loadout-character ${this.heroConfirmed&&i===this.heroIndex?'is-chosen':''}"
        style="--rider-accent:${hero.accent}" aria-pressed="${this.heroConfirmed&&i===this.heroIndex}">
        <span class="rider-portrait" data-portrait-url="${safe(hero.url)}" data-preview-state="loading"><span class="rider-initial">${safe(hero.name[0]||'?')}</span><span class="preview-status">Loading preview…</span></span>
        <strong>${safe(hero.name)}</strong><small>${safe(hero.subtitle)}</small></button>`).join('');
      const colors=BOARD_CHOICES.map((board,i)=>`<button data-menu data-action="board" data-index="${i}" class="loadout-deck ${this.boardConfirmed&&i===this.boardIndex?'is-chosen':''}"
        style="--deck-gradient:${board.gradient}" aria-pressed="${this.boardConfirmed&&i===this.boardIndex}"><span class="deck-thumb" data-board-preview="${i}"><span class="deck-preview"></span></span><b>${safe(board.label)}</b><span class="deck-swatch" aria-hidden="true"></span></button>`).join('');
      const spots=LOCATIONS.map((spot,i)=>`<button data-menu data-action="location" data-index="${i}"
        data-location="${safe(spot.id)}" class="loadout-location ${i===this.locationIndex?'is-chosen':''}" ${spot.available?'':'disabled'} aria-pressed="${i===this.locationIndex}">
        <span class="location-art" aria-hidden="true"><span class="map-number">MAP ${String(spot.number).padStart(2,'0')}</span><span class="location-stamp">${spot.id==='skate-paradise'?'SUNSET / SKATEPARK':spot.id==='rooftop'?'STEEL / FREIGHT':spot.id === 'grand-warehouse' ? 'ARTIST BUILD' : 'AFTER HOURS'}</span></span><strong>${safe(spot.name)}</strong><small>${safe(spot.subtitle)}</small></button>`).join('');
      body=`<div class="loadout-shell"><header><small>CHIMP HAWK / THE SESSION LAB <span class="session-mode">${this.pendingMode==='practice'?'FREE SKATE':'90 SECOND RUN'}</span></small><h2>${graffitiLettering('BUILD YOUR LINE')}</h2>
        <p>PICK YOUR RIDER. PAINT YOUR DECK. OWN YOUR SPOT.</p><div class="music-menu-slot"></div></header>
        <div class="loadout-panels">
        <section class="loadout-section rider-panel" aria-label="Choose your rider"><div class="loadout-heading"><span class="section-number">01</span><h3>${graffitiLettering('RIDER','gold')}</h3><span class="panel-kicker">THE CREW</span></div>
        <div class="selected-rider" style="--rider-accent:${this.heroes[this.heroIndex].accent}"><span class="rider-stage-number" aria-hidden="true">${String(this.heroIndex+1).padStart(2,'0')}</span>
          <span class="rider-portrait" data-portrait-url="${safe(this.heroes[this.heroIndex].url)}" data-preview-state="loading"><span class="preview-status">Loading preview…</span></span>
          <div class="selected-rider-copy"><span>${this.heroConfirmed?'YOUR RIDER':'MEET THE CREW'}</span><strong>${safe(this.heroes[this.heroIndex].name)}</strong><small>${safe(this.heroes[this.heroIndex].subtitle)}</small></div>
        </div><div class="loadout-roster">${cards}</div>${this.button('↑ IMPORT YOUR RIDER .GLB','upload')}</section>
        <section class="loadout-section deck-panel" aria-label="Choose your skateboard"><div class="loadout-heading"><span class="section-number">02</span><h3>${graffitiLettering('DECK','gold')}</h3><span class="panel-kicker">GRADIENT GLOW</span></div>
        <div class="loadout-boards">${colors}</div><div class="selection-note"><span>${this.boardConfirmed?'DECK LOCKED IN':'CHOOSE YOUR FINISH'}</span><strong>${safe(BOARD_CHOICES[this.boardIndex].label)}</strong></div></section>
        <section class="loadout-section spot-panel" aria-label="Choose your location"><div class="loadout-heading"><span class="section-number">03</span><h3>${graffitiLettering('SPOT','gold')}</h3><span class="panel-kicker">THREE PARKS. YOUR LINE.</span></div>
        <div class="loadout-locations">${spots}</div><div class="selection-note"><span>SESSION LOCATION</span><strong>MAP ${LOCATIONS[this.locationIndex].number} / ${safe(LOCATIONS[this.locationIndex].name)}</strong></div></section></div>
        <footer>${this.button('← BACK','back')}<div class="loadout-recap"><span class="loadout-checks"><span class="${this.heroConfirmed?'complete':''}">${this.heroConfirmed?'✓':'01'} RIDER</span><span class="${this.boardConfirmed?'complete':''}">${this.boardConfirmed?'✓':'02'} DECK</span><span class="complete">✓ SPOT</span></span><span>${safe(this.heroes[this.heroIndex].name)} <i>/</i> ${safe(BOARD_CHOICES[this.boardIndex].label)} <i>/</i> MAP ${LOCATIONS[this.locationIndex].number}</span></div>${this.button(this.selectBusy?'LOADING RIDER…':'LET’S SKATE →','confirmLoadout',this.selectBusy||!this.heroConfirmed||!this.boardConfirmed)}</footer>
        <p class="loadout-status" aria-live="polite">${safe(this.selectError||(!this.heroConfirmed||!this.boardConfirmed?'Choose a rider and a deck with A / Enter / Click to unlock START SESSION.':'Rider and deck selected · Ready to start session.'))}</p></div>`;
    } else if(this.phase==='pause') {
      title='PAUSED';body=this.button('▶ RESUME SESSION','resume')+this.button('RESTART SESSION','restart')+
        (this.practice?this.button('PRACTICE DRILLS · '+(this.actions.drillsEnabled?.()?'ON':'OFF'),'practiceDrills'):'')+
        (this.practice?this.button('INPUT DISPLAY · '+(this.actions.practiceInputsEnabled?.()?'ON':'OFF'),'practiceInputs'):'')+
        this.button('FLIP SCHOOL · VIDEO LESSONS','flipSchool')+this.button('TUTORIAL','tutorial')+this.button('OPTIONS & AUDIO','options')+this.button('MAIN MENU','title');
    } else if(this.phase==='options') {
      title='OPTIONS';body='<div class="menu-control-group"><h3>SESSION</h3>'+this.button('PRACTICE · NO TIME LIMIT','practice',!this.ready)
        +this.button(this.mapUploadBusy?'LOADING TEST MAP…':'UPLOAD TEST MAP · GLB','uploadTestMap',!this.ready||this.mapUploadBusy)
        +`<p class="test-map-note" role="status" aria-live="polite">${safe(this.mapUploadStatus||'Local GLB · random rider & deck · unlimited practice')}</p>`
        +'<div class="menu-setting-pair">'+this.button('CAMERA · '+CAMERA_LABELS[this.cameraIndex],'camera')
        +this.button('GRAPHICS · '+GRAPHICS_PRESETS[GRAPHICS_PRESET_ORDER[this.graphicsIndex]].label.toUpperCase(),'graphicsMenu')+'</div>'
        +this.button('STICK DEAD ZONE · '+Math.round((this.actions.getDeadZone?.() ?? .16)*100)+'%','deadZone')+'</div>'
        +'<div class="menu-control-group"><h3>SOUND & FEEL</h3>'+this.volumeControl('music','MUSIC',this.music.musicVolume)
        +this.volumeControl('effects','EFFECTS',this.effectsVolume)
        +'<div class="menu-setting-pair">'+this.button('SKATE SOUNDS · '+(this.sound?'ON':'OFF'),'sound')
        +this.button('DECK · '+BOARD_CHOICES[this.finishIndex].label,'deck')+'</div></div>'
        +(this.actions.portalsAvailable?.()?this.button('PORTALS / TOP 10','portals'):'')+(this.actions.portalsOnlineAvailable?.()?this.button('PLAY ONLINE · BETA','online'):'')
        +this.button('BACK','back');
    } else if(this.phase==='graphics') {
      const key=GRAPHICS_PRESET_ORDER[this.graphicsIndex];
      const preset=GRAPHICS_PRESETS[key];
      const effective=this.actions.graphicsStatus?.();
      title='GRAPHICS';
      body='<p class="graphics-intro">Keep your line clear. Choose the detail and responsiveness that suit your display.</p>'
        +GRAPHICS_PRESET_ORDER.map((name,i)=>`<button class="graphics-preset" data-menu data-action="graphicsSet" data-index="${i}" aria-pressed="${i===this.graphicsIndex}"><strong>${i===this.graphicsIndex?'✓ ':''}${GRAPHICS_PRESETS[name].label}</strong><span>${GRAPHICS_DESCRIPTIONS[name]}</span></button>`).join('')
        +`<button class="graphics-toggle" data-menu data-action="bloomToggle" aria-pressed="${this.bloomEnabled}">NEON GLOW · ${this.bloomEnabled?'ON':'OFF'}</button>`
        +`<button class="graphics-toggle" data-menu data-action="edgeToggle" aria-pressed="${this.smoothEdges}">144 FPS EDGE SMOOTHING · ${this.smoothEdges?'ON':'OFF'}</button>`
        +'<p class="graphics-details">Optional 2× edge smoothing with glow in the 144 FPS preset; may reduce frame rate.</p>'
        +`<p class="graphics-details">${safe(effective?.label||preset.label)} · ${effective?.bloomEnabled?'Glow on':'Glow off'} · stable environment reflections.<br>144 FPS is a target; actual performance depends on your hardware and display.</p>`
        +(effective?`<details class="graphics-advanced"><summary>Rendering details</summary><p>${effective.renderWidth} × ${effective.renderHeight} internal resolution · ${effective.anisotropy}× filtering · ${effective.msaaSamples}× edge samples · 1024² local shadows${effective.postProcessingAvailable?'':' · post effects unavailable'}</p></details>`:'')
        +this.button('← BACK TO OPTIONS','back');
    } else if(this.phase==='timeup') {
      body=`<div class="timeup-burst" role="status" aria-live="assertive"><span class="session-eyebrow">SESSION COMPLETE</span><h2>${graffitiLettering('TIME’S UP','fire')}</h2><p>YOUR RUN. YOUR LINE. YOUR SCORE.</p><div class="timeup-rule" aria-hidden="true"></div></div>`;
    } else if(this.phase==='results') {
      body=this.renderResults();
    } else if(this.phase==='highlights') {
      body=`<div class="highlights-overlay"><header><span class="session-eyebrow">YOUR BEST MOMENTS</span><h2>SESSION HIGHLIGHTS</h2><p data-replay-caption aria-live="polite"></p></header><footer>${this.button('← BACK TO RESULTS','stopHighlights')}<span>ESC / B · BACK TO RESULTS</span></footer></div>`;
    } else if(this.phase==='flipSchool') {
      body=renderFlipSchool(this.flipLessonIndex,this.flipInputMode,this.flipTutorial);
    } else if(this.phase==='tutorial') {
      const page=this.pages[this.page];
      const returnLabel=this.tutorialReturn==='select'?'BACK TO LOADOUT':this.tutorialReturn==='playing'?'RESUME SESSION':this.tutorialReturn==='pause'?'BACK TO PAUSE':this.tutorialReturn==='options'?'BACK TO OPTIONS':this.tutorialReturn==='graphics'?'BACK TO GRAPHICS':this.tutorialReturn==='results'?'BACK TO RESULTS':'BACK TO MENU';
      const navigation=`<footer>${this.button('← PREVIOUS','previous')}${this.button('SKIP TUTORIAL','skipTutorial')}<span>LB / RB · B / ESC BACK</span>${this.button(this.page===this.pages.length-1?returnLabel:'DETAILS / NEXT →',this.page===this.pages.length-1?'closeTutorial':'next')}</footer>`;
      body=page.image?`<div class="tutorial-poster"><img src="${page.image}" alt="Complete keyboard and Xbox trick guide. Next opens readable tables for each section.">${navigation}</div>`:`<div class="tutorial-frame"><header><small>CHIMP HAWK / TUTORIAL ${this.page+1} OF ${this.pages.length}</small><h2>${page.title}</h2><p>${page.subtitle}</p>${this.page===2?this.button('FLIP SCHOOL · WATCH VIDEO LESSONS','flipSchool'):''}</header><div class="tutorial-body">${page.html}</div>${navigation}</div>`;
    }
    this.content.innerHTML=['title','tutorial','select','timeup','results','highlights','flipSchool'].includes(this.phase)?body:this.renderMenuFrame(title,body);
    if(this.phase==='select')this.content.querySelector('.music-menu-slot')?.append(this.song);
    else this.content.querySelector('.menu-music-slot')?.append(this.song);
    for(const button of this.menuButtons()) {
      button.onclick=()=>this.choose(button.dataset.action,Number(button.dataset.index||0));
      // Pointer hover must NOT call focus(): it steals controller/keyboard focus,
       // especially when a vertically scrolling loadout passes under the cursor.
       button.onfocus=()=>{
         const buttons=this.menuButtons(),index=buttons.indexOf(button);
         if(index<0)return;
         this.selection=index;
         buttons.forEach((b,i)=>b.classList.toggle('selected',i===index));
       };
    }
    if(this.phase==='select'){this.loadPortraits();this.loadBoardPreviews();}
    else if(['pause','options','graphics'].includes(this.phase))this.loadPortraits();
    if(this.phase==='flipSchool')this.flipPlayer=new FlipSchoolPlayer(this.content,this.flipLessonIndex,this.flipInputMode);
    if(this.phase==='tutorial')this.selection=this.menuButtons().length-1;
    if(this.focusHint){
      const index=this.menuButtons().findIndex(button=>button.dataset.action===this.focusHint.action
        && Number(button.dataset.index||0)===this.focusHint.index);
      if(index>=0)this.selection=index;
      this.focusHint=null;
    }
    if(this.phase==='results')this.content.scrollTop=0;
    this.focusSelection(this.phase!=='results');
  }
  renderResults(){
    const run=this.runSummary||{};
    const best=run.bestCombo||{};
    const achievements=Array.isArray(run.achievements)?run.achievements:[];
    const topTricks=Array.isArray(run.runTopTricks)?run.runTopTricks.slice(0,3):[];
    const highlights=Array.isArray(run.highlights)?run.highlights.slice(0,3):[];
    const highlightCount=Math.min(3,number(run.highlightsCount??highlights.length));
    const canReplay=this.actions.canWatchHighlights?.()??highlightCount>0;
    const finalScore=run.finalScore??run.totalScore??this.finalScore;
    const stats=[
      ['LANDED COMBOS',points(run.landedCombos)],['TRICKS LANDED',points(run.tricksLanded)],
      ['UNIQUE TRICKS',points(Array.isArray(run.uniqueTricks)?run.uniqueTricks.length:run.uniqueTricks)],['BAILS',points(run.bails)],
      ['TOP SPEED',`${number(run.topSpeedKmh).toFixed(1)} km/h`],['DISTANCE',meters(run.distanceMeters)],
      ['TOTAL AIR TIME',seconds(run.airTime)],['LONGEST AIR',seconds(run.maxAirTime)],
      ['GRIND DISTANCE',meters(run.grindDistanceMeters)],['MANUAL TIME',seconds(run.manualSeconds)]
    ].map(([label,value])=>`<div class="run-stat"><dt>${label}</dt><dd>${value}</dd></div>`).join('');
    const achievementRows=achievements.length?achievements.map((item,i)=>`<li><span class="achievement-number" aria-hidden="true">${String(i+1).padStart(2,'0')}</span><div><strong>${safe(item.title)}</strong><p>${safe(item.detail)}</p></div></li>`).join(''):`<li class="run-empty"><p>No scored achievements this run. Land a trick or link a combo to build your next session.</p></li>`;
    const topRows=topTricks.length?topTricks.map((item,i)=>`<li><span>${String(i+1).padStart(2,'0')}</span><strong>${safe(item.label)}</strong><b>${points(item.points)} <small>PTS</small></b></li>`).join(''):'<li class="run-empty"><p>No scored tricks landed.</p></li>';
    return `<article class="run-results" aria-label="Session results">
      <header class="run-results-header"><div><span class="session-eyebrow">CHIMP HAWK / SESSION COMPLETE</span><h2>${graffitiLettering('YOUR RUN','gold')}</h2><p>${safe(run.mapName||LOCATIONS[this.locationIndex]?.name||'')} <span>·</span> ${Math.round(number(run.durationSeconds??90))} SEC SESSION</p></div><div class="run-loadout"><strong>${safe(run.riderName||this.heroes[this.heroIndex]?.name||'')}</strong><span>${safe(run.deckName||BOARD_CHOICES[this.boardIndex]?.label||'')}</span>${this.button('▶ Watch the Highlights','watchHighlights',!canReplay)}</div></header>
      <div class="run-results-grid"><section class="run-score-panel"><span class="session-eyebrow">FINAL SCORE</span><p class="run-total-score result-score"><strong data-final-score>${points(finalScore)}</strong><span>FINAL POINTS${run.scoreBreakdown?' · RUN WEIGHTS APPLIED':''}</span></p>${this.renderScoreBreakdown(run)}<div class="run-best-combo"><span class="session-eyebrow">BEST COMBO</span><strong>${points(best.points)} <small>PTS</small></strong><p>${number(best.points)>0?safe(best.label||'Landed combo'):'No combo banked this run'}</p>${number(best.trickCount)>0?`<span>${points(best.trickCount)} tricks linked</span>`:''}</div><h3>THE RUN IN NUMBERS</h3><dl class="run-stats">${stats}</dl></section>
      <div class="run-detail-column"><section class="run-achievements"><h3>SESSION ACHIEVEMENTS</h3><ol>${achievementRows}</ol></section><section class="run-top-tricks"><h3>HIGHEST SCORING TRICKS</h3><ol>${topRows}</ol></section><section class="run-highlights"><span class="session-eyebrow">THE HIGHLIGHT REEL</span><p>${canReplay?`${highlightCount} best scored moment${highlightCount===1?'':'s'} · cinematic cameras & slow motion`:'Land a scored trick to capture your highlights.'}</p><small>${canReplay?'2.5 seconds before and after each moment, where the session allows.':'Highlights are recorded during this session only.'}</small></section></div></div>
      <footer class="run-results-actions">${this.button('RUN IT AGAIN · 90 SEC','restart')}${this.button('CHANGE RIDER / SPOT','start')}${this.button('PRACTICE','practice')}${this.actions.portalsAvailable?.()?this.button('PORTALS TOP 10','portals'):''}${this.button('MAIN MENU','title')}</footer></article>`;
  }
  renderScoreBreakdown(run){
    const score=run.scoreBreakdown;
    if(!score)return '';
    const multiplier=(number(score.multiplierPercent)/100).toFixed(2);
    const varietyCap=number(score.uniqueTrickCount)*RUN_SCORE_RULES.percentPerUniqueTrick>RUN_SCORE_RULES.maxVarietyBonusPercent;
    const row=(label,detail,value,kind='',valueAttribute='')=>`<div class="run-score-row ${kind}"><dt><strong>${label}</strong>${detail?`<small>${detail}</small>`:''}</dt><dd${valueAttribute?` ${valueAttribute}`:''}>${value}</dd></div>`;
    const rows=[
      row('POINTS BANKED','Score earned during the session',points(score.bankedScore),'','data-banked-score'),
      row('LANDED COMBOS',`${points(score.landedCombos)} × ${points(RUN_SCORE_RULES.pointsPerLandedCombo)} points`,`+${points(score.comboBonus)}`,'is-bonus'),
      row('TRICKS LANDED',`${points(score.tricksLanded)} × ${points(RUN_SCORE_RULES.pointsPerLandedTrick)} points`,`+${points(score.trickBonus)}`,'is-bonus'),
      row('BONUS SUBTOTAL','Banked points + landed bonuses',points(score.subtotal),'is-subtotal'),
      row('UNIQUE TRICKS',`${points(score.uniqueTrickCount)} different tricks · +${points(score.varietyBonusPercent)}%${varietyCap?' · cap reached':''}`,`×${multiplier}`,'is-bonus','class="score-multiplier"'),
      row('WEIGHTED SCORE',`${points(score.subtotal)} × ${multiplier} · rounded to whole points`,points(score.weightedScore),'is-subtotal'),
      row('BAILS',`${points(score.bails)} × ${points(RUN_SCORE_RULES.pointsPerBail)} point penalty`,`${number(score.bailPenalty)>0?'−':''}${points(score.bailPenalty)}`,'is-penalty'),
      row('FINAL SCORE','Weighted score − bail penalties',points(score.finalScore),'is-final')
    ].join('');
    return `<section class="run-score-breakdown" aria-label="Final score calculation"><h3>HOW YOUR RUN ADDS UP</h3><dl>${rows}</dl><p class="run-score-rule">Trick variety boosts the subtotal up to ×${((100+RUN_SCORE_RULES.maxVarietyBonusPercent)/100).toFixed(2)}. Bails subtract points after the multiplier. Final score never falls below zero.</p></section>`;
  }
  finishRun(){
    this.finalScore=number(this.actions.score());
    this.actions.pause(true);
    this.runSummary=this.actions.finishRun?.()||{totalScore:this.finalScore,durationSeconds:90};
    this.finalScore=number(this.runSummary.finalScore??this.runSummary.totalScore??this.finalScore);
    this.timeupEndsAt=performance.now()+3000;
    this.setScreen('timeup');
    this.actions.portalsFinish?.(this.runSummary, LOCATIONS[this.locationIndex]?.id);
  }
  showResults(){this.setScreen('results');}
  updateReplayCaption(){
    const status=this.actions.replayStatus?.();
    if(!status)return;
    const text=`${number(status.index)+1} / ${number(status.total)||Math.min(3,this.runSummary?.highlights?.length||0)} · ${status.label||'Best moment'}${status.points?` · ${points(status.points)} PTS`:''}`;
    if(text===this.replayDisplayKey)return;
    this.replayDisplayKey=text;
    const caption=this.content.querySelector('[data-replay-caption]');
    if(caption)caption.textContent=text;
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
        el.dataset.previewState='ready';
      }).catch(()=>{
        if(!el.isConnected)return;
        el.dataset.previewState='unavailable';
        const status=el.querySelector('.preview-status');
        if(status)status.textContent='Preview unavailable';
      });
    }
  }
  loadBoardPreviews(){
    const elements=[...this.content.querySelectorAll('[data-board-preview]')];
    boardPortraits().then(previews=>{
      for(const el of elements) if(el.isConnected){
        const image=document.createElement('img');image.src=previews[Number(el.dataset.boardPreview)];image.alt='';image.draggable=false;el.replaceChildren(image);
      }
    }).catch(()=>{});
  }
  setLocation(id,testMapName=null){const index=LOCATIONS.findIndex(spot=>spot.id===id);if(index>=0)this.locationIndex=index;this.testMapName=testMapName;this.root.dataset.location=id;}
  async uploadTestMap(file){
    if(this.phase!=='options'||!this.ready||this.mapUploadBusy)return;
    const generation=++this.mapUploadGeneration;
    const hero=DEFAULT_CHARACTERS[Math.floor(Math.random()*DEFAULT_CHARACTERS.length)];
    const board=BOARD_CHOICES[Math.floor(Math.random()*BOARD_CHOICES.length)];
    this.mapUploadBusy=true;this.mapUploadStatus='READING LOCAL MAP…';this.render();
    try{
      const result=await this.actions.testMap({file,hero,board,onProgress:message=>{
        if(generation===this.mapUploadGeneration&&this.phase==='options'){this.mapUploadStatus=message;this.render();}
      }});
      if(!result||generation!==this.mapUploadGeneration||this.phase!=='options')return;
      this.heroIndex=this.heroes.findIndex(h=>h.id===hero.id);this.boardIndex=board.finishIndex;this.finishIndex=board.finishIndex;
      this.mapUploadBusy=false;this.mapUploadStatus='';this.pendingMode=null;this.tutorialSeen=true;
      this.start(true);
    }catch(error){
      if(generation!==this.mapUploadGeneration||this.phase!=='options')return;
      this.mapUploadBusy=false;this.mapUploadStatus=error?.message||'Could not load this map.';this.render();
    }
  }
  async confirmLoadout(){
    if(this.selectBusy||this.phase!=='select')return;
    const hero=this.heroes[this.heroIndex];
    const board=BOARD_CHOICES[this.boardIndex];
    const location=LOCATIONS[this.locationIndex];
    if(!this.heroConfirmed||!this.boardConfirmed||!hero||!location?.available)return;
    const generation=++this.loadoutGeneration;
    this.selectBusy=true;this.selectError='Loading '+hero.name+'…';this.render();
    try{
      await this.actions.loadout({hero,board,location});
      if(generation!==this.loadoutGeneration||this.phase!=='select')return;
      this.selectBusy=false;this.selectError='';
      this.finishIndex=board.finishIndex;
      this.tutorialSeen=true;
      const practice=this.pendingMode==='practice';
      this.pendingMode=null;
      this.start(practice);
    }catch(error){
      if(generation!==this.loadoutGeneration||this.phase!=='select')return;
      this.selectBusy=false;
      this.selectError='Cannot load '+hero.name+': '+(error?.message||'Invalid or missing GLB.');
      this.render();
    }
  }
  start(practice){
    this.practice=practice;this.remaining=90;this.inputGrace=.3;this.runSummary=null;this.timeupEndsAt=0;
    this.music.unlock();this.setScreen('playing');this.actions.start(practice);this.actions.camera(CAMERAS[this.cameraIndex]);this.actions.portalsStart?.(LOCATIONS[this.locationIndex]?.id,practice);
  }
  pause(){if(this.active){if(this.actions.portalsOnlineConnected?.()){this.actions.portalsOnlineOpen?.();return;}this.setScreen('pause');this.actions.pause(true);}}
  resume(){this.setScreen('playing');this.inputGrace=.18;this.actions.pause(false);}
  syncPause(value){if(value&&this.active)this.setScreen('pause');else if(!value&&this.phase==='pause')this.setScreen('playing');}
  openTutorial(){this.tutorialReturn=this.phase;this.page=0;this.flipTutorial=true;this.actions.pause(true);this.setScreen('flipSchool');}
  openFlipSchool(){this.flipReturn=this.phase;this.flipTutorial=false;this.actions.pause(true);this.setScreen('flipSchool');}
  closeFlipSchool(){if(this.flipTutorial){this.flipTutorial=false;this.closeTutorial();}else if(this.flipReturn==='playing')this.resume();else this.setScreen(this.flipReturn||'title');}
  closeTutorial(){
    this.tutorialSeen=true;
    // Tutorials interrupt a screen; they never bypass loadout confirmation.
    if(this.tutorialReturn==='playing')this.resume();
    else this.setScreen(this.tutorialReturn==='tutorial'?'title':this.tutorialReturn);
  }
  back(){if(this.phase==='flipSchool'){this.closeFlipSchool();return;}if(this.phase==='timeup')return;else if(this.phase==='highlights')this.showResults();else if(this.phase==='tutorial'){this.closeTutorial();}else if(this.phase==='options')this.setScreen(this.optionsReturn||'title');else if(this.phase==='graphics')this.setScreen('options');else if(this.phase==='pause')this.resume();else if(this.phase==='results')this.choose('title');else if(this.phase==='select')this.setScreen('title');else if(this.phase==='title')this.choose('launcher');}
  choose(action,index=0){
    if(this.phase==='timeup')return;
    this.music.unlock();
    if(this.selectBusy&&['hero','board','location','upload','confirmLoadout'].includes(action))return;
    switch(action){
      // Same game-selection destination used by CyberArtsBR/Skate's launcher.
      case 'portals':this.actions.portalsOpen?.(LOCATIONS[this.locationIndex]?.id);break;
      case 'online':this.actions.portalsOnlineOpen?.();break;
      case 'launcher':window.location.assign('https://chimp-jump.onrender.com/');break;
      case 'start':this.begin(false);break;case 'practice':this.begin(true);break;
      case 'hero':this.heroIndex=index;this.heroConfirmed=true;this.focusHint={action:'hero',index};this.render();break;
      case 'board':this.boardIndex=index;this.boardConfirmed=true;this.focusHint={action:'board',index};this.render();break;
      case 'location':if(LOCATIONS[index]?.available){this.locationIndex=index;this.focusHint={action:'location',index};this.render();}break;
      case 'upload':this.avatarInput.click();break;
      case 'confirmLoadout':void this.confirmLoadout();break;
      case 'restart':this.start(this.practice);break;case 'resume':this.resume();break;
      case 'practiceDrills':if(this.phase==='pause'&&this.practice){this.actions.toggleDrills?.();this.render();}break;
      case 'practiceInputs':if(this.phase==='pause'&&this.practice){this.actions.togglePracticeInputs?.();this.render();}break;
      case 'watchHighlights':if(this.actions.watchHighlights?.()){this.replayDisplayKey='';this.setScreen('highlights');this.updateReplayCaption();}break;
      case 'stopHighlights':this.showResults();break;
      case 'tutorial':this.openTutorial();break;
      case 'flipSchool':this.openFlipSchool();break;
      case 'tutorialNext':this.page=0;this.setScreen('tutorial');break;
      case 'flipLesson':this.flipLessonIndex=Math.max(0,Math.min(FLIP_LESSONS.length-1,index));this.focusHint={action:'flipLesson',index:this.flipLessonIndex};this.render();break;
      case 'flipInput':this.flipInputMode=['xbox','playstation','keyboard'][index]||'xbox';this.flipPlayer?.setInputMode(this.flipInputMode);break;
      case 'flipPlay':this.flipPlayer?.toggle();break;
      case 'flipReplay':this.flipPlayer?.replay();break;
      case 'flipSpeed':this.flipPlayer?.toggleSpeed();break;
      case 'options':this.optionsReturn=this.phase;this.setScreen('options');break;
      case 'uploadTestMap':if(this.ready&&!this.mapUploadBusy)this.mapInput.click();break;
      case 'camera':this.cameraIndex=(this.cameraIndex+1)%CAMERAS.length;persist('streetskate.camera',CAMERAS[this.cameraIndex]);this.actions.camera(CAMERAS[this.cameraIndex]);this.render();break;
      case 'deadZone':{const current=this.actions.getDeadZone?.() ?? .16;const next=STICK_DEAD_ZONES[(STICK_DEAD_ZONES.indexOf(current)+1)%STICK_DEAD_ZONES.length];this.actions.setDeadZone?.(next);persist('streetskate.stickDeadZone',next);this.render();break;}
      case 'graphicsMenu':this.setScreen('graphics');break;
      case 'graphicsSet':this.graphicsIndex=Math.max(0,Math.min(GRAPHICS_PRESET_ORDER.length-1,index));this.actions.graphics?.(GRAPHICS_PRESET_ORDER[this.graphicsIndex]);this.render();break;
      case 'bloomToggle':this.bloomEnabled=!this.bloomEnabled;persist('streetskate.bloomEnabled',this.bloomEnabled?'on':'off');this.actions.graphics?.(GRAPHICS_PRESET_ORDER[this.graphicsIndex]);this.render();break;
      case 'edgeToggle':this.smoothEdges=!this.smoothEdges;persist('streetskate.smoothEdges',this.smoothEdges?'on':'off');this.actions.graphics?.(GRAPHICS_PRESET_ORDER[this.graphicsIndex]);this.render();break;
      case 'musicDown':this.adjustVolume('music',-.1);break;
      case 'musicUp':this.adjustVolume('music',.1);break;
      case 'effectsDown':this.adjustVolume('effects',-.1);break;
      case 'effectsUp':this.adjustVolume('effects',.1);break;
      case 'sound':this.sound=!this.sound;persist('streetskate.sound',this.sound?'on':'off');this.actions.sound(this.sound);this.render();break;
      case 'deck':this.finishIndex=(this.finishIndex+1)%BOARD_CHOICES.length;this.actions.deck(this.finishIndex);this.render();break;
      case 'title':this.actions.pause(true);this.setScreen('title');break;
      case 'back':this.back();break;
      case 'previous':if(this.page===0){this.flipTutorial=true;this.setScreen('flipSchool');}else{this.page--;this.render();}break;
      case 'next':this.page=Math.min(this.pages.length-1,this.page+1);this.render();break;
      case 'closeTutorial':this.closeTutorial();break;
      case 'skipTutorial':this.closeTutorial();break;
    }
    if(['camera','graphicsSet','bloomToggle','musicDown','musicUp','effectsDown','effectsUp','sound','deck','hero','board','location'].includes(action))this.actions.portalsSettingsChanged?.();
  }
  adjustVolume(channel,step){
    const current=channel==='music'?this.music.musicVolume:this.effectsVolume;
    const value=Math.round(Math.max(0,Math.min(1,current+step))*100)/100;
    if(channel==='music')this.music.setMusicVolume(value);
    else { this.effectsVolume=saveAudioVolume('effects',value);this.actions.effectsVolume?.(value); }
    this.render();
  }
  key(event){
    if(this.actions?.portalsOnlineIsOpen?.()){
      if(event.code==='Escape'){event.preventDefault();event.stopImmediatePropagation();this.actions.portalsOnlineClose?.();}
      return;
    }
    if(this.actions?.portalsIsOpen?.()){
      if(event.code==='Escape'){event.preventDefault();event.stopImmediatePropagation();this.actions.portalsClose?.();}
      return;
    }
    if(/INPUT|TEXTAREA|SELECT/.test(event.target?.tagName))return;
    if(this.phase==='timeup'){event.preventDefault();event.stopImmediatePropagation();return;}
    if(this.phase==='highlights'&&event.code==='KeyH'){event.preventDefault();event.stopImmediatePropagation();return;}
    if(event.code==='Backspace'){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)this.music.next();return;}
    if(event.code==='KeyH'){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat){if(this.open)this.closeTutorial();else if(this.phase==='flipSchool')this.closeFlipSchool();else this.openTutorial();}return;}
    if(this.active)return;
    this.music.unlock();
    if(event.target?.tagName==='SUMMARY'&&['Enter','Space'].includes(event.code))return;
    if(event.code==='Tab'&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
      // Include native disclosures as well as actions; their Enter/Space behavior
      // stays native so rendering details remain keyboard-accessible.
      const buttons=this.content?[...this.content.querySelectorAll('button[data-menu]:not(:disabled),summary')]:this.menuButtons();
      if(!buttons.length)return;
      event.preventDefault();event.stopImmediatePropagation();
      const current=buttons.indexOf(document.activeElement);
      const next=current<0?(event.shiftKey?buttons.length-1:0):(current+(event.shiftKey?-1:1)+buttons.length)%buttons.length;
      const target=buttons[next];target.focus({preventScroll:true});
      target.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'auto'});return;
    }
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
  updateTimer(){
    const warn=sessionWarning(this.remaining,this.practice);
    const text=this.practice?'∞':`${Math.floor(Math.ceil(this.remaining)/60)}:${String(Math.ceil(this.remaining)%60).padStart(2,'0')}`;
    if(this.timer.textContent===text&&this.timer.dataset.timerWarning===warn)return;
    setHudGlyphValue(this.timerValue,text);this.timer.dataset.timerWarning=warn;
    this.timer.dataset.practice=String(this.practice);
    this.timer.setAttribute('aria-label',this.practice?'Free skate · no time limit':`Time remaining ${text}`);
    this.timer.classList.toggle('time-low',warn!=='none');
    this.timer.classList.toggle('time-critical',warn==='critical');
    this.timer.dataset.warningLabel=warn==='critical'?'FINAL 5 SECONDS':warn==='warning'?'10 SECONDS LEFT':'';
  }
  update(dt){
    if(this.phase==='timeup'&&performance.now()>=this.timeupEndsAt)this.showResults();
    if(this.phase==='highlights')this.updateReplayCaption();
    this.inputGrace=Math.max(0,this.inputGrace-dt);this.navRepeat=Math.max(0,this.navRepeat-dt);
    if(this.active&&this.songToastRemaining>0){
      this.songToastRemaining=Math.max(0,this.songToastRemaining-dt);
      if(!this.songToastRemaining&&this.song.querySelector('.song-note').hidden)this.song.classList.add('song-compact');
    }
    const focused=document.hasFocus();
    const pad=[...(navigator.getGamepads?.()||[])].find(p=>p?.connected);
    const padIdentity=pad ? String(pad.index)+':'+String(pad.id) : null;
    const padChanged=padIdentity!==this.padIdentity;
    this.padIdentity=padIdentity;
    const b=i=>!!pad?.buttons[i]?.pressed;
    const stickX=pad?.axes?.[0]||0,stickY=pad?.axes?.[1]||0;
    const keys={a:b(0),back:b(1),select:b(8),start:b(9),
      shoulderLeft:b(4),shoulderRight:b(5),
      up:b(12)||stickY<-.65,down:b(13)||stickY>.65,
      left:b(14)||stickX<-.65,right:b(15)||stickX>.65};
    // Read the physical state even when unfocused so regaining focus cannot
    // synthesize a stale edge from a button held while the tab was inactive.
    if(!focused){this.padFocused=false;this.previousPad=keys;this.navRepeat=.22;return;}
    if(!this.padFocused||padChanged){this.previousPad=keys;this.padFocused=true;}
    if(this.actions?.portalsOnlineIsOpen?.()) {
      if(keys.back&&!this.previousPad.back)this.actions?.portalsOnlineClose?.();
      this.previousPad=keys;return;
    }
    if(this.actions?.portalsIsOpen?.()) {
      if(keys.back&&!this.previousPad.back)this.actions?.portalsClose?.();
      this.previousPad=keys;return;
    }
    const edge=k=>keys[k]&&!this.previousPad[k];
    if(Object.keys(keys).some(edge))this.music.unlock();
    if(edge('select'))this.music.next();
    if(!this.active&&this.phase!=='timeup'){
      const direction=keys.left?'left':keys.right?'right':keys.up?'up':keys.down?'down':null;
      if(this.open){
        if(edge('back'))this.back();
        else if(edge('start'))this.choose('skipTutorial');
        else if(edge('shoulderLeft')||edge('left'))this.choose('previous');
        else if(edge('shoulderRight')||edge('right'))this.choose('next');
        else if(direction&&(direction==='up'||direction==='down')&&(!this.navRepeat||edge(direction))){
          this.moveSelection('y',direction==='up'?-1:1);this.navRepeat=.22;
        }
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
        else if(edge('start')&&this.phase==='title')this.begin(false);
      }
    }
    this.previousPad=keys;
    if(this.active&&!this.practice&&document.hasFocus()){
      const before=this.remaining;
      this.remaining=Math.max(0,this.remaining-dt);this.updateTimer();
      const threshold=countdownCrossing(before,this.remaining,this.practice);
      if(threshold)this.actions.countdownWarning?.(threshold);
      if(!this.remaining)this.finishRun();
    }
  }
}
