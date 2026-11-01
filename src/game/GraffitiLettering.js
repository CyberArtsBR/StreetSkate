import { gameAssetUrl } from './AssetPaths.js';
// Exact transparent letter artwork supplied by the game's owner.
const escape = value => String(value).replace(/[&<>"']/g, ch =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const palettes = new Set(['cyan-purple', 'gold', 'fire', 'green', 'red']);
export function graffitiLettering(text, palette = 'cyan-purple') {
  const tone = palettes.has(palette) ? palette : 'cyan-purple';
  const words = String(text).toUpperCase().split(/\s+/).filter(Boolean).map(word =>
    `<span class="graffiti-word">${[...word].map(letter => /[A-Z0-9]/.test(letter)
      ? `<img src="${gameAssetUrl('/assets/graffiti/')}${tone}/${letter}.png" alt="" draggable="false" decoding="async">`
      : `<span class="graffiti-punctuation">${escape(letter)}</span>`).join('')}</span>`).join(' ');
  return `<span class="graffiti-lettering graffiti-loading" role="img" aria-label="${escape(text)}"><span class="graffiti-art" aria-hidden="true">${words}</span><span class="graffiti-fallback" aria-hidden="true">${escape(text)}</span></span>`;
}
export const graffitiPalette = tone => ({ aqua:'cyan-purple', purple:'cyan-purple', lime:'green', gold:'gold', fire:'fire', red:'red' })[tone] || 'cyan-purple';

const pending=new WeakSet(), installed=new WeakMap();
export function prepareGraffitiLettering(lettering){
  if(!lettering||pending.has(lettering)||lettering.classList.contains('graffiti-failed'))return;
  const images=[...lettering.querySelectorAll('.graffiti-art img')];
  if(images.some(img=>!img.complete))return;
  if(images.some(img=>!img.naturalWidth)){lettering.classList.add('graffiti-failed');return;}
  pending.add(lettering);
  Promise.all(images.map(img=>img.decode?.().catch(()=>{})??Promise.resolve())).then(()=>{
    pending.delete(lettering);
    if(images.some(img=>!img.naturalWidth)){lettering.classList.add('graffiti-failed');return;}
    lettering.classList.remove('graffiti-loading');
    lettering.classList.add('graffiti-ready');
  });
}
/** Reveal a whole decoded heading at once; slow/missing glyphs keep readable text. */
export function installGraffitiFallback(root=document){
  if(installed.has(root))return installed.get(root);
  const load=event=>{if(event.target?.tagName==='IMG')prepareGraffitiLettering(event.target.closest?.('.graffiti-lettering'));};
  const error=event=>{
    const lettering=event.target?.closest?.('.graffiti-lettering');
    if(lettering&&event.target.tagName==='IMG')lettering.classList.add('graffiti-failed');
  };
  const visit=node=>{
    if(node?.matches?.('.graffiti-lettering'))prepareGraffitiLettering(node);
    node?.querySelectorAll?.('.graffiti-lettering').forEach(prepareGraffitiLettering);
  };
  root.addEventListener('load',load,true);root.addEventListener('error',error,true);
  const observer=typeof MutationObserver!=='undefined'?new MutationObserver(records=>{
    for(const record of records)for(const node of record.addedNodes)visit(node);
  }):null;
  observer?.observe(root,{subtree:true,childList:true});visit(root);
  const dispose=()=>{observer?.disconnect();root.removeEventListener('load',load,true);root.removeEventListener('error',error,true);installed.delete(root);};
  installed.set(root,dispose);return dispose;
}
