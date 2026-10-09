import { FLIP_TRICKS, DOUBLE_FLIP_TRICKS, GRAB_TRICKS, DOUBLE_GRAB_TRICKS,
  GRIND_TRICKS, DOUBLE_GRIND_TRICKS, FLATLAND_TRICKS } from './TrickCatalog.js';

const DIRECTIONS={none:'Neutral',left:'A / Left',right:'D / Right',up:'W / Up',down:'S / Down',
  upLeft:'W+A / Up-left',upRight:'W+D / Up-right',downLeft:'S+A / Down-left',downRight:'S+D / Down-right'};
const table=(head,rows)=>`<table><thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
export function tutorialPages() {
  return [
    {title:'Welcome to the rooftop',subtitle:'90 seconds. Build a line. Land your combos.',html:table(['Action','Keyboard','Xbox'],[
      ['Steer / trick direction','W A S D','Left stick / D-pad'],['Ollie','Hold Space, then release','Hold A, then release'],
      ['Flip / Grab / Grind','← / → / ↑ arrow keys','X / B / Y'],['Air rotation','Q / E','LB / RB'],
      ['Vert exit / switch stance','Left Ctrl / Right Ctrl','LT / RT'],['Camera 1–4','1 / 2 / 3 / 4','Click right stick to cycle'],
      ['Skip song','Backspace','View / Select'],['Pause','Esc','Menu / Start'],
    ])+'<p>WASD chooses direction; arrow keys perform tricks. W = Up, S = Down, A = Left, D = Right. W+A / W+D = upper diagonals; S+A / S+D = lower diagonals. Xbox uses the same direction on the left stick or D-pad. Start Game is 90 seconds. Options → Practice has no time limit.</p>'},
    {title:'Flip tricks',subtitle:'Hold direction + ← / Xbox X. Tap again early to upgrade.',html:table(['Direction: keyboard / stick','One tap','Two taps','Three taps'],
      Object.entries(FLIP_TRICKS).filter(([d])=>d!=='none').map(([d,t])=>{const next=DOUBLE_FLIP_TRICKS[t.name];return[DIRECTIONS[d],t.name,next?.name||'—',DOUBLE_FLIP_TRICKS[next?.name]?.name||'—'];}))+
      '<p>Neutral = Kickflip. Extra taps must arrive before the flip finishes; triple flips need more airtime. Release the trick button between taps.</p>'},
    {title:'Grab tricks',subtitle:'Hold direction + → / Xbox B. Double-tap, then hold for the advanced grab.',html:table(['Direction: keyboard / stick','Press + hold','Double-tap + hold'],
      Object.entries(GRAB_TRICKS).filter(([d])=>d!=='none').map(([d,t])=>[DIRECTIONS[d],t.name,DOUBLE_GRAB_TRICKS[t.name].name]))+
      '<p>Double-tap within 0.38 seconds; hold the second press. Release to let go. Neutral = Indy.</p>'},
    {title:'Grinds & balance',subtitle:'Approach a rail from the air. Hold direction + ↑ / Xbox Y.',html:table(['Direction: keyboard / stick','Press + hold','Double-tap + hold'],
      Object.entries(GRIND_TRICKS).map(([d,t])=>[DIRECTIONS[d],t.name,DOUBLE_GRIND_TRICKS[t.name].name]))+
      '<p>Boardslide: Shift + ↑ / LT + Y. Double-tap within 0.38 seconds for variants. Keep correcting left and right to center the balance marker. Reaching either end causes a fall.</p>'},
    {title:'Manuals & flatland',subtitle:'Manual: W then S / stick Up then Down. Nose Manual: S then W / Down then Up.',html:table(['Trick','Keyboard sequence','Xbox sequence'],
      Object.entries(FLATLAND_TRICKS).map(([sequence,t])=>[t.name,sequence.split('+').map(s=>({flip:'←',grab:'→',grind:'↑'})[s]).join(' then '),sequence.split('+').map(s=>({flip:'X',grab:'B',grind:'Y'})[s]).join(' then ')]))+
      '<p>Start a manual first, then enter the button pair quickly. Balance with W/S or stick up/down. Manuals connect landed tricks into a longer combo.</p>'},
    {title:'Walls, cameras & your run',subtitle:'Land clean. Keep your combo going.',html:table(['Action','Keyboard','Xbox'],[
      ['Wall Ride','Hold ↑ against a wall in the air','Hold Y against a wall in the air'],['Wall Plant','Space when hitting a wall in the air','A when hitting a wall in the air'],
      ['Wallie','Space during a Wall Ride','A during a Wall Ride'],['Follow / Classic / Fixed / First person','1 / 2 / 3 / 4','Click right stick to cycle'],
      ['Look around','Drag mouse','Right stick'],['Tutorial / Practice / music / deck','Pause → menu options','Menu → choose with stick + A'],
    ])+'<p>Clean landings bank points. A bail loses the current combo, then respawns you on nearby flat ground with three flashes. The timer stops at 00:00; Practice keeps going.</p>'},
  ];
}
