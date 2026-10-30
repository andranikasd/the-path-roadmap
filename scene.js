import * as THREE from './vendor/three.module.min.js';

// The road: month -> a point on a spiral climbing a cone.
const TURNS = 2.75;
const R0 = 1180;
const R1 = 70;
const BASE = R0 + 260;
const PEAK = 880;
const TOTAL = 36;
const ANGLE0 = 2.4;
const LANE = 48;
// Lanes keep phases that overlap in time apart. Positive is the outer side of the road.
const LANES = { systems: 1, network: 2, code: -1, cloud: 1, k8s: -2, security: -1, data: 2, principal: 1 };

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (v) => { const x = clamp(v); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;
const roadT = (m) => clamp((m - 1) / TOTAL);
const radiusAt = (t) => R1 + (R0 - R1) * Math.pow(1 - t, 0.72);
const angleAt = (t) => ANGLE0 + t * TURNS * Math.PI * 2;
const coneH = (r) => PEAK * Math.pow(Math.max(0, 1 - r / BASE), 1.25);

function roadPoint(t, lane = 0, lift = 3) {
  const r = radiusAt(t) + lane;
  const a = angleAt(t);
  return new THREE.Vector3(r * Math.cos(a), coneH(r) + lift, r * Math.sin(a));
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
function roadInfo(x, z) {
  const r = Math.hypot(x, z);
  const a = Math.atan2(z, x);
  let best = Infinity; let bestT = 0;
  for (let k = -1; k < 5; k += 1) {
    const t = (a + k * Math.PI * 2 - ANGLE0) / (TURNS * Math.PI * 2);
    if (t < -0.02 || t > 1) continue;
    const d = Math.abs(r - radiusAt(clamp(t)));
    if (d < best) { best = d; bestT = clamp(t); }
  }
  return { r, d: best, t: bestT };
}
function terrainHeight(x, z) {
  const { r, d } = roadInfo(x, z);
  const n = fbm(x * 0.0035 + 40, z * 0.0035 + 90) - 0.42;
  const fine = fbm(x * 0.018, z * 0.018) - 0.45;
  const free = smooth((d - 118) / 90);
  const far = smooth((r - BASE + 200) / 900);
  const summit = r < R1 ? 0 : 1;
  return coneH(r) + (n * (110 + far * 620) + fine * 22) * Math.max(free, far) * summit;
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
const SKY_DARK = [
  [0, '#080c20', '#1b2648'], [0.45, '#0d1234', '#33285c'], [0.8, '#161a48', '#7a3a5c'], [1, '#33478f', '#d9936f'],
];
const SKY_LIGHT = [[0, '#8fb8e8', '#e8eef2'], [1, '#5f9be6', '#fbe3c8']];

function skyAt(stops, t) {
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1][0]) i += 1;
  const [a, b] = [stops[i], stops[i + 1]];
  const u = clamp((t - a[0]) / (b[0] - a[0]));
  return [new THREE.Color(a[1]).lerp(new THREE.Color(b[1]), u), new THREE.Color(a[2]).lerp(new THREE.Color(b[2]), u)];
}

export function createScene({ canvas, labelRoot, data, labels, isDone, callbacks }) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 1.75));
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0c1226, 0.00024);
  const camera = new THREE.PerspectiveCamera(42, 1, 10, 12000);

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
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(9000, 24, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyUniforms,
    vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying float h; void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.02, 0.2, h)), 1.0); }',
  })));
  const hemi = new THREE.HemisphereLight(0xaab8ff, 0x1a1712, 1.2);
  const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
  scene.add(hemi, sunLight);
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffb070, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
  sun.scale.setScalar(1000);
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
    stars.material.opacity = light ? 0 : 1 - smooth((t - 0.55) / 0.42);
    const elevation = lerp(-0.1, 0.34, t);
    const dir = new THREE.Vector3(Math.cos(0.7) * Math.cos(elevation), Math.sin(elevation), Math.sin(0.7) * Math.cos(elevation));
    sun.position.copy(dir).multiplyScalar(7000);
    sun.material.opacity = light ? 0.3 : 0.65 * smooth((t - 0.25) / 0.6);
    sunLight.position.copy(dir.y > 0.14 ? dir : new THREE.Vector3(-0.5, 0.7, 0.45));
    sunLight.color.set(light ? 0xfff4e4 : 0xbfcfff).lerp(new THREE.Color(light ? 0xfff4e4 : 0xffb27a), light ? 0 : smooth((t - 0.55) / 0.4));
    sunLight.intensity = light ? 2.4 : lerp(2.6, 3.2, t);
    hemi.intensity = light ? 1.9 : lerp(2.3, 2.2, t);
  }

  /* Terrain */
  const seg = small ? 110 : 170;
  const size = 6400;
  const planeGeo = new THREE.PlaneGeometry(size, size, seg, seg);
  planeGeo.rotateX(-Math.PI / 2);
  const planePos = planeGeo.attributes.position;
  for (let i = 0; i < planePos.count; i += 1) planePos.setY(i, terrainHeight(planePos.getX(i), planePos.getZ(i)));
  const terrainGeo = planeGeo.toNonIndexed();
  planeGeo.dispose();
  const tp = terrainGeo.attributes.position;
  const tc = new Float32Array(tp.count * 3);
  const low = new THREE.Color('#3f5552'); const mid = new THREE.Color('#6a6a70'); const snow = new THREE.Color('#eef1f6');
  const phaseAt = (t) => { const m = 1 + t * TOTAL; const list = phaseFocusAt(Math.floor(m)); return list[list.length - 1]; };
  const face = new THREE.Color();
  for (let i = 0; i < tp.count; i += 3) {
    const x = (tp.getX(i) + tp.getX(i + 1) + tp.getX(i + 2)) / 3;
    const y = (tp.getY(i) + tp.getY(i + 1) + tp.getY(i + 2)) / 3;
    const z = (tp.getZ(i) + tp.getZ(i + 1) + tp.getZ(i + 2)) / 3;
    const h = clamp(y / PEAK);
    face.copy(low).lerp(mid, smooth(h / 0.55)).lerp(snow, smooth((h - 0.72) / 0.2));
    const info = roadInfo(x, z);
    const phase = info.d < 150 ? phaseAt(info.t) : null;
    if (phase) face.lerp(palette[phase.id], 0.42 * (1 - info.d / 150));
    const jitter = 0.92 + hash(x, z) * 0.16;
    for (let j = 0; j < 3; j += 1) tc.set([face.r * jitter, face.g * jitter, face.b * jitter], (i + j) * 3);
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(tc, 3));
  terrainGeo.computeVertexNormals();
  scene.add(new THREE.Mesh(terrainGeo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 })));

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
  for (let i = 0; i <= 360; i += 1) roadPts.push(roadPoint(i / 360, 0, 2));
  const road = makeTrail(roadPts, 2.6, new THREE.Color('#f4efe6'));

  const trails = {};
  const trailPos = (phase, m) => {
    const ease = smooth((m - phase.start) / 0.9) * smooth((phase.end + 1 - m) / 0.9);
    return roadPoint(roadT(m), (LANES[phase.id] || 1) * LANE * ease, 3.5);
  };
  data.phases.forEach((phase) => {
    const span = phase.end + 1 - phase.start;
    const n = Math.max(40, span * 18);
    const pts = [];
    for (let i = 0; i <= n; i += 1) pts.push(trailPos(phase, phase.start + (i / n) * span));
    const trail = makeTrail(pts, 4.4, palette[phase.id]);
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
  const hikerBeam = new THREE.Mesh(new THREE.CylinderGeometry(1, 4, 240, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  hikerBeam.position.y = 134;
  hiker.add(hikerCore, hikerGlow, hikerBeam);
  scene.add(hiker);

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
  const overviewDist = () => (window.innerHeight > window.innerWidth ? 4700 : 3250);
  const rig = { tx: 0, ty: 120, tz: 0, az: 0.2, pol: 1.34, dist: 5000 };
  const goal = { tx: 0, ty: 230, tz: 0, az: 1.05, pol: 1.05, dist: overviewDist() };
  let viewShift = { x: 0, y: 0 };
  let viewShiftGoal = { x: 0, y: 0 };
  let idle = true;
  let journey = null;
  if (reduced) Object.assign(rig, goal);

  const nearestAngle = (from, to) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from));
  function aim(pos, dist, pol = goal.pol, az = goal.az) {
    goal.tx = pos.x; goal.ty = pos.y; goal.tz = pos.z;
    goal.dist = clamp(dist, 120, 6000);
    goal.pol = pol;
    goal.az = nearestAngle(rig.az, az);
    idle = false;
    if (reduced) Object.assign(rig, goal);
  }
  const outerAngle = (pos) => Math.atan2(pos.z, pos.x);

  function overview() {
    active = null; selectedTopic = null;
    aim(new THREE.Vector3(0, 230, 0), overviewDist(), 1.05, rig.az);
    idle = true;
  }
  function focusPhase(id) {
    const trail = trails[id];
    const box = new THREE.Box3().setFromPoints(trail.pts);
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const portrait = window.innerHeight > window.innerWidth;
    active = id; selectedTopic = null;
    aim(center, Math.max(620, radius * (portrait ? 3.8 : 2.5)), 0.88, Math.hypot(center.x, center.z) > 300 ? outerAngle(center) : rig.az);
  }
  function focusTopic(id) {
    const b = beacons[id];
    if (!b) return;
    active = b.phase.id; selectedTopic = id;
    aim(b.pos.clone().setY(b.pos.y + 24), 480, 1.04, outerAngle(b.pos) + 0.2);
    emit(b.crystal.getWorldPosition(new THREE.Vector3()), palette[b.phase.id], 18, 50);
  }
  function focusMonth(m) {
    const p = roadPoint(roadT(m));
    aim(p, 620, 0.98, outerAngle(p) + 0.32);
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
    idle = false;
  }
  function stopJourney() { journey = null; monthTarget = month; }

  /* Pointer input */
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  let moved = false;
  const stage = canvas.parentElement;
  const raycaster = new THREE.Raycaster();

  function panBy(dx, dy) {
    const scale = rig.dist * 0.0011;
    const right = new THREE.Vector3(-Math.sin(rig.az), 0, Math.cos(rig.az));
    const fwd = new THREE.Vector3(Math.cos(rig.az), 0, Math.sin(rig.az));
    goal.tx -= right.x * dx * scale - fwd.x * -dy * scale;
    goal.tz -= right.z * dx * scale - fwd.z * -dy * scale;
    const r = Math.hypot(goal.tx, goal.tz);
    if (r > 1500) { goal.tx *= 1500 / r; goal.tz *= 1500 / r; }
  }
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button,input,label')) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    stage.setPointerCapture(e.pointerId);
    moved = false;
    idle = false;
    callbacks.onUserInput();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 };
      drag = null;
      return;
    }
    drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) { hover(e); return; }
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      goal.dist = clamp(goal.dist * (pinch.d / d), 120, 6000);
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
      goal.pol = clamp(goal.pol - dy * 0.004, 0.22, 1.5);
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
    idle = false;
    callbacks.onUserInput();
    goal.dist = clamp(goal.dist * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0012)), 120, 6000);
    if (reduced) Object.assign(rig, goal);
  }, { passive: false });

  const ndc = new THREE.Vector2();
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
      if (y < coneH(Math.hypot(x, z)) - 8) return true;
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
    labelRoot.classList.toggle('far', rig.dist > 1700);
    const w = window.innerWidth; const h = window.innerHeight;
    taken.length = 0;
    const ranked = anchors.map((a) => {
      if (!a.w && a.node.offsetWidth) { a.w = a.node.offsetWidth; a.h = a.node.offsetHeight; }
      const d = camera.position.distanceTo(a.pos);
      let score = d;
      if (a.kind === 'phase') score = -1e6 + d;
      if (a.kind === 'you') score = -3e6;
      if (a.topic && a.topic.id === selectedTopic) score = -2e6;
      else if (a.kind === 'exam' && (a.node.classList.contains('due') || a.phase?.id === active)) score = -5e5 + d;
      else if (a.phase?.id === active) score = -4e5 + d;
      return { a, d, score };
    }).sort((p, q) => p.score - q.score);
    ranked.forEach(({ a, d }) => {
      const related = a.phase?.id === active;
      let want = !a.node.hidden;
      if (a.kind === 'topic') want = want && (related || d < 1050);
      if (a.kind === 'exam') want = want && (related || d < 1700 || a.node.classList.contains('due'));
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
        goal.dist = 560; goal.pol = 1.0;
        goal.az = nearestAngle(rig.az, outerAngle(p) + 0.42);
      }
    } else {
      monthF += (monthTarget + 0.5 - monthF) * (reduced ? 1 : 1 - Math.exp(-dt * 4));
    }
    if (idle && !reduced) goal.az += dt * 0.035;

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
      trail.base.material.opacity = 0.6 * fade;
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
      t.halo.scale.setScalar((on ? 240 : 130) * (on ? pulse : 1));
      t.halo.material.opacity = (on ? 0.95 : 0.5) * hoverFade(id);
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
    orbit: (d) => { goal.az += d; idle = false; },
    tilt: (d) => { goal.pol = clamp(goal.pol + d, 0.22, 1.5); idle = false; },
    zoom: (f) => { goal.dist = clamp(goal.dist * f, 120, 6000); idle = false; },
    pause: (value) => { running = !value; },
    debug: () => ({ rig: { ...rig }, goal: { ...goal }, monthF, month, active, selectedTopic, shown: anchors.filter((a) => a.shown).length, anchors: anchors.length, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }),
  };
  return api;
}
