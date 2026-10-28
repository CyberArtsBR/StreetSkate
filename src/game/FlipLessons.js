import { FLIP_TRICKS, DOUBLE_FLIP_TRICKS } from './TrickCatalog.js';

const DIRECTIONS = {
  left: ['←','Left','A',-1,0], right: ['→','Right','D',1,0],
  up: ['↑','Up','W',0,-1], down: ['↓','Down','S',0,1],
  upLeft: ['↖','Up-left','W + A',-1,-1], upRight: ['↗','Up-right','W + D',1,-1],
  downLeft: ['↙','Down-left','S + A',-1,1], downRight: ['↘','Down-right','S + D',1,1],
};
const TIPS = {
  left:'Watch the deck roll once, then catch it with both feet.',
  right:'The deck rolls the opposite way to a kickflip. Keep your landing straight.',
  up:'Watch the board wrap end over end before the catch.',
  down:'The board turns 180° underneath you. Keep the rider facing the landing.',
  upLeft:'A quick nose-up accent combines a kickflip with a half shove-it.',
  upRight:'Hold the diagonal just for the tap. Release it to avoid extra air rotation.',
  downLeft:'The board combines one kickflip with a 180° shove-it.',
  downRight:'The board combines one heelflip with a 180° shove-it.',
};
export const FLIP_LESSONS = Object.freeze(Object.entries(DIRECTIONS).map(([direction,[arrow,label,keys,x,y]])=>{
  const trick=FLIP_TRICKS[direction];
  const id=trick.name.toLowerCase().replace(/[^a-z0-9]+/g,'-');
  return Object.freeze({id,direction,arrow,label,keys,x,y,trick,tip:TIPS[direction],
    upgrade:DOUBLE_FLIP_TRICKS[trick.name]?.name,
    video:`/media/flip-school/${id}.webm`,poster:`/media/flip-school/${id}.jpg`});
}));

// One timeline drives the recorded demonstration and the live input overlay.
// Seconds are clip time; playback speed scales the video and overlay together.
export const FLIP_LESSON_TIMING = Object.freeze({charge:.35,pop:1.05,tap:1.16,release:1.30,land:1.95,duration:3.2});
export function flipLessonFrame(lesson,time) {
  const t=Math.max(0,Number(time)||0),k=FLIP_LESSON_TIMING;
  const airborne=t>=k.pop&&t<k.land;
  const flipping=t>=k.tap&&t<k.tap+lesson.trick.duration;
  return {
    step:t<k.pop?0:t<k.tap?1:t<k.land?2:3,
    ollie:t>=k.charge&&t<k.pop,
    flip:t>=k.tap&&t<k.release,
    direction:t>=k.tap&&t<k.release,
    airborne,
    flipState:flipping?{...lesson.trick,progress:(t-k.tap)/lesson.trick.duration}:null,
    airProgress:airborne?(t-k.pop)/(k.land-k.pop):0,
    crouch:t<k.pop?Math.max(0,Math.min(1,(t-k.charge)/.45)):0,
    landing:t>=k.land&&t<k.land+.3,
  };
}

export function flipLessonSteps(lesson,mode='xbox') {
  const ollie=mode==='keyboard'?'Space':mode==='playstation'?'Cross':'A';
  const flip=mode==='keyboard'?'← arrow':mode==='playstation'?'Square':'X';
  const direction=mode==='keyboard'?lesson.keys:`${lesson.arrow} ${lesson.label}`;
  return [
    {title:'Charge',input:`Hold ${ollie}`,detail:'Build your ollie before takeoff.'},
    {title:'Pop',input:`Release ${ollie}`,detail:'Get the board into the air.'},
    {title:'Flick',input:`${direction} + ${flip}`,detail:'Tap together, then release the direction.'},
    {title:'Land',input:'Release · land straight',detail:'Let the flip finish and catch the board.'},
  ];
}
