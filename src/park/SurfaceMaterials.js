import * as THREE from 'three';

// Original, deterministic material artwork. Generated once at park load; no
// per-frame canvas work, asset downloads or texture changes to collision.
function random(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

function canvas(size = 1024, height = size) {
  const value = document.createElement('canvas'); value.width = size; value.height = height;
  return value;
}

function texture(source, color = true, repeat = true) {
  const map = new THREE.CanvasTexture(source);
  if (color) map.colorSpace = THREE.SRGBColorSpace;
  if (repeat) map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 4;
  return map;
}

function surface(kind) {
  const color = canvas(), relief = canvas();
  const c = color.getContext('2d'), b = relief.getContext('2d');
  const pixels = c.createImageData(1024, 1024), height = b.createImageData(1024, 1024);
  const rng = random(kind === 'wood' ? 518 : 903);
  const wood = kind === 'wood';
  const base = wood ? [167, 125, 79] : kind === 'bowl' ? [205, 200, 183] : [161, 157, 143];
  for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
    const index = (y * 1024 + x) * 4, noise = rng() - 0.5;
    const warp = Math.sin(y * Math.PI / 512) * 8 + Math.sin(y * Math.PI / 128) * 2;
    const grain = Math.sin((x + warp) * 0.6) * 3 + Math.sin((x + warp) * 0.123) * 6;
    const mottling = Math.sin(x * Math.PI / 128) * Math.sin(y * Math.PI / 256) * 3;
    const tone = wood ? grain + noise * 11 + (x < 512 ? 4 : -4) : noise * 16 + mottling;
    for (let k = 0; k < 3; k++) pixels.data[index + k] = base[k] + tone;
    const h = 128 + noise * (wood ? 8 : 24) + (wood ? grain * 1.2 : 0);
    height.data[index] = height.data[index + 1] = height.data[index + 2] = h;
    pixels.data[index + 3] = height.data[index + 3] = 255;
  }
  c.putImageData(pixels, 0, 0); b.putImageData(height, 0, 0);
  if (wood) {
    // Long fibres, occasional knots and lightly sanded wear in plywood sheets.
    for (let i = 0; i < 170; i++) {
      const x = rng() * 1024, y = rng() * 1024;
      c.strokeStyle = `rgba(77,45,20,${0.035 + rng() * 0.09})`;
      c.lineWidth = 0.5 + rng(); c.beginPath(); c.moveTo(x, y);
      c.bezierCurveTo(x + 5, y + 40, x - 3, y + 100, x + rng() * 4, Math.min(1024, y + 220)); c.stroke();
    }
    for (const [x, y] of [[184, 328], [765, 701], [865, 183]]) {
      for (let ring = 1; ring <= 11; ring++) {
        c.strokeStyle = `rgba(66,39,20,${0.15 - ring * 0.008})`;
        c.beginPath(); c.ellipse(x, y, ring * 1.45, ring * 5, 0.08, 0, Math.PI * 2); c.stroke();
      }
    }
    for (const x of [0, 512, 1023]) {
      c.fillStyle = '#584530'; c.fillRect(x, 0, 2, 1024);
      b.fillStyle = '#555'; b.fillRect(x, 0, 2, 1024);
    }
    for (const y of [0, 1022]) { c.fillStyle = '#65503a'; c.fillRect(0, y, 1024, 2); b.fillStyle = '#555'; b.fillRect(0, y, 1024, 2); }
    for (const x of [13, 499, 525, 1010]) for (let y = 18; y < 1024; y += 164) {
      c.fillStyle = '#635b50'; c.beginPath(); c.arc(x, y, 2.5, 0, 7); c.fill();
      c.strokeStyle = '#aaa08b'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(x - 1.7, y); c.lineTo(x + 1.7, y); c.stroke();
      b.fillStyle = '#646464'; b.beginPath(); b.arc(x, y, 2, 0, 7); b.fill();
    }
  } else {
    for (let i = 0; i < 6500; i++) {
      const x = rng() * 1024, y = rng() * 1024, radius = 0.2 + rng() * 1.6;
      c.fillStyle = `rgba(56,55,50,${rng() * 0.09})`; c.beginPath(); c.arc(x, y, radius, 0, 7); c.fill();
    }
    if (kind !== 'bowl') {
      c.strokeStyle = '#77756b'; c.lineWidth = 1.6; c.strokeRect(1, 1, 1022, 1022);
      b.strokeStyle = '#777'; b.lineWidth = 2; b.strokeRect(1, 1, 1022, 1022);
      for (let i = 0; i < 9; i++) {
        let x = rng() * 1024, y = rng() * 1024;
        c.beginPath(); c.moveTo(x, y);
        for (let j = 0; j < 7; j++) { x += rng() * 15 - 7; y += rng() * 14; c.lineTo(x, y); }
        c.strokeStyle = 'rgba(49,47,41,0.17)'; c.lineWidth = 0.65; c.stroke();
      }
    }
  }
  return new THREE.MeshStandardMaterial({
    color: '#ffffff', map: texture(color), bumpMap: texture(relief, false),
    bumpScale: wood ? 0.008 : 0.016, roughness: wood ? 0.73 : 0.88,
  });
}

export function createSurfaceMaterials() {
  return { wood: surface('wood'), concrete: surface('concrete'), bowl: surface('bowl') };
}

export function createGraffitiMaterial(word, seed = 15) {
  const art = canvas(2048, 768), c = art.getContext('2d'), rng = random(seed);
  // Spray clouds, arrows, outlined throw-up lettering and drips form an original
  // mural. Transparent edges allow the underlying concrete/wood to show through.
  for (let i = 0; i < 2700; i++) {
    const x = 120 + rng() * 1780, y = 80 + rng() * 580;
    c.fillStyle = `rgba(${i % 2 ? '24,175,177' : '241,99,117'},${rng() * 0.15})`;
    c.beginPath(); c.arc(x, y, 1 + rng() * 9, 0, 7); c.fill();
  }
  c.save(); c.translate(100, 90); c.transform(1, -0.06, -0.15, 1, 0, 0);
  c.strokeStyle = '#edaf36'; c.lineWidth = 26;
  c.beginPath(); c.moveTo(20, 390); c.lineTo(1700, 470); c.lineTo(1580, 340); c.moveTo(1700, 470); c.lineTo(1490, 520); c.stroke();
  c.font = '900 390px Impact, Arial Black, sans-serif'; c.textAlign = 'center'; c.lineJoin = 'round';
  c.strokeStyle = '#f2e7cf'; c.lineWidth = 45; c.strokeText(word, 890, 390, 1640);
  c.strokeStyle = '#202b37'; c.lineWidth = 28; c.strokeText(word, 890, 390, 1640);
  const fill = c.createLinearGradient(0, 80, 0, 420);
  fill.addColorStop(0, '#70e8cb'); fill.addColorStop(0.52, '#29a4ab'); fill.addColorStop(0.54, '#df6082'); fill.addColorStop(1, '#c23569');
  c.fillStyle = fill; c.fillText(word, 890, 390, 1640);
  c.strokeStyle = '#f3df80'; c.lineWidth = 4; c.strokeText(word, 890, 390, 1640);
  for (let i = 0; i < 20; i++) {
    const x = 200 + rng() * 1350, y = 390 + rng() * 35;
    c.strokeStyle = i % 2 ? '#c23569' : '#24a5a5'; c.lineWidth = 3 + rng() * 5;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 20 + rng() * 90); c.stroke();
  }
  c.restore();
  c.font = 'italic bold 44px sans-serif'; c.fillStyle = '#eadeb9'; c.fillText('SOLAR DOCK // SKATE EVERY DAY', 680, 700);
  return new THREE.MeshStandardMaterial({ map: texture(art, true, false), transparent: true,
    depthWrite: false, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2 });
}
