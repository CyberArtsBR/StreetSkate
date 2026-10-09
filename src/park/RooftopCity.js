import * as THREE from 'three';

/** Presentation-only rooftop dressing. Never inject skyscrapers into skate collision. */
export function createRooftopCity() {
  const group = new THREE.Group();
  group.name = 'Skyline rooftop / decorative only';
  const concrete = new THREE.MeshStandardMaterial({ color: '#323b46', roughness: 0.85, metalness: 0.14 });
  const steel = new THREE.MeshStandardMaterial({ color: '#61727d', metalness: 0.7, roughness: 0.35 });
  const glass = new THREE.MeshStandardMaterial({ color: '#9acbd3', metalness: 0.35, roughness: 0.18, transparent: true, opacity: 0.23, depthWrite: false });
  const steelDark = new THREE.MeshStandardMaterial({ color: '#202c3e', metalness: 0.55, roughness: 0.45 });

  const add = (w,h,d,x,y,z,mat) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
    mesh.position.set(x,y,z);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  // Foundation starts under the deep pool, so the curved riding surface is clear.
  add(110, 30, 150, 0,-20.4,-8, concrete);
  add(110, 3, 150, 0,-36.8,-8, steelDark);
  for (const x of [-54.4,54.4]) {
    add(0.72, 1.2, 150, x, -0.65,-8,steelDark);
    add(0.14,0.15,150,x,2.28,-8,steel);
    for (let z=-82; z<=66; z+=4.0) add(0.15,2.7,0.15,x,0.98,z,steel);
    add(0.05,2.0,149,x,1.13,-8,glass);
  }
  for (const z of [-82.6,66.6]) {
    add(110,1.2,0.72,0,-0.65,z,steelDark);
    add(110,0.15,0.14,0,2.28,z,steel);
    for (let x=-54; x<=54; x+=4) add(0.15,2.7,0.15,x,0.98,z,steel);
    add(109,2.0,0.05,0,1.13,z,glass);
  }

  // A procedural window atlas: one texture shared by every tower, no thousands of meshes.
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#293747'; ctx.fillRect(0,0,128,256);
  let seed = 341;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let y=9;y<252;y+=12) for (let x=8;x<126;x+=14) {
    const lit = random() > 0.40;
    ctx.fillStyle = lit ? (random()>0.65 ? '#ed9c62' : '#c6bfc0') : '#374754';
    ctx.fillRect(x,y,7,6);
  }
  const windows = new THREE.CanvasTexture(canvas);
  windows.colorSpace = THREE.SRGBColorSpace;
  windows.wrapS = windows.wrapT = THREE.RepeatWrapping;
  windows.anisotropy = 4;
  const towerMaterial = new THREE.MeshStandardMaterial({
    color: '#8899a4', map: windows, emissive: '#da8569', emissiveMap: windows,
    emissiveIntensity: 0.32, roughness: 0.58, metalness: 0.28,
  });
  const towerSilhouette = new THREE.MeshStandardMaterial({ color: '#3b435d', roughness: 0.84 });
  for (let i=0;i<66;i++) {
    const theta = i * 2.399963229728653;
    const ring = 155 + (i%5)*34 + random()*27;
    const x = Math.cos(theta)*ring;
    const z = -8 + Math.sin(theta)*ring;
    const w = 11+random()*22, depth = 12+random()*23;
    const h = 60+random()*150;
    const level = -63 - (i%3)*6;
    add(w,h,depth,x,level+h*0.5,z, i%7===0?towerSilhouette:towerMaterial);
    if (i%4===0) add(w*0.45,5,depth*0.45,x,level+h+2.5,z,steelDark);
  }

  // Sky sphere rotates with the camera world, keeping horizon and sunset stable.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(810,48,24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { sunDirection: { value: new THREE.Vector3(-0.62,0.08,0.46).normalize() } },
      vertexShader: 'varying vec3 ray; void main(){ray=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'varying vec3 ray; uniform vec3 sunDirection; void main(){float t=smoothstep(-0.08,0.85,ray.y); vec3 horizon=mix(vec3(0.90,0.39,0.31),vec3(0.86,0.56,0.51),smoothstep(-0.2,0.2,ray.y)); vec3 sky=mix(horizon,vec3(0.12,0.21,0.40),t); float halo=pow(max(dot(normalize(ray),sunDirection),0.0),22.0); float sun=pow(max(dot(normalize(ray),sunDirection),0.0),800.0); sky+=vec3(1.0,0.47,0.18)*halo*0.5+vec3(1.0,0.77,0.42)*sun; gl_FragColor=vec4(sky,1.0);}',
    })
  );
  sky.frustumCulled = false;
  sky.name = 'Sunset skybox';
  group.add(sky);
  return group;
}
