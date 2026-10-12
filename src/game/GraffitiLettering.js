import { gameAssetUrl } from './AssetPaths.js';
// Exact transparent letter artwork supplied by the game's owner.
const escape = value => String(value).replace(/[&<>"']/g, ch =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const palettes = new Set(['cyan-purple', 'gold', 'fire', 'green', 'red']);
export function graffitiLettering(text, palette = 'cyan-purple') {
  const tone = palettes.has(palette) ? palette : 'cyan-purple';
  const words = String(text).toUpperCase().split(/\s+/).filter(Boolean).map(word =>
    `<span class="graffiti-word">${[...word].map(letter => /[A-Z0-9]/.test(letter)
      ? `<img src="${gameAssetUrl('/assets/graffiti/')}${tone}/${letter}.png" alt="" draggable="false">`
      : `<span class="graffiti-punctuation">${escape(letter)}</span>`).join('')}</span>`).join(' ');
  return `<span class="graffiti-lettering" role="img" aria-label="${escape(text)}"><span class="graffiti-art" aria-hidden="true">${words}</span><span class="sr-only">${escape(text)}</span></span>`;
}
export const graffitiPalette = tone => ({ aqua:'cyan-purple', purple:'cyan-purple', lime:'green', gold:'gold', fire:'fire', red:'red' })[tone] || 'cyan-purple';

export function installGraffitiFallback(root=document){
  root.addEventListener('error',event=>{
    const lettering=event.target?.closest?.('.graffiti-lettering');
    if(!lettering||event.target.tagName!=='IMG')return;
    lettering.classList.add('graffiti-failed');
    const text=lettering.querySelector('.sr-only');
    if(text){text.classList.remove('sr-only');text.classList.add('graffiti-fallback');}
  },true);
}
