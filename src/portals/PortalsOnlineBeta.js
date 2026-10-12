import { OnlineGhosts } from './OnlineGhosts.js';
import './portals-online.css';

const MAPS=[{id:'rooftop',name:'Skyline Rooftop'},{id:'orbit',name:'ORBIT'},{id:'grand-warehouse',name:'Grand Warehouse'}];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nice=s=>Number(s||0).toLocaleString('en-US');
const channelFor=code=>code.startsWith('CH')?'global:ch-online-private-'+code.toLowerCase():'global:ch-online-public-'+code;
const validCode=s=>/^CH[A-Z0-9]{8}$/.test(s);
function code(){
 const bytes=new Uint8Array(8);crypto.getRandomValues(bytes);
 const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
 return 'CH'+[...bytes].map(n=>alphabet[n%alphabet.length]).join('');
}
export class PortalsOnlineBeta {
 constructor({sdk=globalThis.Portals,scene,camera,shell,getSkater,getWorld,changeMap,goToSpot}){
  this.sdk=sdk;this.scene=scene;this.camera=camera;this.shell=shell;
  this.getSkater=getSkater;this.getWorld=getWorld;this.changeMap=changeMap;this.goToSpot=goToSpot;
  this.connected=false;this.visible=false;this.busy=false;this.mode='menu';this.state=null;this.roomCode='';
  this.errors='';this.name='';this.speakers=[];this.roomPrivate=false;this.bestCombo=0;this.localBase=0;
  this.snapshotAt=0;this.scoreAt=0;this.roundSeen=-1;this.phaseSeen='';
  this.root=document.createElement('section');this.root.id='portals-online';this.root.hidden=true;
  this.root.setAttribute('aria-label','Chimp Hawk Online Beta');
  document.body.append(this.root);
  this.root.addEventListener('click',e=>{const button=e.target.closest('button[data-online]');if(button)void this.action(button.dataset.online,button.dataset.value)});
  this.root.addEventListener('input',e=>{
    if(e.target.name==='guest')this.name=e.target.value;
    if(e.target.name==='room')this.inviteInput=e.target.value;
    if(e.target.name==='bugDescription')this.bugDescription=e.target.value;
    if(e.target.name==='bugCategory')this.bugCategory=e.target.value;
  });
  this.net=sdk?.net;this.voice=sdk?.voice;
  this.handlers=[];
  const invite=new URLSearchParams(location.search).get('online-room');
  if(invite&&validCode(invite.toUpperCase()))this.inviteInput=invite.toUpperCase();
 }
 get available(){return typeof this.sdk?.ready==='function'&&typeof this.net?.join==='function'}
 get isHost(){return this.connected&&this.state?.host===this.id}
 open(){if(!this.available)return;this.visible=true;this.render()}
 close(){this.visible=false;this.render()}
 async action(a,v){
  if(a==='close'){this.close();return}
  if(a==='quick'){await this.quickPlay();return}
  if(a==='public'){await this.joinRoom(v,false);return}
  if(a==='create-private'){await this.joinRoom(code(),true);return}
  if(a==='join-private'){const value=String(this.inviteInput||'').toUpperCase().trim();if(!validCode(value)){this.errors='Enter a valid invite code.';this.render();return}await this.joinRoom(value,true);return}
  if(a==='leave'){await this.leave();return}
  if(a==='mute'&&this.voice){try{this.voice.setMuted(!this.voice.muted())}catch(e){this.errors=e.message}this.render();return}
  if(a==='voice'){void this.startVoice();return}
  if(a==='ready'){this.net.send({kind:'online:ready',ready:!this.state?.ready?.includes(this.id)});return}
  if(a==='start'&&this.isHost){this.net.send({kind:'online:start'});return}
  if(a==='next'&&this.isHost){this.net.send({kind:'online:next'});return}
  if(a==='host-map'&&this.isHost){this.net.send({kind:'online:settings',map:v,mode:this.state.mode,apply:'after'});return}
  if(a==='host-mode'&&this.isHost){this.net.send({kind:'online:settings',map:this.state.map,mode:v,apply:'after'});return}
  if(a==='kick'&&this.isHost&&this.state&&!['jam','last','countdown'].includes(this.state.phase)){this.net.send({kind:'online:kick',target:v});return}
  if(a==='watch'){this.watchId=v;this.mode='watch';this.close();return}
  if(a==='play'){this.watchId=null;this.mode='play';this.close();return}
  if(a==='copy'){const url=new URL(location.href);url.searchParams.set('online-room',this.roomCode);try{await navigator.clipboard.writeText(url.href);this.errors='Invite link copied.'}catch{this.errors='Use the displayed code to invite your friends.'}this.render();return}
  if(a==='report'){this.mode='report';this.render();return}
  if(a==='send-report'){this.report();return}
  if(a==='home'){this.mode='menu';this.render();return}
 }
 bind(){
  const on=(target,event,fn)=>{target?.on?.(event,fn);this.handlers.push(()=>target?.off?.(event,fn))};
  on(this.net,'state',(key,value)=>{if(key==='server:online')this.setState(value)});
  on(this.net,'message',(data,from)=>{
   if(data?.kind==='online:pose'&&from!==this.id){this.ghosts?.receive(from,data,this.getWorld()?.id);return}
   if(data?.kind==='online:clock'){this.clockInfo=data;this.renderStatus();return}
   if(data?.kind==='online:cancelled'){this.errors='Round cancelled by HOST.';this.render();return}
  });
  const roster=()=>this.refreshRoster();
  on(this.net,'playerjoin',roster);on(this.net,'playerleave',roster);
  on(this.net,'status',status=>{if(status==='disconnected'){this.errors='Connection lost. Leave and join again.';this.connected=false;this.render()}});
  on(this.voice,'speaking',ids=>{this.speakers=ids||[];this.refreshRoster()});
  on(this.voice,'status',status=>{if(status==='disconnected'){this.voiceConnected=false;this.render()}});
 }
 refreshRoster(){
  if(!this.connected)return;
  this.ghosts?.setRoster(this.net.players().filter(p=>p.id!==this.id),this.state?.names||{},this.speakers);
  if(this.visible)this.render();
 }
 setState(value){
  if(!value||value.v!==1)return;
  const prior=this.state;this.state=value;this.refreshRoster();
  if(prior?.map!==value.map){void this.enterMap(value.map)}
  if(value.phase==='jam'&&this.phaseSeen!=='jam'&&value.round!==this.roundSeen){
   this.roundSeen=value.round;this.localBase=this.getSkater()?.score||0;this.bestCombo=0;
   this.placeStart();
  }
  this.phaseSeen=value.phase;
  this.renderStatus();
  if(this.visible)this.render();
 }
 async quickPlay(){
  this.errors='';this.busy=true;this.render();
  for(let i=1;i<=8;i++){
   const room=String(i).padStart(2,'0');
   const result=await this.joinRoom(room,false,true);
   if(result){this.busy=false;this.render();return}
  }
  this.busy=false;this.errors='Public rooms are full or unavailable. Try again.';this.render();
 }
 async joinRoom(room,privateRoom,scan=false){
  if(!this.available||this.connected)return false;
  this.busy=true;this.errors='';this.render();
  try{
   // Channels isolate the rooms. Four seats are enforced by the server referee.
   const session=await this.net.join({channel:channelFor(room)});
   if(session.players?.length>4){await this.net.leave();return false}
   this.id=session.self.id;this.connected=true;this.roomCode=room;this.roomPrivate=privateRoom;
   this.mode='play';this.watchId=null;this.bind();
   this.ghosts=new OnlineGhosts({scene:this.scene,camera:this.camera,heroUrl:id=>{
     return this.shell.heroes.find(h=>h.id===id)?.url||this.shell.heroes[0].url;
   }});
   this.setState(session.state?.['server:online']||null);
   const player=this.shell.actions.portalsPlayer?.();
   this.name=player?.playerId?(player.displayName||'Skater'):(this.name.trim()||'Guest'+String(Math.floor(Math.random()*9000)+1000));
   this.net.send({kind:'online:hello',name:this.name});
   await this.enterMap(this.state?.map||'grand-warehouse');
   this.close();
   void this.startVoice();
   return true;
  }catch(error){
   this.errors='Could not connect: '+(error?.message||'Portals multiplayer unavailable');
   if(!scan)this.render();
   return false;
  }finally{this.busy=false;this.render()}
 }
 async enterMap(id){
  if(!this.connected||this.mapLoading||!MAPS.some(m=>m.id===id))return;
  if(this.getWorld()?.id===id&&this.shell.active)return;
  this.mapLoading=true;
  try{
   if(this.getWorld()?.id!==id)await this.changeMap(id);
   this.shell.start(true);
   this.placeStart();
  }catch(error){this.errors='Map load failed: '+(error.message||error);this.open()}
  finally{this.mapLoading=false}
 }
 placeStart(){
  const spots=this.getWorld()?.manifest?.spots||[];
  const slot=Math.max(0,(this.state?.participants||[]).indexOf(this.id));
  const spot=spots.length?spots[slot%spots.length]:null;
  if(spot&&this.getSkater()&&this.shell.active)this.goToSpot(spot.id);
 }
 async startVoice(){
  if(!this.connected||!this.voice?.join)return;
  try{await this.voice.join();this.voiceConnected=true}
  catch(error){this.voiceConnected=false;console.info('[Online] Voice optional:',error?.message||error)}
  if(this.visible)this.render();
 }
 report(){
  const description=String(this.bugDescription||'').trim().slice(0,240);
  if(description.length<8){this.errors='Describe the problem in at least 8 characters.';this.render();return}
  try{
   this.sdk.track('online_bug_report',{category:String(this.bugCategory||'other').slice(0,40),
    description,map:this.getWorld()?.id||'unknown',mode:this.state?.mode||'unknown'});
   this.bugDescription='';this.errors='Report recorded in Portals Analytics. Thank you.';this.mode='menu';
  }catch(error){this.errors='Could not submit report: '+(error.message||error)}
  this.render();
 }
 async leave(){
  this.visible=false;this.connected=false;
  for(const off of this.handlers.splice(0))off();
  try{await this.voice?.leave?.()}catch{}
  try{await this.net?.leave?.()}catch{}
  this.ghosts?.dispose();this.ghosts=null;this.state=null;this.voiceConnected=false;
  this.mode='menu';this.render();
  this.shell.setScreen('title');
 }
 tick(dt){
  if(!this.connected)return;
  const s=this.getSkater(),world=this.getWorld(),t=performance.now();
  if(this.shell.active&&s&&world&&t-this.snapshotAt>=125){
   this.snapshotAt=t;
   const flip=s.flipState;
   const packet={kind:'online:pose',v:1,map:world.id,hero:this.shell.heroes[this.shell.heroIndex]?.id||'heretic',
    board:s.board?.finishIndex||0,p:s.position.toArray().map(n=>+n.toFixed(3)),
    q:s.visual.quaternion.toArray().map(n=>+n.toFixed(4)),
    vel:s.velocity.toArray().map(n=>+n.toFixed(2)),
    state:s.presentation?.state||'IDLE',speed:s.velocity.length(),air:!s.grounded,
    bail:s.bailTime>0,flip:flip?{name:flip.name,progress:flip.progress,type:flip.type,axis:flip.axis}:null,
    grab:s.grabState?.name||null,manual:s.manual||null,grind:!!s.grind,stance:s.stance||1};
   try{this.net.send(packet)}catch{}
  }
  if(s&&this.state&&['jam','last'].includes(this.state.phase)&&t-this.scoreAt>=350){
   this.scoreAt=t;
   const combo=s.tricks?.combo;
   const active=Array.isArray(combo)&&combo.length>0;
   const current=s.tricks?.comboBase*(s.tricks?.comboMultiplier||1)||0;
   this.bestCombo=Math.max(this.bestCombo,Math.floor(current));
   try{this.net.send({kind:'online:score',points:Math.max(0,Math.floor(s.score-this.localBase)),
    combo:this.bestCombo,active})}catch{}
  }
  this.ghosts?.update(dt,world?.id);
 }
 renderStatus(){
  const target=this.root.querySelector('[data-live-clock]');
  if(target&&this.state){
   const remaining=this.clockInfo?.phase===this.state.phase?this.clockInfo.remaining:
    Math.max(0,Math.ceil(((this.state.phase==='last'?this.state.lastDeadline:this.state.deadline)-Date.now())/1000));
   target.textContent=['jam','countdown','last'].includes(this.state.phase)?this.state.phase.toUpperCase()+' · '+remaining+'s':this.state.phase.toUpperCase();
  }
 }
 render(){
  this.root.hidden=!this.visible;if(!this.visible)return;
  const s=this.state, people=this.net?.players?.()||[],inRoom=this.connected;
  const isHost=this.isHost,locked=['countdown','jam','last'].includes(s?.phase);
  const nameInput=!inRoom&&!this.shell.actions.portalsPlayer?.()?.playerId?
   '<label>GUEST NICKNAME<input name="guest" maxlength="16" placeholder="Skater" value="'+esc(this.name)+'"></label>':'';
  const buttons=(a,label,v='',disabled=false)=>'<button data-online="'+a+'" data-value="'+esc(v)+'" '+(disabled?'disabled':'')+'>'+label+'</button>';
  const label=map=>MAPS.find(m=>m.id===map)?.name||map||'—';
  let body='';
  if(!inRoom){
   body=nameInput+ '<p>Free Skate or Skate Jam · 4 skaters · no player collisions.</p>'+
   '<div class="online-actions">'+buttons('quick','⚡ QUICK PLAY','',this.busy)+buttons('create-private','CREATE PRIVATE ROOM','',this.busy)+'</div>'+
   '<label>JOIN PRIVATE CODE<input name="room" maxlength="10" placeholder="CHXXXXXXXX" value="'+esc(this.inviteInput||'')+'"></label>'+
   buttons('join-private','JOIN PRIVATE','',this.busy)+
   '<h3>PUBLIC ROOMS</h3><div class="online-actions">'+[1,2,3,4,5,6,7,8].map(i=>buttons('public','ROOM '+String(i).padStart(2,'0'),String(i).padStart(2,'0'),this.busy)).join('')+'</div>'+
   '<small>Room occupancy is checked when joining. Public browser is a fixed 8-room beta directory.</small>';
  }else if(this.mode==='report'){
   body='<label>ISSUE TYPE<select name="bugCategory"><option value="network">Network</option><option value="animation">Animation</option><option value="voice">Voice</option><option value="map">Map</option><option value="other">Other</option></select></label>'+
    '<label>DESCRIPTION<textarea name="bugDescription" maxlength="240">'+esc(this.bugDescription||'')+'</textarea></label>'+
    '<p>Optional report is sent to Portals Analytics; do not include personal data or voice recordings.</p>'+buttons('send-report','SEND REPORT')+buttons('home','BACK');
  }else{
   body='<p>ROOM '+esc(this.roomCode)+(this.roomPrivate?' · PRIVATE':' · PUBLIC')+' · '+esc(label(s?.map))+' · '+esc(s?.mode==='jam'?'SKATE JAM':'FREE SKATE')+'</p>'+
    '<strong data-live-clock>'+esc(s?.phase||'CONNECTING')+'</strong>'+
    '<div class="online-roster">'+people.map(p=>{
     const id=p.id,n=s?.names?.[id]||p.displayName||'Guest';
     return '<div><b>'+esc(n)+(s?.host===id?' ★':'')+'</b><span>'+(s?.ready?.includes(id)?'READY':'')+
      '</span>'+(isHost&&id!==this.id&&!locked?buttons('kick','KICK',id):'')+'</div>';
    }).join('')+'</div>'+
    '<h3>SKATE JAM SCOREBOARD</h3><div class="online-roster">'+(s?.scores||[]).map((p,i)=>'<div><b>'+(i+1)+'. '+esc(p.name)+'</b><span>'+nice(p.points)+' PTS / '+nice(p.combo)+' COMBO</span></div>').join('')+'</div>'+
    (this.roomPrivate?buttons('copy','COPY INVITE LINK'):'')+
    '<div class="online-actions">'+buttons('ready',s?.ready?.includes(this.id)?'NOT READY':'READY','',locked)+
    (isHost?buttons('start','START SKATE JAM','',locked||s?.mode!=='jam'||(s?.ready||[]).length<2):'')+
    (isHost&&s?.phase==='results'?buttons('next','NEXT ROUND'):'')+'</div>'+
    (isHost?'<h3>HOST SETTINGS</h3><div class="online-actions">'+MAPS.map(m=>buttons('host-map',m.name,m.id)).join('')+
     buttons('host-mode','FREE SKATE','free')+buttons('host-mode','SKATE JAM','jam')+'</div><small>Map/mode changes are queued during active rounds.</small>':'')+
    '<div class="online-actions">'+buttons('mute',this.voiceConnected?(this.voice?.muted?.()?'UNMUTE':'MUTE MICROPHONE'):'VOICE UNAVAILABLE')+
    buttons('voice','RECONNECT VOICE')+buttons('play','RESUME SKATING')+
    ...(people.filter(p=>p.id!==this.id).map(p=>buttons('watch','WATCH '+esc(s?.names?.[p.id]||p.displayName||'SKATER'),p.id)))+
    buttons('report','REPORT BUG')+buttons('leave','LEAVE ROOM')+'</div>';
  }
  this.root.innerHTML='<div class="online-shade"></div><article class="online-panel" role="dialog" aria-modal="true">'+
   '<header><div><small>CHIMP HAWK UNDERGROUND · PORTALS ONLY</small><h2>PLAY ONLINE <em>BETA</em></h2></div>'+buttons('close','✕ CLOSE')+'</header>'+
   (this.errors?'<p class="online-notice" role="status">'+esc(this.errors)+'</p>':'')+
   '<div class="online-body">'+body+'</div></article>';
  this.renderStatus();
 }
}
