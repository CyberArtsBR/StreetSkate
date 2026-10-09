import { SKATEBOARD_FINISHES } from '../skateboard/BoardFinishes.js';

// Mirrors Half Pipe's BUILD YOUR LINE structure; asset names are stable URLs.
export const DEFAULT_CHARACTERS = Object.freeze([
  Object.freeze({ id:'heretic', name:'Heretic', subtitle:'THE EXECUTOR', url:'/assets/rider/The_Heretic.glb', accent:'#f66e62' }),
  Object.freeze({ id:'adolescent', name:'Adolescent', subtitle:'THE YOUNGBLOOD', url:'/assets/rider/The_AdolescentUR.glb', accent:'#7edcff' }),
  Object.freeze({ id:'anchor', name:'Anchor', subtitle:'THE WIZARD', url:'/assets/rider/The_Anchor.glb', accent:'#c8f17f' }),
  Object.freeze({ id:'tuxr', name:'Tuxr', subtitle:'THE MASTERMIND', url:'/assets/rider/TuxR.glb', accent:'#cc94ff' }),
]);
export const BOARD_CHOICES = Object.freeze([
  { id:'sunset', label:'SUNSET FIRE', finishIndex:0, gradient:SKATEBOARD_FINISHES[0].cssGradient },
  { id:'electric', label:'ELECTRIC BLUE', finishIndex:1, gradient:SKATEBOARD_FINISHES[1].cssGradient },
  { id:'toxic', label:'TOXIC LIME', finishIndex:3, gradient:SKATEBOARD_FINISHES[3].cssGradient },
  { id:'nebula', label:'NEBULA PURPLE', finishIndex:5, gradient:SKATEBOARD_FINISHES[5].cssGradient },
]);
export const LOCATIONS = Object.freeze([
  {id:'rooftop', name:'SKYLINE ROOFTOP', subtitle:'Sunset cloud skatepark', available:true},
  // Add locations here and update the world loader when new playable parks ship.
  {id:'coming-soon-1', name:'COMING SOON', subtitle:'New location', available:false},
  {id:'coming-soon-2', name:'COMING SOON', subtitle:'New location', available:false},
]);
