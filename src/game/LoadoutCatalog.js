import { SKATEBOARD_FINISHES } from '../skateboard/BoardFinishes.js';

export const DEFAULT_CHARACTERS = Object.freeze([
  Object.freeze({ id:'heretic', name:'Heretic', subtitle:'THE EXECUTOR', url:'/assets/rider/The_Heretic.glb', accent:'#f66e62' }),
  Object.freeze({ id:'adolescent', name:'Adolescent', subtitle:'THE YOUNGBLOOD', url:'/assets/rider/The_AdolescentUR.glb', accent:'#7edcff' }),
  Object.freeze({ id:'anchor', name:'Anchor', subtitle:'THE WIZARD', url:'/assets/rider/The_Anchor.glb', accent:'#c8f17f' }),
  Object.freeze({ id:'tuxr', name:'Tuxr', subtitle:'THE MASTERMIND', url:'/assets/rider/TuxR.glb', accent:'#cc94ff' }),
]);
const LABELS = ['GREY', 'WHITE / BLACK', 'PURPLE', 'LIME GREEN', 'YELLOW', 'BLUE', 'ORANGE', 'RED'];
export const BOARD_CHOICES = Object.freeze(LABELS.map((label, finishIndex) =>
  Object.freeze({
    id:label.toLowerCase().replace(/[^a-z]+/g,'-'),
    label,
    finishIndex,
    gradient:SKATEBOARD_FINISHES[finishIndex].cssGradient,
  })));
export const LOCATIONS = Object.freeze([
  {id:'rooftop', name:'SKYLINE ROOFTOP', subtitle:'Sunset cloud skatepark', available:true},
  {id:'coming-soon-1', name:'COMING SOON', subtitle:'New location', available:false},
  {id:'coming-soon-2', name:'COMING SOON', subtitle:'New location', available:false},
]);
