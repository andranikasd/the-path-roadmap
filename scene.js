import * as THREE from './vendor/three.module.min.js';

// The route: month -> a switchback climbing an island from the south shore to the summit.
const PEAK = 880;
const TOTAL = 36;
const LANE = 48;
const SUMMIT = { x: 0, z: -1150 };
const START_Z = 1250;
const LEGS = 2.25;
// Lanes keep phases that overlap in time apart.
const LANES = { systems: 1, network: 2, code: -1, cloud: 1, k8s: -2, security: -1, data: 2, principal: 1 };
let AMP = 1150;

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (v) => { const x = clamp(v); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;
const roadT = (m) => clamp((m - 1) / TOTAL);
const baseH = (x, z) => {
  const dist = Math.hypot(x - SUMMIT.x, z - SUMMIT.z);
  return 30 + PEAK * Math.pow(Math.max(0, 1 - dist / 2900), 1.6);
};
function centerXZ(t) {
  const swing = AMP * (1 - 0.92 * Math.pow(t, 1.5));
  return [swing * Math.sin(t * LEGS * Math.PI * 2), lerp(START_Z, SUMMIT.z, t)];
}
function roadPoint(t, lane = 0, lift = 6) {
  const [x, z] = centerXZ(t);
  const [ax, az] = centerXZ(clamp(t - 0.002));
  const [bx, bz] = centerXZ(clamp(t + 0.002));
  const len = Math.hypot(bx - ax, bz - az) || 1;
  const px = x + (-(bz - az) / len) * lane;
  const pz = z + ((bx - ax) / len) * lane;
  return new THREE.Vector3(px, baseH(px, pz) + lift, pz);
}

/* Terrain */

const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function noise(x, y) {
  const xi = Math.floor(x); const yi = Math.floor(y);
  const u = smooth(x - xi); const v = smooth(y - yi);
  return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), u), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v);
}
function fbm(x, y) {
  let sum = 0; let amp = 0.5; let f = 1;
  for (let i = 0; i < 4; i += 1) { sum += amp * noise(x * f, y * f); amp *= 0.5; f *= 2.1; }
  return sum;
}
let routeSamples = [];
function buildRouteSamples() {
  routeSamples = [];
  for (let i = 0; i <= 260; i += 1) { const t = i / 260; const [x, z] = centerXZ(t); routeSamples.push([x, z, t]); }
}
function routeDistance(x, z) {
  let best = Infinity;
  for (let i = 0; i < routeSamples.length; i += 1) {
    const dx = routeSamples[i][0] - x; const dz = routeSamples[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
function terrainHeight(x, z) {
  const d = routeDistance(x, z);
  const n = fbm(x * 0.0032 + 40, z * 0.0032 + 90) - 0.42;
  const fine = fbm(x * 0.012, z * 0.012) - 0.45;
  const free = smooth((d - 125) / 170);
  const land = baseH(x, z) + (n * 240 + fine * 34) * free;
  const edge = Math.hypot(x / 2400, (z + 100) / 2200) + (fbm(x * 0.0016 + 7, z * 0.0016 + 3) - 0.45) * 0.34;
  const mask = 1 - smooth((edge - 0.8) / 0.2);
  return land * mask - 90 * (1 - mask);
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.18, 'rgba(255,255,255,.55)');
  r.addColorStop(0.5, 'rgba(255,255,255,.12)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// Sky colours by climb: night at the base, sunrise at the summit.
const SKY_DARK = [[0, '#0d1a2e', '#14283f'], [0.6, '#16203f', '#2a2f52'], [1, '#2b3a6b', '#6a5a72']];
const SKY_LIGHT = [[0, '#b9d4e6', '#dbe8ee'], [1, '#c2d6ea', '#f2e4d2']];

function skyAt(stops, t) {
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1][0]) i += 1;
  const [a, b] = [stops[i], stops[i + 1]];
  const u = clamp((t - a[0]) / (b[0] - a[0]));
  return [new THREE.Color(a[1]).lerp(new THREE.Color(b[1]), u), new THREE.Color(a[2]).lerp(new THREE.Color(b[2]), u)];
}

export function createScene({ canvas, labelRoot, data, labels, isDone, callbacks }) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const portraitStart = window.innerHeight > window.innerWidth;
  AMP = portraitStart ? 660 : 1150;
  buildRouteSamples();
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 1.75));
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x14283f, 0.00009);
  const camera = new THREE.PerspectiveCamera(38, 1, 10, 30000);

  const palette = {};
  const readPalette = () => {
    const style = getComputedStyle(document.documentElement);
    data.phases.forEach((p) => { palette[p.id] = new THREE.Color(style.getPropertyValue(`--s${p.n}`).trim()); });
  };
  readPalette();
  const glow = glowTexture();

  const phaseFocusAt = (m) => data.phases.filter((p) => m >= p.start && m <= p.end);
  let month = 1;
  let monthF = 1;
  let active = null;
  let selectedTopic = null;

  /* Sky, light, stars */
  const skyUniforms = { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } };
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(20000, 24, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyUniforms,
    vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying float h; void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.02, 0.2, h)), 1.0); }',
  })));
  const hemi = new THREE.HemisphereLight(0xaab8ff, 0x1a1712, 1.2);
  const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
  scene.add(hemi, sunLight);
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffb070, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
  sun.scale.setScalar(2600);
  scene.add(sun);
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(1500 * 3);
  for (let i = 0; i < 1500; i += 1) {
    const u = hash(i, 1) * Math.PI * 2; const v = 0.03 + hash(i, 2) * 0.97;
    const s = Math.sqrt(1 - v * v);
    starPos.set([Math.cos(u) * s * 8000, v * 8000, Math.sin(u) * s * 8000], i * 3);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.7, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false }));
  scene.add(stars);

  function applySky() {
    const t = roadT(monthF);
    const light = document.documentElement.dataset.theme === 'light';
    const [top, bottom] = skyAt(light ? SKY_LIGHT : SKY_DARK, t);
    skyUniforms.top.value.copy(top);
    skyUniforms.bottom.value.copy(bottom);
    scene.fog.color.copy(bottom);
    stars.material.opacity = light ? 0 : 1 - smooth((t - 0.5) / 0.45);
    const elevation = lerp(0.02, 0.2, t);
    sun.position.set(Math.cos(0.7) * Math.cos(elevation), Math.sin(elevation), -Math.abs(Math.sin(0.7)) * Math.cos(elevation)).multiplyScalar(15000);
    sun.material.opacity = light ? 0.2 : 0.4 * smooth((t - 0.3) / 0.6);
    // A fixed low light from the north-west, the way hill shading works on printed maps.
    sunLight.position.set(-0.62, 0.62, -0.32);
    sunLight.color.set(0xfff6ea);
    sunLight.intensity = light ? 3.0 : 2.5;
    hemi.intensity = light ? 2.1 : 1.35;
    water.material.color.set(light ? '#9cc3d6' : '#10283f');
  }

  /* Island: territories, hill shading and contour lines */
  const trailPos = (phase, m) => {
    const ease = smooth((m - phase.start) / 0.9) * smooth((phase.end + 1 - m) / 0.9);
    return roadPoint(roadT(m), (LANES[phase.id] || 1) * LANE * ease, 7);
  };
  const regionPts = data.phases.flatMap((phase) => {
    const span = phase.end + 1 - phase.start;
    return Array.from({ length: Math.max(6, span * 2) + 1 }, (_, i) => {
      const p = trailPos(phase, phase.start + (i / Math.max(6, span * 2)) * span);
      return [p.x, p.z, phase];
    });
  });
  const seg = small ? 130 : 230;
  const landGeo = new THREE.PlaneGeometry(6800, 6800, seg, seg);
  landGeo.rotateX(-Math.PI / 2);
  const lp = landGeo.attributes.position;
  const lc = new Float32Array(lp.count * 3);
  const low = new THREE.Color('#5d7661'); const mid = new THREE.Color('#857f70'); const snow = new THREE.Color('#f1f3f6'); const sand = new THREE.Color('#b9ab86');
  const face = new THREE.Color();
  const tint = new THREE.Color();
  for (let i = 0; i < lp.count; i += 1) {
    const x = lp.getX(i); const z = lp.getZ(i);
    const y = terrainHeight(x, z);
    lp.setY(i, y);
    const h = clamp(y / PEAK);
    face.copy(low).lerp(mid, smooth((h - 0.12) / 0.4)).lerp(snow, smooth((h - 0.68) / 0.16));
    if (y < 16) face.lerp(sand, 1 - smooth(y / 16));
    // Blend the nearest trails so territory borders stay soft at any zoom.
    const nearest = {};
    regionPts.forEach(([px, pz, phase]) => { const d = (px - x) ** 2 + (pz - z) ** 2; if (!(nearest[phase.id] < d)) nearest[phase.id] = d; });
    let weight = 0; let best = Infinity; tint.setRGB(0, 0, 0);
    Object.entries(nearest).forEach(([id, d2]) => {
      const d = Math.sqrt(d2);
      if (d < best) best = d;
      const w = Math.exp(-d / 55);
      weight += w;
      tint.r += palette[id].r * w; tint.g += palette[id].g * w; tint.b += palette[id].b * w;
    });
    if (weight > 0 && y > 8) {
      tint.multiplyScalar(1 / weight);
      face.lerp(tint, 0.5 * (1 - smooth((best - 120) / 520)) * (1 - smooth((h - 0.62) / 0.2)));
    }
    lc.set([face.r, face.g, face.b], i * 3);
  }
  landGeo.setAttribute('color', new THREE.BufferAttribute(lc, 3));
  landGeo.computeVertexNormals();
  const landMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  landMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vHeight;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeight = position.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vHeight;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float cv = vHeight / 40.0;
        float cl = abs(fract(cv - 0.5) - 0.5) / max(fwidth(cv), 0.0001);
        float major = abs(fract(cv / 5.0 - 0.5) - 0.5) / max(fwidth(cv / 5.0), 0.0001);
        float above = smoothstep(2.0, 8.0, vHeight);
        diffuseColor.rgb *= mix(1.0, mix(0.8, 1.0, smoothstep(0.0, 1.1, cl)), above);
        diffuseColor.rgb *= mix(1.0, mix(0.62, 1.0, smoothstep(0.0, 1.4, major)), above);
        diffuseColor.rgb += (1.0 - smoothstep(-5.0, 3.0, abs(vHeight))) * 0.22;`);
  };
  scene.add(new THREE.Mesh(landGeo, landMat));
  const water = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), new THREE.MeshBasicMaterial({ color: '#10283f' }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = -1;
  scene.add(water);

  /* Road and braided phase trails */
  const makeTrail = (points, radius, color) => {
    const curve = new THREE.CatmullRomCurve3(points);
    const segments = points.length * 2;
    const geo = new THREE.TubeGeometry(curve, segments, radius, 5, false);
    const base = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, fog: false }));
    const lit = new THREE.Mesh(geo.clone(), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, fog: false }));
    scene.add(base, lit);
    return { base, lit, indexCount: geo.index.count, litFrac: 0 };
  };
  const roadPts = [];
  for (let i = 0; i <= 420; i += 1) roadPts.push(roadPoint(i / 420, 0, 5));
  const road = makeTrail(roadPts, 2.2, new THREE.Color('#f4efe6'));

  const trails = {};
  data.phases.forEach((phase) => {
    const span = phase.end + 1 - phase.start;
    const n = Math.max(40, span * 18);
    const pts = [];
    for (let i = 0; i <= n; i += 1) pts.push(trailPos(phase, phase.start + (i / n) * span));
    const trail = makeTrail(pts, 3.4, palette[phase.id]);
    trail.pts = pts;
    trail.phase = phase;
    trails[phase.id] = trail;
  });

  /* Camps, beacons, gates */
  const pickables = [];
  const anchors = [];
  const beacons = {};
  const towers = {};
  const discGeo = new THREE.CylinderGeometry(1, 1.14, 1, 6);
  const crystalGeo = new THREE.OctahedronGeometry(1, 0);
  const postGeo = new THREE.CylinderGeometry(0.7, 0.9, 1, 5);
  const addGlow = (color, scale, y = 0) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 }));
    s.scale.setScalar(scale); s.position.y = y;
    return s;
  };
  const addLabel = (node, pos, kind, phase, extra = {}) => {
    labelRoot.append(node);
    const anchor = { node, pos: pos.clone(), kind, phase, shown: null, w: 0, h: 0, ...extra };
    anchors.push(anchor);
    return anchor;
  };

  data.phases.forEach((phase) => {
    const color = palette[phase.id];
    const lane = LANES[phase.id] || 1;
    const midM = phase.start + (phase.end + 1 - phase.start) * 0.5;
    const edgeLane = lane * LANE * 1 + Math.sign(lane) * 34;
    const base = roadPoint(roadT(midM), edgeLane, 0);
    const tower = new THREE.Group();
    tower.position.copy(base);
    tower.scale.setScalar(1.45);
    const discs = phase.topics.map((topic, i) => {
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a3c44'), emissive: color, emissiveIntensity: 0.06, flatShading: true });
      const disc = new THREE.Mesh(discGeo, mat);
      const rad = lerp(21, 9, i / phase.topics.length);
      disc.scale.set(rad, 6.5, rad);
      disc.position.y = 3 + i * 7.2;
      disc.userData = { phase };
      pickables.push(disc);
      tower.add(disc);
      return { disc, mat, topic };
    });
    const topY = 8 + phase.topics.length * 7.2;
    const crown = new THREE.Mesh(crystalGeo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2, flatShading: true }));
    crown.scale.set(8, 13, 8);
    crown.position.y = topY + 8;
    crown.userData = { phase };
    pickables.push(crown);
    const halo = addGlow(color, 150, topY + 8);
    tower.add(crown, halo);
    scene.add(tower);
    towers[phase.id] = { group: tower, discs, crown, halo, top: base.clone().setY(base.y + (topY + 8) * 1.45) };
    addLabel(labels.phase(phase), towers[phase.id].top.clone().setY(base.y + (topY + 8) * 1.45 + 26), 'phase', phase);

    const span = phase.end + 1 - phase.start;
    phase.topics.forEach((topic, i) => {
      const m = phase.start + ((i + 0.5) / phase.topics.length) * span;
      const pos = trailPos(phase, m);
      const g = new THREE.Group();
      g.position.copy(pos);
      const post = new THREE.Mesh(postGeo, new THREE.MeshStandardMaterial({ color: '#2a2c33', flatShading: true }));
      post.scale.set(1.2, 15, 1.2); post.position.y = 7;
      const mat = new THREE.MeshStandardMaterial({ color: '#70727c', emissive: color, emissiveIntensity: 0.28, flatShading: true });
      const crystal = new THREE.Mesh(crystalGeo, mat);
      crystal.scale.set(6, 8.5, 6); crystal.position.y = 20;
      const halo2 = addGlow(color, 46, 20);
      const beam = new THREE.Mesh(postGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      beam.scale.set(1.5, 90, 1.5); beam.position.y = 65; beam.visible = false;
      crystal.userData = { phase, topic };
      pickables.push(crystal);
      g.add(post, crystal, halo2, beam);
      scene.add(g);
      beacons[topic.id] = { group: g, crystal, mat, halo: halo2, beam, phase, topic, m, seed: i * 1.7, pos };
      addLabel(labels.topic(phase, topic), pos.clone().setY(pos.y + 32), 'topic', phase, { topic });
    });

    phase.certs.forEach((cert) => {
      const m = clamp(cert.month + 0.5, phase.start + 0.2, phase.end + 0.8);
      const pos = trailPos(phase, m);
      const gate = new THREE.Group();
      gate.position.copy(pos);
      const tangent = trailPos(phase, m + 0.1).sub(pos).setY(0).normalize();
      gate.rotation.y = Math.atan2(-tangent.z, tangent.x) + Math.PI / 2;
      const mat = new THREE.MeshStandardMaterial({ color: '#d8d6cf', emissive: color, emissiveIntensity: 0.5, flatShading: true });
      [-13, 13].forEach((x) => { const leg = new THREE.Mesh(postGeo, mat); leg.scale.set(1.5, 30, 1.5); leg.position.set(x, 15, 0); gate.add(leg); });
      const bar = new THREE.Mesh(new THREE.BoxGeometry(32, 3, 3), mat);
      bar.position.y = 30; gate.add(bar);
      bar.userData = { phase, exam: true };
      pickables.push(bar);
      gate.userData.core = cert.core;
      scene.add(gate);
      const anchor = addLabel(labels.exam(phase, cert), pos.clone().setY(pos.y + 40), 'exam', phase, { cert, gate });
      anchor.gate = gate;
    });
  });

  /* Dependency arcs, shown for the phase in focus */
  const arcs = [];
  data.phases.forEach((phase) => phase.needs.forEach((need) => {
    const a = towers[need].top; const b = towers[phase.id].top;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y += 90 + a.distanceTo(b) * 0.22;
    const pts = new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(50);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 50, 1.7, 5, false), new THREE.MeshBasicMaterial({ color: palette[need], transparent: true, opacity: 0, fog: false, depthWrite: false }));
    mesh.visible = false;
    scene.add(mesh);
    arcs.push({ mesh, from: need, to: phase.id });
  }));

  /* Hiker */
  const hiker = new THREE.Group();
  const hikerCore = new THREE.Mesh(new THREE.SphereGeometry(5.5, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
  hikerCore.position.y = 14;
  const hikerGlow = addGlow(0xffffff, 90, 14);
  const hikerBeam = new THREE.Mesh(new THREE.CylinderGeometry(1, 4, 110, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  hikerBeam.position.y = 70;
  hiker.add(hikerCore, hikerGlow, hikerBeam);
  scene.add(hiker);

  [6, 12, 18, 24, 30].forEach((m) => {
    addLabel(labels.mile(m), roadPoint(roadT(m + 1)).setY(roadPoint(roadT(m + 1)).y + 8), 'mile', { id: null }, { major: m % 12 === 0 });
  });
  addLabel(labels.mile(0), roadPoint(0).setY(roadPoint(0).y + 8), 'mile', { id: null }, { major: true });
  addLabel(labels.mile(36), roadPoint(1).setY(roadPoint(1).y + 8), 'mile', { id: null }, { major: true });
  const youAnchor = addLabel(labels.you(), new THREE.Vector3(), 'you', { id: null });

  /* Flowing energy and bursts */
  const FLOW = small ? 120 : 260;
  const flowGeo = new THREE.BufferGeometry();
  const flowPos = new Float32Array(FLOW * 3);
  const flowCol = new Float32Array(FLOW * 3);
  flowGeo.setAttribute('position', new THREE.BufferAttribute(flowPos, 3));
  flowGeo.setAttribute('color', new THREE.BufferAttribute(flowCol, 3));
  const flow = new THREE.Points(flowGeo, new THREE.PointsMaterial({ size: 9, map: glow, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  flow.frustumCulled = false;
  scene.add(flow);
  const trailList = Object.values(trails);
  const flowers = Array.from({ length: FLOW }, (_, i) => ({ trail: trailList[i % trailList.length], u: hash(i, 7), speed: 0.012 + hash(i, 9) * 0.02 }));

  const BURST = 500;
  const burstGeo = new THREE.BufferGeometry();
  const burstPos = new Float32Array(BURST * 3).fill(-99999);
  const burstCol = new Float32Array(BURST * 3);
  burstGeo.setAttribute('position', new THREE.BufferAttribute(burstPos, 3));
  burstGeo.setAttribute('color', new THREE.BufferAttribute(burstCol, 3));
  const burst = new THREE.Points(burstGeo, new THREE.PointsMaterial({ size: 11, map: glow, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  burst.frustumCulled = false;
  scene.add(burst);
  const sparks = Array.from({ length: BURST }, () => ({ life: 0, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1 }));
  let sparkCursor = 0;
  function emit(pos, color, count, speed = 90) {
    if (reduced) return;
    for (let i = 0; i < count; i += 1) {
      const s = sparks[sparkCursor];
      const a = Math.random() * 6.28; const e = Math.random() * 1.4;
      const v = speed * (0.4 + Math.random());
      s.vx = Math.cos(a) * Math.cos(e) * v; s.vy = Math.sin(e) * v + speed * 0.4; s.vz = Math.sin(a) * Math.cos(e) * v;
      s.life = 0.8 + Math.random() * 0.9;
      s.r = color.r; s.g = color.g; s.b = color.b;
      burstPos.set([pos.x, pos.y, pos.z], sparkCursor * 3);
      sparkCursor = (sparkCursor + 1) % BURST;
    }
  }

  /* Camera rig */
  const overviewDist = () => (window.innerHeight > window.innerWidth ? 7400 : 5000);
  const FRONT = Math.PI / 2;
  const HOME = new THREE.Vector3(0, 180, 150);
  const rig = { tx: 0, ty: 180, tz: 300, az: FRONT - 0.3, pol: 1.05, dist: overviewDist() * 1.25 };
  const goal = { tx: HOME.x, ty: HOME.y, tz: HOME.z, az: FRONT, pol: 0.74, dist: overviewDist() };
  let viewShift = { x: 0, y: 0 };
  let viewShiftGoal = { x: 0, y: 0 };
  let journey = null;
  if (reduced) Object.assign(rig, goal);

  const nearestAngle = (from, to) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from));
  function aim(pos, dist, pol = goal.pol, az = goal.az) {
    goal.tx = pos.x; goal.ty = pos.y; goal.tz = pos.z;
    goal.dist = clamp(dist, 200, 9000);
    goal.pol = pol;
    goal.az = nearestAngle(rig.az, az);
    if (reduced) Object.assign(rig, goal);
  }

  function overview() {
    active = null; selectedTopic = null;
    aim(HOME, overviewDist(), 0.74, FRONT);
  }
  function focusPhase(id) {
    const trail = trails[id];
    const box = new THREE.Box3().setFromPoints(trail.pts);
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const portrait = window.innerHeight > window.innerWidth;
    active = id; selectedTopic = null;
    aim(center, Math.max(1000, radius * (portrait ? 3.8 : 2.7)), 0.8, FRONT);
  }
  function focusTopic(id) {
    const b = beacons[id];
    if (!b) return;
    active = b.phase.id; selectedTopic = id;
    aim(b.pos.clone().setY(b.pos.y + 24), 640, 0.92, FRONT);
    emit(b.crystal.getWorldPosition(new THREE.Vector3()), palette[b.phase.id], 18, 50);
  }
  function focusMonth(m) {
    const p = roadPoint(roadT(m));
    aim(p, 1000, 0.85, FRONT);
  }

  /* State from the app */
  function sync() {
    data.phases.forEach((phase) => {
      towers[phase.id].discs.forEach(({ mat, topic }) => {
        const done = isDone(`t:${topic.id}`);
        mat.emissiveIntensity = done ? 1.5 : 0.05;
        mat.color.set(done ? palette[phase.id] : '#3a3c44');
      });
      phase.topics.forEach((topic) => {
        const b = beacons[topic.id];
        const done = isDone(`t:${topic.id}`);
        b.mat.emissiveIntensity = done ? 1.8 : 0.28;
        b.mat.color.set(done ? palette[phase.id] : '#70727c');
        b.beam.visible = done;
        b.halo.scale.setScalar(done ? 84 : 46);
      });
    });
    anchors.filter((a) => a.gate).forEach((a) => { a.gate.visible = !a.node.hidden; });
  }
  function setMonth(m) {
    month = m;
    if (!journey) monthTarget = m;
  }
  let monthTarget = 1;
  function setActive(id) { active = id; }
  function setPanelShift(x, y) { viewShiftGoal = { x, y }; }
  function refreshTheme() { readPalette(); applySky(); }

  function celebrate(topicId, wholePhase) {
    const b = beacons[topicId];
    if (!b) return;
    const color = palette[b.phase.id];
    emit(b.crystal.getWorldPosition(new THREE.Vector3()), color, 60, 90);
    if (wholePhase) emit(towers[b.phase.id].top, color, 240, 190);
  }

  function startJourney(from, onMonth, onEnd) {
    monthF = from; monthTarget = from;
    journey = { onMonth, onEnd, last: from };
  }
  function stopJourney() { journey = null; monthTarget = month; }

  /* Pointer input */
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  let moved = false;
  const stage = canvas.parentElement;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const zoomHit = new THREE.Vector3();

  function panBy(dx, dy) {
    const scale = (rig.dist * 0.69) / window.innerHeight;
    const rx = Math.sin(rig.az); const rz = -Math.cos(rig.az);
    const fx = -Math.cos(rig.az); const fz = -Math.sin(rig.az);
    goal.tx = clamp(goal.tx - rx * dx * scale + fx * dy * scale, -2400, 2400);
    goal.tz = clamp(goal.tz - rz * dx * scale + fz * dy * scale, -2200, 2200);
    if (reduced) Object.assign(rig, goal);
  }
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button,input,label')) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    stage.setPointerCapture(e.pointerId);
    moved = false;
    callbacks.onUserInput();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 };
      drag = null;
      return;
    }
    drag = { x: e.clientX, y: e.clientY, pan: !(e.button === 2 || e.shiftKey) };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) { hover(e); return; }
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      goal.dist = clamp(goal.dist * (pinch.d / d), 200, 9000);
      panBy((a[0] + b[0]) / 2 - pinch.x, (a[1] + b[1]) / 2 - pinch.y);
      pinch = { d, x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 };
      moved = true;
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x; const dy = e.clientY - drag.y;
    if (!moved && Math.hypot(dx, dy) < 5) return;
    moved = true;
    stage.classList.add('grabbing');
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.pan) panBy(dx, dy);
    else {
      goal.az += dx * 0.0052;
      goal.pol = clamp(goal.pol - dy * 0.004, 0.2, 1.38);
    }
    if (reduced) Object.assign(rig, goal);
  });
  const release = (e) => {
    const wasClick = pointers.has(e.pointerId) && !moved && pointers.size === 1;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) { drag = null; stage.classList.remove('grabbing'); }
    if (wasClick && e.type === 'pointerup') {
      const hit = pick(e);
      if (hit?.topic) callbacks.onTopic(hit.phase.id, hit.topic.id);
      else if (hit?.exam) callbacks.onExam(hit.phase.id);
      else if (hit?.phase) callbacks.onPhase(hit.phase.id);
    }
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    callbacks.onUserInput();
    const before = goal.dist;
    goal.dist = clamp(goal.dist * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0012)), 200, 9000);
    // Zoom toward the cursor, as on any map.
    const box = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - box.left) / box.width) * 2 - 1, -((e.clientY - box.top) / box.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -rig.ty), zoomHit)) {
      const f = 1 - goal.dist / before;
      goal.tx = clamp(goal.tx + (zoomHit.x - goal.tx) * f, -2400, 2400);
      goal.tz = clamp(goal.tz + (zoomHit.z - goal.tz) * f, -2200, 2200);
    }
    if (reduced) Object.assign(rig, goal);
  }, { passive: false });

  function pick(e) {
    const box = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - box.left) / box.width) * 2 - 1, -((e.clientY - box.top) / box.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObjects(pickables, false)[0]?.object.userData || null;
  }
  let hovered = null;
  function hover(e) {
    if (e.pointerType === 'touch') return;
    const hit = pick(e);
    stage.classList.toggle('over', Boolean(hit));
    const id = hit?.phase?.id || null;
    if (id !== hovered) { hovered = id; callbacks.onHover(id); }
  }

  /* Frame */
  function resize() {
    const w = window.innerWidth; const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    applyView();
  }
  function applyView() {
    const w = window.innerWidth; const h = window.innerHeight;
    camera.setViewOffset(w, h, viewShift.x, viewShift.y, w, h);
    camera.updateProjectionMatrix();
  }

  const screen = new THREE.Vector3();
  const taken = [];
  function occluded(pos) {
    for (let i = 1; i <= 7; i += 1) {
      const u = i / 8;
      const x = lerp(pos.x, camera.position.x, u);
      const y = lerp(pos.y, camera.position.y, u);
      const z = lerp(pos.z, camera.position.z, u);
      if (y < baseH(x, z) - 8) return true;
    }
    return false;
  }
  function place(a, x, y, on) {
    if (on !== a.shown) {
      a.node.classList.toggle('off', !on);
      a.shown = on;
    }
    if (on) a.node.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-100%)`;
  }
  function placeLabels() {
    const far = rig.dist > 1700;
    if (far !== labelRoot.classList.contains('far')) {
      labelRoot.classList.toggle('far', far);
      anchors.forEach((a) => { a.w = 0; });
    }
    const w = window.innerWidth; const h = window.innerHeight;
    taken.length = 0;
    const ranked = anchors.map((a) => {
      if (!a.w && a.node.offsetWidth) { a.w = a.node.offsetWidth; a.h = a.node.offsetHeight; }
      const d = camera.position.distanceTo(a.pos);
      let score = d;
      if (a.kind === 'phase') score = -1e6 + d;
      if (a.kind === 'you') score = -3e6;
      if (a.kind === 'mile') score = -2e5 + d;
      if (a.kind === 'exam') score = -1e5 + d;
      if (a.topic && a.topic.id === selectedTopic) score = -2e6;
      else if (a.kind === 'exam' && (a.node.classList.contains('due') || a.phase?.id === active)) score = -5e5 + d;
      else if (a.phase?.id === active) score = -4e5 + d;
      return { a, d, score };
    }).sort((p, q) => p.score - q.score);
    ranked.forEach(({ a, d }) => {
      const related = a.phase?.id === active;
      let want = !a.node.hidden;
      if (a.kind === 'mile') want = want && (a.major || rig.dist < 3400);
      
      if (want) {
        screen.copy(a.pos).project(camera);
        if (screen.z > 1 || Math.abs(screen.x) > 1.2 || Math.abs(screen.y) > 1.2) want = false;
      }
      if (want && a.kind !== 'phase' && a.kind !== 'you' && occluded(a.pos)) want = false;
      let x = (screen.x * 0.5 + 0.5) * w;
      let y = (-screen.y * 0.5 + 0.5) * h;
      if (want && a.w) {
        const hits = (box) => taken.find((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1]);
        const boxAt = (py) => [x - a.w / 2 - 3, py - a.h - 3, x + a.w / 2 + 3, py + 3];
        if (a.kind === 'phase' || a.kind === 'you') {
          x = clamp(x, a.w / 2 + 6, w - a.w / 2 - 6);
          // Must-show labels step upward until they are clear, and glide there.
          let py = y; let hit = hits(boxAt(py)); let guard = 0;
          while (hit && guard < 8) { py = hit[1] - 4; hit = hits(boxAt(py)); guard += 1; }
          a.lift = lerp(a.lift ?? 0, y - py, reduced ? 1 : 0.14);
          y -= a.lift;
          taken.push(boxAt(y));
        } else if (a.kind === 'topic' && labelRoot.classList.contains('far')) {
          // Far away every topic stays pinned, even when pins touch.
        } else if (hits(boxAt(y))) want = false;
        else taken.push(boxAt(y));
      }
      place(a, x, y, want);
    });
  }

  let last = performance.now();
  let running = true;
  let wasOnMonth = 1;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!running || document.hidden) { last = now; return; }
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = now;
    const time = now / 1000;

    if (journey) {
      monthF += dt * 0.88;
      if (monthF >= TOTAL + 1) {
        monthF = TOTAL + 0.999;
        const { onEnd } = journey;
        journey = null;
        emit(towers.principal.top, new THREE.Color('#ffd9a0'), 300, 240);
        onEnd();
      } else {
        const whole = Math.floor(monthF);
        if (whole !== journey.last) { journey.last = whole; month = whole; journey.onMonth(whole); }
        const p = roadPoint(roadT(monthF));
        goal.tx = p.x; goal.ty = p.y + 10; goal.tz = p.z;
        goal.dist = 1050; goal.pol = 0.86;
        goal.az = nearestAngle(rig.az, FRONT + Math.sin(monthF * 0.35) * 0.22);
      }
    } else {
      monthF += (monthTarget + 0.5 - monthF) * (reduced ? 1 : 1 - Math.exp(-dt * 4));
    }

    const ease = reduced ? 1 : 1 - Math.exp(-dt * 3.2);
    rig.tx += (goal.tx - rig.tx) * ease;
    rig.ty += (goal.ty - rig.ty) * ease;
    rig.tz += (goal.tz - rig.tz) * ease;
    rig.az += (goal.az - rig.az) * ease;
    rig.pol += (goal.pol - rig.pol) * ease;
    rig.dist *= Math.exp(Math.log(goal.dist / rig.dist) * ease);
    camera.position.set(
      rig.tx + rig.dist * Math.sin(rig.pol) * Math.cos(rig.az),
      rig.ty + rig.dist * Math.cos(rig.pol),
      rig.tz + rig.dist * Math.sin(rig.pol) * Math.sin(rig.az),
    );
    const floor = terrainHeight(camera.position.x, camera.position.z) + 40;
    if (camera.position.y < floor) camera.position.y = floor;
    camera.lookAt(rig.tx, rig.ty, rig.tz);

    if (Math.abs(viewShift.x - viewShiftGoal.x) > 0.5 || Math.abs(viewShift.y - viewShiftGoal.y) > 0.5) {
      viewShift.x += (viewShiftGoal.x - viewShift.x) * ease;
      viewShift.y += (viewShiftGoal.y - viewShift.y) * ease;
      applyView();
    }

    applySky();

    // Trails: walked part shines, the rest waits.
    const setLit = (trail, frac) => {
      const f = clamp(frac);
      if (Math.abs(f - trail.litFrac) > 0.0005 || f === 0) {
        trail.lit.geometry.setDrawRange(0, Math.floor(trail.indexCount * f / 6) * 6);
        trail.lit.visible = f > 0;
        trail.litFrac = f;
      }
    };
    setLit(road, roadT(monthF));
    const hoverFade = (id) => (!active || id === active ? 1 : 0.22);
    trailList.forEach((trail) => {
      const p = trail.phase;
      setLit(trail, (monthF - p.start) / (p.end + 1 - p.start));
      const fade = hoverFade(p.id);
      trail.base.material.opacity = 0.72 * fade;
      trail.lit.material.opacity = fade;
    });

    const inFocus = (p) => monthF >= p.start && monthF < p.end + 1;
    Object.values(beacons).forEach((b) => {
      const y = 20 + (reduced ? 0 : Math.sin(time * 1.3 + b.seed) * 1.7);
      b.crystal.position.y = y; b.halo.position.y = y;
      if (!reduced) b.crystal.rotation.y = time * 0.7 + b.seed;
      const chosen = b.topic.id === selectedTopic;
      b.halo.material.opacity = (chosen ? 1 : 0.75) * hoverFade(b.phase.id);
      const s = chosen ? 1.5 + Math.sin(time * 4) * 0.12 : 1;
      b.crystal.scale.set(6 * s, 8.5 * s, 6 * s);
    });
    Object.entries(towers).forEach(([id, t]) => {
      const p = trails[id].phase;
      const on = inFocus(p);
      const pulse = reduced ? 1 : 1 + Math.sin(time * 2.2) * 0.08;
      t.halo.scale.setScalar((on ? 150 : 90) * (on ? pulse : 1));
      t.halo.material.opacity = (on ? 0.6 : 0.3) * hoverFade(id);
      t.crown.material.emissiveIntensity = on ? 1.7 : 0.8;
      if (!reduced) t.crown.rotation.y = time * 0.5;
    });
    arcs.forEach((arc) => {
      const related = active && (arc.to === active || arc.from === active);
      arc.mesh.material.opacity += ((related ? 0.9 : 0) - arc.mesh.material.opacity) * 0.12;
      arc.mesh.visible = arc.mesh.material.opacity > 0.01;
    });

    const hp = roadPoint(roadT(monthF));
    hiker.position.copy(hp);
    youAnchor.pos.copy(hp).setY(hp.y + 34);
    hikerCore.position.y = 14 + (reduced ? 0 : Math.sin(time * 3) * 2);

    // Energy runs along the trails, strongest where you are now.
    flowers.forEach((f, i) => {
      if (!reduced) f.u = (f.u + f.speed * dt) % 1;
      const pts = f.trail.pts;
      const v = f.u * (pts.length - 1);
      const k = Math.floor(v);
      const a = pts[k]; const b = pts[Math.min(k + 1, pts.length - 1)];
      const u = v - k;
      flowPos.set([lerp(a.x, b.x, u), lerp(a.y, b.y, u) + 4, lerp(a.z, b.z, u)], i * 3);
      const c = palette[f.trail.phase.id];
      const glowAmt = (inFocus(f.trail.phase) ? 1 : 0.32) * hoverFade(f.trail.phase.id);
      flowCol.set([c.r * glowAmt, c.g * glowAmt, c.b * glowAmt], i * 3);
    });
    flowGeo.attributes.position.needsUpdate = true;
    flowGeo.attributes.color.needsUpdate = true;
    flow.material.size = clamp(rig.dist * 0.0052, 7, 22);

    let live = false;
    sparks.forEach((s, i) => {
      if (s.life <= 0) return;
      live = true;
      s.life -= dt;
      s.vy -= 110 * dt;
      burstPos[i * 3] += s.vx * dt; burstPos[i * 3 + 1] += s.vy * dt; burstPos[i * 3 + 2] += s.vz * dt;
      const o = clamp(s.life);
      burstCol.set([s.r * o, s.g * o, s.b * o], i * 3);
      if (s.life <= 0) burstCol.set([0, 0, 0], i * 3);
    });
    if (live) { burstGeo.attributes.position.needsUpdate = true; burstGeo.attributes.color.needsUpdate = true; }

    camera.updateMatrixWorld();
    placeLabels();
    renderer.render(scene, camera);
    wasOnMonth = month;
  }

  resize();
  applySky();
  sync();
  requestAnimationFrame(frame);

  const api = {
    overview, focusPhase, focusTopic, focusMonth, setMonth, setActive, setPanelShift, sync, resize, refreshTheme, celebrate,
    startJourney, stopJourney,
    pan: panBy,
    orbit: (d) => { goal.az += d; },
    tilt: (d) => { goal.pol = clamp(goal.pol + d, 0.22, 1.5); },
    zoom: (f) => { goal.dist = clamp(goal.dist * f, 200, 9000); },
    pause: (value) => { running = !value; },
    debug: () => ({ rig: { ...rig }, goal: { ...goal }, monthF, month, active, selectedTopic, shown: anchors.filter((a) => a.shown).length, anchors: anchors.length, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
  };
  return api;
}
