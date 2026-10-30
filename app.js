'use strict';

const STORE_KEY = 'the-path-progress-v1';
const THEME_KEY = 'the-path-theme';
const SVG_NS = 'http://www.w3.org/2000/svg';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TOTAL_MONTHS = 36;

// World positions of each phase, left to right in dependency order.
const HOMES = {
  systems: [0, 0], network: [1120, -600], code: [1120, 600], cloud: [2300, -640],
  k8s: [2300, 620], security: [3480, -640], data: [3480, 620], principal: [4640, 0],
};
const ORBIT = { rx: 345, ry: 268, examRx: 480, examRy: 392 };
const FAR_ZOOM = 0.44;
const MIN_ZOOM = 0.09;
const MAX_ZOOM = 1.8;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let data;
let progress = loadProgress();
let selectedPhase = null;
let hoveredPhase = null;
let activeTab = 'overview';
let openTopic = null;
let month = 1;
let playTimer = null;
let colors = {};
let bursts = [];
let searchQuery = '';

const cam = { x: 2300, y: 0, k: 0.2 };
const camTarget = { x: 2300, y: 0, k: 0.26 };
const bodies = [];       // everything the physics loop moves
const planets = {};      // phase id -> body
const moons = {};        // topic id -> body
let courseBodies = [];
let edges = [];
let stars = [];
let viewW = 0;
let viewH = 0;
let portrait = false;

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  setAttrs(node, attrs);
  node.append(...children.filter((child) => child !== null && child !== undefined));
  return node;
}

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  setAttrs(node, attrs);
  node.append(...children.filter((child) => child !== null && child !== undefined));
  return node;
}

function setAttrs(node, attrs) {
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'text') node.textContent = value;
    else if (key === 'checked') node.checked = Boolean(value);
    else if (value !== false && value !== null && value !== undefined) node.setAttribute(key, value === true ? '' : value);
  }
}

function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved && typeof saved === 'object') return { items: saved.items || {} };
  } catch (e) { /* storage blocked or corrupt: start empty */ }
  return { items: {} };
}

function saveProgress() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch (e) { /* in-memory only */ }
}

const isDone = (key) => Boolean(progress.items[key]);

function setDone(key, value) {
  if (value) progress.items[key] = true;
  else delete progress.items[key];
  saveProgress();
  if (value && key.startsWith('t:')) celebrate(key.slice(2));
  refresh();
}

function monthLabel(value) {
  const index = data.startMonth - 1 + value - 1;
  return `${MONTHS[index % 12]} ${data.startYear + Math.floor(index / 12)}`;
}

function currentMonth(now = new Date()) {
  return (now.getFullYear() - data.startYear) * 12 + now.getMonth() + 1 - data.startMonth + 1;
}

const clampMonth = (value) => Math.min(TOTAL_MONTHS, Math.max(1, value));
const phaseById = (id) => data.phases.find((phase) => phase.id === id);
const color = (phase) => `var(--s${phase.n})`;
const topicsDone = (phase) => phase.topics.filter((topic) => isDone(`t:${topic.id}`)).length;
const phasePct = (phase) => Math.round((topicsDone(phase) / phase.topics.length) * 100);
const allTopics = () => data.phases.flatMap((phase) => phase.topics.map((topic) => ({ phase, topic })));
const allCerts = () => data.phases
  .flatMap((phase) => phase.certs.map((cert) => ({ ...cert, phase })))
  .sort((a, b) => a.month - b.month);
const certKey = (cert) => `c:${cert.exam}`;
const unlocks = (phase) => data.phases.filter((other) => other.needs.includes(phase.id));
const inFocus = (phase, at = month) => at >= phase.start && at <= phase.end;

function practising(phase, at = month) {
  const range = faintRange(phase);
  return Boolean(range) && at >= range[0] && at < range[1];
}

function faintRange(phase) {
  if (phase.ongoing) return [phase.end + 1, TOTAL_MONTHS + 1];
  if (phase.habit) return [1, phase.start];
  return null;
}

function ancestors(id, found = new Set()) {
  phaseById(id).needs.forEach((need) => { found.add(need); ancestors(need, found); });
  return found;
}

function formatLength(video) {
  if (video.seconds) {
    const hours = Math.floor(video.seconds / 3600);
    const minutes = Math.round((video.seconds % 3600) / 60);
    return hours ? `${hours}h ${minutes}m` : `${minutes} min`;
  }
  if (video.count) return `${video.count} videos`;
  return 'Full course';
}

function phaseVideoStats(phase) {
  const unique = new Map();
  phase.topics.forEach((topic) => topic.videos.forEach((video) => unique.set(video.id, video)));
  const videos = [...unique.values()];
  return {
    courses: videos.length,
    hours: Math.round(videos.reduce((sum, video) => sum + (video.seconds || 0), 0) / 3600),
    playlists: videos.filter((video) => video.kind === 'playlist').length,
  };
}

/* World construction */

function addBody(node, x, y, extra = {}) {
  const body = { node, x, y, vx: 0, vy: 0, seed: Math.random() * 6.28, ...extra };
  bodies.push(body);
  return body;
}

function buildWorld() {
  const world = $('world');
  data.phases.forEach((phase) => {
    const [homeX, homeY] = HOMES[phase.id];
    // Portrait screens flow top to bottom instead of left to right.
    const [hx, hy] = portrait ? [homeY, homeX] : [homeX, homeY];
    const planet = addBody(renderPlanet(phase), hx, hy, { kind: 'planet', phase, hx, hy, startX: hx, startY: hy });
    planets[phase.id] = planet;
    world.append(planet.node);

    phase.topics.forEach((topic, i) => {
      const angle = -Math.PI / 2 + (i / phase.topics.length) * Math.PI * 2;
      const ox = Math.cos(angle) * ORBIT.rx;
      const oy = Math.sin(angle) * ORBIT.ry;
      const moon = addBody(renderMoon(phase, topic), hx + ox * 0.4, hy + oy * 0.4, { kind: 'moon', phase, topic, parent: planet, ox, oy });
      moons[topic.id] = moon;
      world.append(moon.node);
    });

    const certs = phase.certs.slice().sort((a, b) => a.month - b.month);
    certs.forEach((cert, i) => {
      const span = Math.min(2.2, 0.42 * certs.length);
      const angle = -Math.PI / 2 - span / 2 + (certs.length > 1 ? (i / (certs.length - 1)) * span : span / 2);
      const ox = Math.cos(angle) * ORBIT.examRx;
      const oy = Math.sin(angle) * ORBIT.examRy;
      const sat = addBody(renderSatellite(phase, cert), hx + ox, hy + oy, { kind: 'satellite', phase, cert, parent: planet, ox, oy });
      world.append(sat.node);
    });
  });

  edges = [];
  data.phases.forEach((phase) => {
    phase.needs
      .filter((need) => !phase.needs.some((other) => other !== need && ancestors(other).has(need)))
      .forEach((need) => edges.push({ from: planets[need], to: planets[phase.id], fromId: need, toId: phase.id }));
  });

  stars = Array.from({ length: 170 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.3 + 0.3, d: Math.random() * 0.06 + 0.015, t: Math.random() * 6.28 }));
}

function renderPlanet(phase) {
  const circumference = 2 * Math.PI * 90;
  return el('button', {
    class: 'wnode planet', type: 'button', style: `--c:${color(phase)}`, 'data-phase': phase.id, 'data-drag': phase.id,
    'aria-label': `Phase ${phase.n}: ${phase.title}. Open details.`,
    onclick: () => focusPhase(phase.id),
    onmouseenter: () => { hoveredPhase = phase.id; applyHighlight(); },
    onmouseleave: () => { hoveredPhase = null; applyHighlight(); },
    onfocus: () => { hoveredPhase = phase.id; applyHighlight(); },
    onblur: () => { hoveredPhase = null; applyHighlight(); },
  },
  svg('svg', { viewBox: '0 0 190 190', 'aria-hidden': 'true' },
    svg('circle', { class: 'ring-bg', cx: 95, cy: 95, r: 90 }),
    svg('circle', { class: 'ring', cx: 95, cy: 95, r: 90, 'stroke-dasharray': circumference, 'stroke-dashoffset': circumference, 'data-ring': phase.id })),
  el('span', { class: 'planet-in' },
    el('span', { class: 'planet-num', text: `PHASE ${phase.n}` }),
    el('span', { class: 'planet-name', text: phase.short }),
    el('span', { class: 'planet-sub', 'data-sub': phase.id }),
    el('span', { class: 'planet-state', 'data-state': phase.id })));
}

function renderMoon(phase, topic) {
  return el('div', {
    class: 'wnode moon', style: `--c:${color(phase)}`, 'data-moon': topic.id, 'data-phase': phase.id,
    onclick: (event) => { if (!event.target.classList.contains('tick')) focusTopic(phase.id, topic.id); },
  },
    el('div', { class: 'moon-box' },
      el('input', {
        class: 'tick', type: 'checkbox', 'aria-label': `Done: ${topic.title}`, 'data-key': `t:${topic.id}`,
        onchange: (event) => setDone(`t:${topic.id}`, event.target.checked),
      }),
      el('button', {
        class: 'moon-label', type: 'button', text: topic.short,
        onfocus: () => flyToBody(moons[topic.id], Math.max(cam.k, 0.7)),
      })));
}

function renderSatellite(phase, cert) {
  return el('button', {
    class: `wnode satellite${cert.core ? '' : ' opt'}`, type: 'button', style: `--c:${color(phase)}`, 'data-phase': phase.id,
    'data-cert': certKey(cert), 'data-month': cert.month, 'data-exam': cert.core ? 'core' : 'optional', text: cert.exam,
    title: `${cert.name}, target ${monthLabel(cert.month)}`, onclick: () => openPanel(phase.id, null, 'exams'),
  });
}

/* Course fan: a topic's courses burst out around it */

function closeFan() {
  courseBodies.forEach((body) => { body.node.remove(); bodies.splice(bodies.indexOf(body), 1); });
  courseBodies = [];
  document.querySelectorAll('.moon.open').forEach((node) => node.classList.remove('open'));
}

function openFan(topicId) {
  closeFan();
  const moon = moons[topicId];
  if (!moon) return [];
  moon.node.classList.add('open');
  const length = Math.hypot(moon.ox, moon.oy) || 1;
  const ux = moon.ox / length;
  const uy = moon.oy / length;
  const sideways = Math.abs(ux) > Math.abs(uy);
  const out = sideways ? 300 : 210;
  const spacing = sideways ? 196 : 244;
  moon.topic.videos.forEach((video, i) => {
    const shift = (i - (moon.topic.videos.length - 1) / 2) * spacing;
    const ox = ux * out + (sideways ? 0 : shift);
    const oy = uy * out + (sideways ? shift : 0);
    const node = renderCourse(video, i === 0, moon);
    const body = addBody(node, moon.x, moon.y, { kind: 'course', parent: moon, ox, oy, phase: moon.phase });
    courseBodies.push(body);
    $('world').append(node);
  });
  return courseBodies;
}

function renderCourse(video, first, moon) {
  return el('button', {
    class: 'wnode course', type: 'button', style: `--c:${color(moon.phase)}`, 'data-phase': moon.phase.id,
    'aria-label': `Play ${video.title}`, onclick: () => playVideo(video),
  },
  el('img', { src: video.thumb, alt: '', loading: 'lazy', draggable: 'false' }),
  el('span', { class: 'course-play', 'aria-hidden': 'true', text: '▶' }),
  el('span', { class: 'course-body' },
    first ? el('span', { class: 'course-start', text: 'START HERE' }) : null,
    el('span', { class: 'course-title', text: video.title }),
    el('span', { class: 'course-meta', text: `${formatLength(video)} · ${video.by}` })));
}

function videoUrl(video) {
  return video.kind === 'playlist'
    ? `https://www.youtube.com/playlist?list=${video.id}`
    : `https://www.youtube.com/watch?v=${video.id}`;
}

function embedUrl(video) {
  return video.kind === 'playlist'
    ? `https://www.youtube-nocookie.com/embed/videoseries?list=${video.id}&autoplay=1`
    : `https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1`;
}

function playVideo(video) {
  const player = $('player');
  player.hidden = false;
  player.replaceChildren(
    el('div', { class: 'player-bar' },
      el('span', { text: video.title }),
      el('a', { class: 'linkish', href: videoUrl(video), target: '_blank', rel: 'noopener', text: 'YouTube ↗' }),
      el('button', { class: 'linkish', type: 'button', text: 'Close', onclick: () => { player.hidden = true; player.replaceChildren(); } })),
    el('iframe', { src: embedUrl(video), title: video.title, allow: 'autoplay; encrypted-media; picture-in-picture', allowfullscreen: true }),
  );
}

/* Camera */

function panelOffset() {
  if ($('panel').hidden) return { x: 0, y: 0 };
  if (viewW <= 760) return { x: 0, y: $('panel').offsetHeight / 2 - 30 };
  return { x: $('panel').offsetWidth / 2, y: 0 };
}

function flyTo(x, y, k) {
  const offset = panelOffset();
  camTarget.k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
  camTarget.x = x + offset.x / camTarget.k;
  camTarget.y = y + offset.y / camTarget.k;
  if (reducedMotion) Object.assign(cam, camTarget);
}

const flyToBody = (body, k) => flyTo(body.x, body.y, k);

function fitPoints(points, pad = 90) {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad;
  const offset = panelOffset();
  const freeW = viewW - offset.x * 2 - 24;
  const freeH = viewH - offset.y * 2 - 190;
  const k = Math.min(freeW / (maxX - minX), freeH / (maxY - minY), 1.05);
  flyTo((minX + maxX) / 2, (minY + maxY) / 2 + 20 / k, k);
}

function clusterPoints(phaseId) {
  const { x, y } = planets[phaseId];
  return [[x - ORBIT.examRx - 60, y - ORBIT.examRy - 20], [x + ORBIT.examRx + 60, y + ORBIT.ry + 40]];
}

function fitAll() {
  const points = Object.values(planets).flatMap((planet) => clusterPoints(planet.phase.id));
  fitPoints(points, 20);
}

const focusPhase = (phaseId) => {
  openPanel(phaseId);
  fitPoints(clusterPoints(phaseId), 20);
};

function focusTopic(phaseId, topicId) {
  openPanel(phaseId, topicId, 'topics');
}

/* Animation loop */

function step(now, last) {
  const dt = Math.min(0.05, (now - last) / 1000);
  const ease = reducedMotion ? 1 : 1 - Math.exp(-dt * 4.5);
  cam.x += (camTarget.x - cam.x) * ease;
  cam.y += (camTarget.y - cam.y) * ease;
  cam.k *= Math.exp(Math.log(camTarget.k / cam.k) * ease);

  const time = now / 1000;
  const inverse = Math.max(1, 0.7 / cam.k);
  bodies.forEach((body) => {
    if (body === dragBody) {
      body.vx = 0; body.vy = 0;
    } else {
      let tx;
      let ty;
      if (body.kind === 'planet') {
        tx = body.hx; ty = body.hy;
      } else {
        const wobble = reducedMotion || body.kind === 'course' ? 0 : 5;
        // Zoomed out, planets grow on screen, so their moons spread to stay visible.
        const spread = body.kind === 'moon' ? Math.max(1, Math.min(1.4, inverse / 2.1)) : 1;
        tx = body.parent.x + body.ox * spread + Math.cos(time * 0.5 + body.seed) * wobble;
        ty = body.parent.y + body.oy * spread + Math.sin(time * 0.6 + body.seed) * wobble;
      }
      const stiffness = body.kind === 'planet' ? 10 : 26;
      if (reducedMotion) {
        body.x = tx; body.y = ty;
      } else {
        body.vx = (body.vx + (tx - body.x) * stiffness * dt) * Math.exp(-dt * 7);
        body.vy = (body.vy + (ty - body.y) * stiffness * dt) * Math.exp(-dt * 7);
        body.x += body.vx * dt * 7;
        body.y += body.vy * dt * 7;
      }
    }
    const scale = body.kind === 'planet' ? inverse : 1;
    const half = body.kind === 'planet' ? '' : 'translate(-50%,-50%)';
    body.node.style.transform = `translate(${body.x.toFixed(1)}px,${body.y.toFixed(1)}px) ${half} scale(${scale.toFixed(3)})`;
  });

  $('world').style.transform = `translate(${viewW / 2 - cam.x * cam.k}px,${viewH / 2 - cam.y * cam.k}px) scale(${cam.k})`;
  $('stage').classList.toggle('far', cam.k < FAR_ZOOM);
  drawFx(time, dt);
  drawMinimap();
}

function loop() {
  let last = performance.now();
  const frame = (now) => {
    step(now, last);
    last = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function resize() {
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const fx = $('fx');
  fx.width = viewW * ratio;
  fx.height = viewH * ratio;
  fx.getContext('2d').setTransform(ratio, 0, 0, ratio, 0, 0);
}

function readColors() {
  const style = getComputedStyle(document.documentElement);
  colors = { text: style.getPropertyValue('--text').trim(), line: style.getPropertyValue('--line').trim(), muted: style.getPropertyValue('--text-3').trim(), dark: currentTheme() === 'dark' };
  data.phases.forEach((phase) => { colors[phase.id] = style.getPropertyValue(`--s${phase.n}`).trim(); });
}

const toScreen = (x, y) => [(x - cam.x) * cam.k + viewW / 2, (y - cam.y) * cam.k + viewH / 2];

function bezierPoint(p0, c0, c1, p1, t) {
  const u = 1 - t;
  const f = (a, b, c, d) => u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
  return [f(p0[0], c0[0], c1[0], p1[0]), f(p0[1], c0[1], c1[1], p1[1])];
}

function activePhase() {
  return hoveredPhase || selectedPhase;
}

function isRelated(id) {
  const active = activePhase();
  if (!active) return true;
  return id === active || ancestors(active).has(id) || phaseById(id).needs.includes(active);
}

function drawFx(time, dt) {
  const ctx = $('fx').getContext('2d');
  ctx.clearRect(0, 0, viewW, viewH);

  ctx.fillStyle = colors.dark ? '#ffffff' : '#000000';
  stars.forEach((star) => {
    const sx = ((star.x * viewW - cam.x * star.d * cam.k * 4) % viewW + viewW) % viewW;
    const sy = ((star.y * viewH - cam.y * star.d * cam.k * 4) % viewH + viewH) % viewH;
    ctx.globalAlpha = (colors.dark ? 0.32 : 0.12) * (reducedMotion ? 0.7 : 0.6 + 0.4 * Math.sin(time * 0.7 + star.t));
    ctx.beginPath();
    ctx.arc(sx, sy, star.r, 0, 6.28);
    ctx.fill();
  });

  // Glow behind phases that are in focus this month
  Object.values(planets).forEach((planet) => {
    if (!inFocus(planet.phase)) return;
    const [sx, sy] = toScreen(planet.x, planet.y);
    const pulse = reducedMotion ? 1 : 1 + 0.08 * Math.sin(time * 2);
    const radius = Math.max(150, 520 * cam.k) * pulse;
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius);
    glow.addColorStop(0, colors[planet.phase.id]);
    glow.addColorStop(1, `${colors[planet.phase.id]}00`);
    ctx.globalAlpha = colors.dark ? 0.28 : 0.16;
    ctx.fillStyle = glow;
    ctx.fillRect(sx - radius, sy - radius, radius * 2, radius * 2);
  });

  // Spokes to topics and courses
  ctx.lineCap = 'round';
  bodies.forEach((body) => {
    if (body.kind !== 'moon' && body.kind !== 'course') return;
    const [ax, ay] = toScreen(body.parent.x, body.parent.y);
    const [bx, by] = toScreen(body.x, body.y);
    const done = body.kind === 'moon' && isDone(`t:${body.topic.id}`);
    ctx.globalAlpha = (isRelated(body.phase.id) ? 1 : 0.15) * (body.kind === 'course' ? 0.9 : done ? 0.85 : 0.28);
    ctx.strokeStyle = colors[body.phase.id];
    ctx.lineWidth = body.kind === 'course' ? 2 : done ? 2.5 : 1;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  });

  // Dependency edges with flowing energy
  const active = activePhase();
  const chain = active ? ancestors(active) : new Set();
  edges.forEach((edge) => {
    const p0 = toScreen(edge.from.x, edge.from.y);
    const p1 = toScreen(edge.to.x, edge.to.y);
    const bendX = portrait ? 0 : (p1[0] - p0[0]) * 0.5;
    const bendY = portrait ? (p1[1] - p0[1]) * 0.5 : 0;
    const c0 = [p0[0] + bendX, p0[1] + bendY];
    const c1 = [p1[0] - bendX, p1[1] - bendY];
    const on = Boolean(active) && (edge.toId === active || edge.fromId === active || chain.has(edge.toId));
    const quiet = Boolean(active) && !on;
    const gradient = ctx.createLinearGradient(p0[0], p0[1], p1[0], p1[1]);
    gradient.addColorStop(0, colors[edge.fromId]);
    gradient.addColorStop(1, colors[edge.toId]);
    ctx.globalAlpha = quiet ? 0.07 : on ? 0.95 : 0.42;
    ctx.strokeStyle = gradient;
    ctx.lineWidth = Math.min(on ? 4 : 2.5, Math.max(1.5, (on ? 8 : 4.5) * cam.k * 1.6));
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.bezierCurveTo(c0[0], c0[1], c1[0], c1[1], p1[0], p1[1]);
    ctx.stroke();

    if (reducedMotion || quiet) return;
    const live = on || inFocus(phaseById(edge.fromId)) || inFocus(phaseById(edge.toId));
    const count = live ? 5 : 2;
    const size = Math.min(5, Math.max(1.8, (live ? 11 : 7) * cam.k));
    for (let i = 0; i < count; i += 1) {
      const t = (time * (live ? 0.16 : 0.07) + i / count) % 1;
      const [x, y] = bezierPoint(p0, c0, c1, p1, t);
      ctx.globalAlpha = Math.sin(t * Math.PI) * (live ? 1 : 0.55);
      ctx.fillStyle = t < 0.5 ? colors[edge.fromId] : colors[edge.toId];
      ctx.beginPath();
      ctx.arc(x, y, size, 0, 6.28);
      ctx.fill();
    }
  });

  // Completion bursts
  bursts = bursts.filter((spark) => spark.life > 0);
  bursts.forEach((spark) => {
    spark.life -= dt;
    spark.x += spark.vx * dt;
    spark.y += spark.vy * dt;
    spark.vy += 240 * dt;
    const [sx, sy] = toScreen(spark.x, spark.y);
    ctx.globalAlpha = Math.max(0, spark.life / 0.9);
    ctx.fillStyle = spark.color;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(1.5, 5 * cam.k), 0, 6.28);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function celebrate(topicId) {
  const moon = moons[topicId];
  if (!moon || reducedMotion) return;
  const count = topicsDone(moon.phase) === moon.phase.topics.length ? 140 : 26;
  const origin = count > 26 ? moon.parent : moon;
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * 6.28;
    const speed = 120 + Math.random() * (count > 26 ? 520 : 260);
    bursts.push({ x: origin.x, y: origin.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 0.5 + Math.random() * 0.5, color: colors[moon.phase.id] });
  }
  if (count > 26) toast(`Phase ${moon.phase.n} complete: ${moon.phase.title}`);
}

const MINI = { minX: -700, maxX: 5340, minY: -1160, maxY: 1100 };

function placeMinimap() {
  if (portrait) Object.assign(MINI, { minX: -1160, maxX: 1100, minY: -700, maxY: 5340 });
}

function drawMinimap() {
  const canvas = $('minimap');
  if (!canvas.offsetWidth) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const sx = w / (MINI.maxX - MINI.minX);
  const sy = h / (MINI.maxY - MINI.minY);
  const mx = (x) => (x - MINI.minX) * sx;
  const my = (y) => (y - MINI.minY) * sy;
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = 2;
  edges.forEach((edge) => {
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = colors[edge.fromId];
    ctx.beginPath();
    ctx.moveTo(mx(edge.from.x), my(edge.from.y));
    ctx.lineTo(mx(edge.to.x), my(edge.to.y));
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
  Object.values(planets).forEach((planet) => {
    ctx.fillStyle = colors[planet.phase.id];
    ctx.beginPath();
    ctx.arc(mx(planet.x), my(planet.y), inFocus(planet.phase) ? 13 : 8, 0, 6.28);
    ctx.fill();
  });
  const halfW = viewW / 2 / cam.k;
  const halfH = viewH / 2 / cam.k;
  ctx.strokeStyle = colors.text;
  ctx.lineWidth = 3;
  ctx.strokeRect(mx(cam.x - halfW), my(cam.y - halfH), halfW * 2 * sx, halfH * 2 * sy);
}

/* Pointer and keyboard input */

let dragBody = null;
let panStart = null;
let moved = false;
const pointers = new Map();
let pinch = null;

function zoomAt(screenX, screenY, factor) {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camTarget.k * factor));
  const worldX = (screenX - viewW / 2) / camTarget.k + camTarget.x;
  const worldY = (screenY - viewH / 2) / camTarget.k + camTarget.y;
  camTarget.x = worldX - (screenX - viewW / 2) / k;
  camTarget.y = worldY - (screenY - viewH / 2) / k;
  camTarget.k = k;
}

function bindPointer() {
  const stage = $('stage');
  stage.addEventListener('wheel', (event) => {
    event.preventDefault();
    dismissHint();
    zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0016)));
  }, { passive: false });

  stage.addEventListener('pointerdown', (event) => {
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    moved = false;
    stopPlay();
    dismissHint();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { distance: Math.hypot(a[0] - b[0], a[1] - b[1]) };
      panStart = null;
      dragBody = null;
      return;
    }
    const handle = event.target.closest('[data-drag]');
    if (handle) {
      dragBody = planets[handle.dataset.drag];
    }
    panStart = { x: event.clientX, y: event.clientY, cx: camTarget.x, cy: camTarget.y, bx: dragBody?.x, by: dragBody?.y };
  });

  window.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, distance / pinch.distance);
      pinch.distance = distance;
      moved = true;
      return;
    }
    if (!panStart) return;
    const dx = event.clientX - panStart.x;
    const dy = event.clientY - panStart.y;
    if (!moved && Math.hypot(dx, dy) < 6) return;
    moved = true;
    stage.classList.add('grabbing');
    if (dragBody) {
      dragBody.x = panStart.bx + dx / cam.k;
      dragBody.y = panStart.by + dy / cam.k;
      dragBody.hx = dragBody.x;
      dragBody.hy = dragBody.y;
    } else {
      camTarget.x = panStart.cx - dx / cam.k;
      camTarget.y = panStart.cy - dy / cam.k;
      if (reducedMotion) { cam.x = camTarget.x; cam.y = camTarget.y; }
    }
  });

  const release = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) { dragBody = null; panStart = null; stage.classList.remove('grabbing'); }
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  // A drag that ends on a button must not count as a click on it.
  stage.addEventListener('click', (event) => {
    if (moved) { event.preventDefault(); event.stopPropagation(); moved = false; }
  }, true);

  stage.addEventListener('dblclick', (event) => {
    if (event.target.closest('.wnode')) return;
    zoomAt(event.clientX, event.clientY, 1.8);
  });

  $('minimap').addEventListener('click', (event) => {
    const box = event.target.getBoundingClientRect();
    const x = MINI.minX + ((event.clientX - box.left) / box.width) * (MINI.maxX - MINI.minX);
    const y = MINI.minY + ((event.clientY - box.top) / box.height) * (MINI.maxY - MINI.minY);
    flyTo(x, y, camTarget.k);
  });
}

function dismissHint() {
  $('hint-keys').classList.add('gone');
}

function bindKeys() {
  document.addEventListener('keydown', (event) => {
    const typing = /INPUT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.type !== 'checkbox' && document.activeElement.type !== 'range';
    if (event.key === 'Escape') {
      if (!$('palette').hidden) closePalette();
      else if (selectedPhase) closePanel();
      return;
    }
    if ((event.key === 'k' && (event.ctrlKey || event.metaKey)) || (event.key === '/' && !typing)) {
      event.preventDefault();
      openPalette();
      return;
    }
    if (typing || !$('plan-view').hidden || !$('palette').hidden) return;
    const stepSize = 120 / camTarget.k;
    const inStage = !$('panel').contains(document.activeElement);
    if (!inStage) return;
    if (event.key === 'ArrowLeft' && document.activeElement.type !== 'range') camTarget.x -= stepSize;
    else if (event.key === 'ArrowRight' && document.activeElement.type !== 'range') camTarget.x += stepSize;
    else if (event.key === 'ArrowUp' && document.activeElement.type !== 'range') camTarget.y -= stepSize;
    else if (event.key === 'ArrowDown' && document.activeElement.type !== 'range') camTarget.y += stepSize;
    else if (event.key === '+' || event.key === '=') zoomAt(viewW / 2, viewH / 2, 1.25);
    else if (event.key === '-') zoomAt(viewW / 2, viewH / 2, 0.8);
    else if (event.key === '0') fitAll();
    else if (event.key === ' ' && event.target === $('stage')) { event.preventDefault(); togglePlay(); }
  });
}

/* Highlight and state */

function applyHighlight() {
  document.querySelectorAll('.wnode').forEach((node) => node.classList.toggle('dim', !isRelated(node.dataset.phase)));
}

function syncWorld() {
  const circumference = 2 * Math.PI * 90;
  data.phases.forEach((phase) => {
    const done = topicsDone(phase) === phase.topics.length;
    const planet = planets[phase.id].node;
    planet.classList.toggle('now', inFocus(phase));
    planet.classList.toggle('future', month < phase.start && !practising(phase) && !done);
    document.querySelector(`[data-ring="${phase.id}"]`).setAttribute('stroke-dashoffset', circumference * (1 - phasePct(phase) / 100));
    document.querySelector(`[data-sub="${phase.id}"]`).textContent = `${topicsDone(phase)}/${phase.topics.length} · M${phase.start}–${phase.end}`;
    const state = document.querySelector(`[data-state="${phase.id}"]`);
    const label = done ? 'Done' : inFocus(phase) ? 'In focus' : practising(phase) ? 'Ongoing' : '';
    state.textContent = label;
    state.hidden = !label;
  });
  document.querySelectorAll('[data-key]').forEach((input) => {
    input.checked = isDone(input.dataset.key);
    input.closest('.moon')?.classList.toggle('done', input.checked);
  });
  const showOptional = $('optional').checked;
  document.querySelectorAll('.satellite').forEach((node) => {
    node.classList.toggle('passed', isDone(node.dataset.cert));
    node.classList.toggle('due', Number(node.dataset.month) === month);
    node.hidden = node.dataset.exam === 'optional' && !showOptional;
  });
  document.querySelectorAll('#ladder tr.is-opt').forEach((row) => row.classList.toggle('hide', !showOptional));
  document.querySelectorAll('.gantt b').forEach((mark) => { mark.hidden = mark.dataset.exam === 'optional' && !showOptional; });
}

function toast(message) {
  const node = $('toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 2600);
}

function setMonth(value) {
  month = clampMonth(value);
  $('month').value = month;
  const focus = data.phases.filter((phase) => inFocus(phase)).map((phase) => phase.short);
  const showOptional = $('optional').checked;
  const exams = allCerts().filter((cert) => cert.core || showOptional);
  const due = exams.filter((cert) => cert.month === month);
  const next = exams.find((cert) => cert.month > month);
  $('dock-text').replaceChildren(
    el('b', { text: `Month ${month} · ${monthLabel(month)}` }),
    ` · In focus: ${focus.join(', ') || 'none'}`,
    due.length ? el('b', { text: ` · Exam: ${due.map((cert) => cert.exam).join(', ')}` }) : '',
    next ? ` · Next exam: ${next.exam}, ${monthLabel(next.month)}` : '',
  );
  syncWorld();
  return due;
}

function journeyCamera() {
  const focused = data.phases.filter((phase) => inFocus(phase));
  if (!focused.length) return;
  fitPoints(focused.flatMap((phase) => clusterPoints(phase.id)), 20);
}

function stopPlay() {
  if (!playTimer) return;
  clearInterval(playTimer);
  playTimer = null;
  $('play').textContent = '▶';
  $('play').setAttribute('aria-label', 'Start the journey');
}

function togglePlay() {
  if (playTimer) { stopPlay(); return; }
  closePanel();
  if (month >= TOTAL_MONTHS) setMonth(1);
  $('play').textContent = '❚❚';
  $('play').setAttribute('aria-label', 'Pause the journey');
  journeyCamera();
  playTimer = setInterval(() => {
    if (month >= TOTAL_MONTHS) { stopPlay(); fitAll(); toast('Month 36: you made it to Principal'); return; }
    const before = data.phases.filter((phase) => inFocus(phase)).map((phase) => phase.id).join();
    const due = setMonth(month + 1);
    const after = data.phases.filter((phase) => inFocus(phase)).map((phase) => phase.id).join();
    if (before !== after) {
      journeyCamera();
      const started = data.phases.find((phase) => phase.start === month);
      if (started && !due.length) toast(`Phase ${started.n} begins: ${started.title}`);
    }
    if (due.length) toast(`${monthLabel(month)}: ${due.map((cert) => cert.name).join(', ')}`);
  }, 1100);
}

function renderGantt() {
  const gantt = $('gantt');
  const pct = (value) => ((value - 1) / (TOTAL_MONTHS - 1)) * 100;
  data.phases.forEach((phase, i) => {
    gantt.append(el('i', { style: `--c:${color(phase)};left:${pct(phase.start)}%;width:${pct(phase.end + 1) - pct(phase.start)}%;top:${i * 2.2}px` }));
  });
  allCerts().forEach((cert) => gantt.append(el('b', { 'data-exam': cert.core ? 'core' : 'optional', style: `left:${pct(cert.month)}%` })));
}

/* HUD and plan */

function nextTopic() {
  const now = clampMonth(currentMonth());
  const ordered = data.phases.slice().sort((a, b) => Number(inFocus(b, now)) - Number(inFocus(a, now)) || a.start - b.start);
  for (const phase of ordered) {
    const topic = phase.topics.find((candidate) => !isDone(`t:${candidate.id}`));
    if (topic) return { phase, topic };
  }
  return null;
}

function renderHud() {
  const total = allTopics().length;
  const done = data.phases.reduce((sum, phase) => sum + topicsDone(phase), 0);
  $('hud-progress').textContent = `${done}/${total} topics`;
  const next = nextTopic();
  const button = $('hud-next');
  button.hidden = !next;
  if (next) {
    button.replaceChildren(`${data.phases.some(topicsDone) ? 'Next up' : 'Start here'}: `, el('b', { text: next.topic.short }));
    button.onclick = () => focusTopic(next.phase.id, next.topic.id);
  }
}

function renderStats() {
  const total = allTopics().length;
  const done = data.phases.reduce((sum, phase) => sum + topicsDone(phase), 0);
  const core = allCerts().filter((cert) => cert.core);
  const passed = core.filter((cert) => isDone(certKey(cert))).length;
  const next = core.find((cert) => !isDone(certKey(cert)));
  const now = currentMonth();
  let timing = `Month ${now} of 36`;
  let timingDetail = monthLabel(Math.max(now, 1));
  if (now < 1) { timing = 'Not started'; timingDetail = `Month 1 is ${monthLabel(1)}`; }
  if (now > 36) { timing = 'Finished'; timingDetail = 'The 36 months are up'; }
  const stat = (big, small) => el('div', { class: 'stat' }, el('b', { text: big }), el('span', { text: small }));
  $('stats').replaceChildren(
    stat(timing, timingDetail),
    stat(`${done} / ${total}`, 'topics done'),
    stat(`${passed} / ${core.length}`, 'core exams passed'),
    stat(next ? next.exam : 'All passed', next ? `next exam, target ${monthLabel(next.month)}` : 'every core exam is done'),
  );
}

function renderLadder() {
  const head = el('thead', {}, el('tr', {}, ...['Passed', 'Target', 'Certification', 'Exam', 'Phase', 'Type', 'Cost'].map((label) => el('th', { scope: 'col', text: label }))));
  const body = el('tbody', {}, ...allCerts().map((cert) => el('tr', { class: cert.core ? '' : 'is-opt' },
    el('td', {}, el('input', {
      class: 'check', type: 'checkbox', 'aria-label': `Passed ${cert.name}`, checked: isDone(certKey(cert)),
      onchange: (event) => setDone(certKey(cert), event.target.checked),
    })),
    el('td', { class: 'num', text: `M${cert.month} · ${monthLabel(cert.month)}` }),
    el('td', { text: cert.name }),
    el('td', { class: 'num', text: cert.exam }),
    el('td', {}, el('button', {
      class: 'phase-link', type: 'button', style: `--c:${color(cert.phase)}`,
      onclick: () => { showMap(); focusPhase(cert.phase.id); activeTab = 'exams'; renderPanel(); },
    }, el('i', { class: 'swatch' }), cert.phase.short)),
    el('td', {}, el('span', { class: `pill${cert.core ? ' solid' : ''}`, text: cert.core ? 'Core' : 'Optional' })),
    el('td', { class: 'num', text: cert.cost }),
  )));
  $('ladder').replaceChildren(head, body);
}

function renderNinety() {
  $('ninety-list').replaceChildren(...data.ninety.map((step, i) => el('li', {},
    el('input', {
      class: 'check', type: 'checkbox', 'aria-label': `Done: ${step.week}`, checked: isDone(`n:${i}`),
      onchange: (event) => setDone(`n:${i}`, event.target.checked),
    }),
    el('div', {}, el('b', { text: step.week }), el('p', { text: step.do }), el('small', { text: `You keep: ${step.out}` })))));
}

function renderStatic() {
  $('rules').replaceChildren(...data.rules.map((rule) => el('li', { text: rule })));
  $('budget-table').replaceChildren(
    el('thead', {}, el('tr', {}, ...['Item', 'Cost', 'Notes'].map((label) => el('th', { scope: 'col', text: label })))),
    el('tbody', {}, ...data.budget.map((row) => el('tr', {},
      el('td', { text: row.item }), el('td', { class: 'num', text: row.cost }), el('td', { class: 'cost-note', text: row.note })))),
  );
  $('risks').replaceChildren(...data.risks.map((risk) => el('div', {}, el('strong', { text: risk.title }), el('p', { text: risk.fix }))));
}

function showPlan() {
  stopPlay();
  closePanel();
  $('map-view').hidden = true;
  $('plan-view').hidden = false;
  document.body.classList.remove('in-map');
  window.scrollTo(0, 0);
}

function showMap() {
  $('plan-view').hidden = true;
  $('map-view').hidden = false;
  document.body.classList.add('in-map');
}

/* Detail panel */

function renderVideo(video, first) {
  return el('div', { class: 'vid' },
    el('img', { src: video.thumb, alt: '', loading: 'lazy', width: 112, height: 63 }),
    el('div', {},
      el('div', { class: 'vid-title' }, first ? el('span', { class: 'start', text: 'START HERE' }) : null, video.title),
      el('div', { class: 'vid-by', text: `${formatLength(video)} · ${video.by}` }),
      video.note ? el('div', { class: 'vid-note', text: video.note }) : null,
      el('div', { class: 'vid-actions' },
        el('button', { class: 'linkish', type: 'button', text: 'Play', onclick: () => playVideo(video) }),
        el('a', { class: 'linkish', href: videoUrl(video), target: '_blank', rel: 'noopener', text: 'Open on YouTube ↗' }))));
}

function renderTopic(topic) {
  const expanded = openTopic === topic.id;
  const key = `t:${topic.id}`;
  const count = topic.videos.length;
  const row = el('div', { class: `topic${isDone(key) ? ' is-done' : ''}`, id: `topic-${topic.id}` },
    el('div', { class: 'topic-row' },
      el('input', {
        class: 'check', type: 'checkbox', 'aria-label': `Done: ${topic.title}`, checked: isDone(key),
        onchange: (event) => setDone(key, event.target.checked),
      }),
      el('button', {
        class: 'topic-btn', type: 'button', 'aria-expanded': String(expanded),
        onclick: () => { selectTopic(expanded ? null : topic.id); document.querySelector(`#topic-${CSS.escape(topic.id)} .topic-btn`)?.focus(); },
      },
      el('span', {},
        el('span', { class: 'topic-title', text: topic.title }),
        el('span', { class: 'topic-meta' },
          topic.added ? el('span', { class: 'note-pill', text: 'New' }) : null,
          topic.weak ? el('span', { class: 'note-pill', text: 'Thin coverage' }) : null,
          `${count} free ${count === 1 ? 'course' : 'courses'}`)),
      el('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }))));
  if (expanded) {
    row.append(el('div', { class: 'topic-detail' },
      el('div', {}, el('p', { class: 'detail-label', text: 'What to learn' }), el('ul', { class: 'learn' }, ...topic.learn.map((line) => el('li', { text: line })))),
      el('div', {}, el('p', { class: 'detail-label', text: 'Free courses' }), el('div', { class: 'vids' }, ...topic.videos.map((video, i) => renderVideo(video, i === 0)))),
      el('div', { class: 'callout' }, el('p', { class: 'detail-label', text: 'Try it' }), topic.lab),
      el('div', { class: 'callout' }, el('p', { class: 'detail-label', text: 'Check yourself' }), topic.check)));
  }
  return row;
}

function checkItem(key, label, title, detail) {
  return el('div', { class: 'item' },
    el('input', { class: 'check', type: 'checkbox', 'aria-label': label, checked: isDone(key), onchange: (event) => setDone(key, event.target.checked) }),
    el('div', {}, el('strong', { text: title }), el('p', { text: detail })));
}

function phaseLinks(phases, empty) {
  if (!phases.length) return el('p', { class: 'sec-note', text: empty });
  return el('div', { class: 'links' }, ...phases.map((phase) => el('button', {
    class: 'hud-btn', type: 'button', style: `--c:${color(phase)}`, onclick: () => focusPhase(phase.id),
  }, el('i', { class: 'swatch' }), phase.title)));
}

function renderOverview(phase) {
  const stats = phaseVideoStats(phase);
  const core = phase.certs.filter((cert) => cert.core).length;
  const fact = (big, small) => el('div', {}, el('b', { text: big }), el('span', { text: small }));
  return [
    el('p', { class: 'why', text: phase.why }),
    el('div', { class: 'facts' },
      fact(`${phase.end - phase.start + 1} months`, `${monthLabel(phase.start)} – ${monthLabel(phase.end)}`),
      fact(String(phase.topics.length), 'topics'),
      fact(String(stats.courses), `free courses (${stats.playlists} playlists)`),
      fact(`${stats.hours} h`, 'of single videos, plus the playlists'),
      fact(String(core), core === 1 ? 'core exam' : 'core exams'),
      fact(phase.specialty, 'deep-dive idea')),
    el('h3', { text: "You're done when you can" }),
    ...phase.done.map((line, i) => el('label', { class: 'item' },
      el('input', { class: 'check', type: 'checkbox', checked: isDone(`g:${phase.id}:${i}`), onchange: (event) => setDone(`g:${phase.id}:${i}`, event.target.checked) }),
      el('span', { text: line }))),
    el('h3', { text: 'Builds on' }),
    phaseLinks(phase.needs.map(phaseById), 'Your existing Senior DevOps, AWS SAA and CKA experience.'),
    el('h3', { text: 'Unlocks' }),
    phaseLinks(unlocks(phase), 'This is the destination.'),
    el('h3', { text: 'Security thread' }),
    el('p', { class: 'sec-note', text: phase.security }),
    el('h3', { text: 'Toolbelt' }),
    el('ul', { class: 'tools' }, ...phase.tools.split(', ').map((tool) => el('li', { text: tool }))),
  ];
}

function renderTabBody(phase) {
  if (activeTab === 'overview') return renderOverview(phase);
  if (activeTab === 'exams') {
    return [
      ...phase.certs.map((cert) => checkItem(certKey(cert), `Passed ${cert.name}`, cert.name,
        `${cert.exam} · ${cert.cost} · ${cert.core ? 'Core' : 'Optional'} · target M${cert.month}, ${monthLabel(cert.month)}. ${cert.why}`)),
      el('div', { class: 'callout', style: 'margin-top:12px', text: phase.certNote }),
    ];
  }
  if (activeTab === 'projects') {
    return phase.projects.map((project) => checkItem(`p:${phase.id}:${project.name}`, `Shipped ${project.name}`,
      project.name, `${project.level} · proves ${project.proves.toLowerCase()}. ${project.detail}`));
  }
  if (activeTab === 'reading') {
    return phase.reading.map((item) => el('div', { class: 'item plain-item' },
      el('strong', { text: item.title }), item.free ? el('span', { class: 'free', text: 'Free' }) : null,
      el('p', { text: item.how })));
  }
  return phase.topics.map(renderTopic);
}

function renderPanel() {
  const phase = phaseById(selectedPhase);
  if (!phase) return;
  const panel = $('panel');
  const scroll = panel.scrollTop;
  const tabs = [['overview', 'Overview'], ['topics', 'Topics & courses'], ['exams', 'Exams'], ['projects', 'Projects'], ['reading', 'Reading']];
  panel.style.setProperty('--c', color(phase));
  panel.replaceChildren(
    el('div', { class: 'panel-head' },
      el('div', { class: 'panel-title-row' },
        el('div', {},
          el('div', { class: 'panel-kicker' }, el('i', { class: 'swatch' }), `Phase ${phase.n} · ${monthLabel(phase.start)} – ${monthLabel(phase.end)}`),
          el('h2', { id: 'panel-title', text: phase.title })),
        el('button', { class: 'close', type: 'button', 'aria-label': 'Close panel', text: '×', onclick: closePanel })),
      el('p', { class: 'panel-tag', text: phase.tagline }),
      el('div', { class: 'meter', role: 'img', 'aria-label': `${phasePct(phase)}% of topics done` }, el('i', { style: `width:${phasePct(phase)}%` })),
      el('div', { class: 'tabs', role: 'tablist' }, ...tabs.map(([id, label]) => el('button', {
        class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(activeTab === id), text: label,
        onclick: () => { activeTab = id; renderPanel(); panel.scrollTop = 0; panel.querySelector('.tab[aria-selected="true"]').focus(); },
      })))),
    el('div', { class: 'panel-body', role: 'tabpanel' }, ...renderTabBody(phase)),
  );
  panel.scrollTop = scroll;
}

function selectTopic(topicId) {
  openTopic = topicId;
  renderPanel();
  if (!topicId) { closeFan(); fitPoints(clusterPoints(selectedPhase), 20); return; }
  const fan = openFan(topicId);
  const moon = moons[topicId];
  const points = [[moon.x, moon.y]];
  fan.forEach((body) => points.push([moon.x + body.ox, moon.y + body.oy]));
  fitPoints(points, 150);
}

function openPanel(phaseId, topicId = null, tab = 'overview') {
  if (!phaseById(phaseId)) return;
  stopPlay();
  dismissHint();
  selectedPhase = phaseId;
  activeTab = tab;
  $('panel').hidden = false;
  document.body.classList.add('panel-open');
  history.replaceState(null, '', `#${phaseId}${topicId ? `/${topicId}` : ''}`);
  if (topicId) {
    selectTopic(topicId);
    const row = document.getElementById(`topic-${topicId}`);
    if (row) $('panel').scrollTop = row.offsetTop - $('panel').querySelector('.panel-head').offsetHeight - 8;
  } else {
    openTopic = null;
    closeFan();
    renderPanel();
    $('panel').scrollTop = 0;
  }
  applyHighlight();
}

function closePanel() {
  if (!selectedPhase) return;
  selectedPhase = null;
  openTopic = null;
  closeFan();
  $('panel').hidden = true;
  document.body.classList.remove('panel-open');
  applyHighlight();
  history.replaceState(null, '', location.pathname + location.search);
}

function refresh() {
  renderStats();
  renderHud();
  renderLadder();
  renderNinety();
  syncWorld();
  if (selectedPhase) renderPanel();
}

/* Command palette */

function searchIndex() {
  const items = [];
  data.phases.forEach((phase) => {
    items.push({ label: phase.title, hint: `Phase ${phase.n}`, phase, go: () => focusPhase(phase.id), text: `${phase.title} ${phase.short} ${phase.tools}` });
    phase.certs.forEach((cert) => {
      items.push({ label: cert.name, hint: `Exam ${cert.exam}`, phase, go: () => { focusPhase(phase.id); activeTab = 'exams'; renderPanel(); }, text: `${cert.name} ${cert.exam}` });
    });
    phase.topics.forEach((topic) => {
      items.push({ label: topic.title, hint: 'Topic', phase, go: () => focusTopic(phase.id, topic.id), text: `${topic.title} ${topic.short} ${topic.lab} ${topic.learn.join(' ')}` });
      topic.videos.forEach((video) => {
        items.push({ label: video.title, hint: formatLength(video), phase, go: () => focusTopic(phase.id, topic.id), text: `${video.title} ${video.by}` });
      });
    });
  });
  return items;
}

let paletteIndex = [];
let paletteResults = [];
let paletteCursor = 0;

function openPalette() {
  stopPlay();
  showMap();
  if (!paletteIndex.length) paletteIndex = searchIndex();
  $('palette').hidden = false;
  $('palette-input').value = '';
  renderPalette('');
  $('palette-input').focus();
}

function closePalette() {
  $('palette').hidden = true;
  $('stage').focus();
}

function renderPalette(raw) {
  searchQuery = raw.trim().toLowerCase();
  const seen = new Set();
  paletteResults = paletteIndex
    .filter((item) => !searchQuery || item.text.toLowerCase().includes(searchQuery))
    .filter((item) => { const key = item.label + item.hint; if (seen.has(key)) return false; seen.add(key); return true; })
    .slice(0, 30);
  paletteCursor = 0;
  drawPaletteList();
  document.querySelectorAll('.moon').forEach((node) => {
    const topic = allTopics().find(({ topic: candidate }) => candidate.id === node.dataset.moon).topic;
    const hay = `${topic.title} ${topic.short} ${topic.learn.join(' ')} ${topic.videos.map((video) => video.title).join(' ')}`.toLowerCase();
    node.classList.toggle('match', Boolean(searchQuery) && hay.includes(searchQuery));
  });
}

function drawPaletteList() {
  const list = $('palette-list');
  if (!paletteResults.length) { list.replaceChildren(el('li', { text: 'Nothing matches that.' })); return; }
  list.replaceChildren(...paletteResults.map((item, i) => el('li', {
    role: 'option', 'aria-selected': String(i === paletteCursor), style: `--c:${color(item.phase)}`,
    onclick: () => choosePalette(i), onmousemove: () => { if (paletteCursor !== i) { paletteCursor = i; drawPaletteList(); } },
  }, el('i', { class: 'swatch' }), el('span', { text: item.label }), el('small', { text: item.hint }))));
  list.children[paletteCursor]?.scrollIntoView({ block: 'nearest' });
}

function choosePalette(i) {
  const item = paletteResults[i];
  if (!item) return;
  $('palette').hidden = true;
  item.go();
}

/* Wiring */

function exportProgress() {
  const blob = new Blob([JSON.stringify(progress, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  el('a', { href: url, download: 'the-path-progress.json' }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importProgress(file) {
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || typeof parsed.items !== 'object' || Array.isArray(parsed.items)) throw new Error('bad shape');
    progress = { items: parsed.items };
    saveProgress();
    refresh();
  } catch (e) {
    window.alert("That file doesn't look like a progress export from this site.");
  }
}

function currentTheme() {
  return document.documentElement.dataset.theme || 'dark';
}

function labelTheme() {
  $('theme').textContent = currentTheme() === 'dark' ? 'Light' : 'Dark';
}

function openFromHash() {
  const [phaseId, topicId] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (phaseId && phaseById(phaseId)) {
    showMap();
    if (topicId) focusTopic(phaseId, topicId);
    else focusPhase(phaseId);
  }
}

function bindEvents() {
  $('optional').addEventListener('change', () => setMonth(month));
  $('play').addEventListener('click', togglePlay);
  $('month').addEventListener('input', (event) => { stopPlay(); setMonth(Number(event.target.value)); });
  $('today').addEventListener('click', () => { stopPlay(); setMonth(currentMonth()); fitAll(); });
  $('fit').addEventListener('click', () => {
    closePanel();
    Object.values(planets).forEach((planet) => { planet.hx = planet.startX; planet.hy = planet.startY; });
    fitAll();
  });
  $('to-plan').addEventListener('click', showPlan);
  $('to-map').addEventListener('click', () => { showMap(); });
  $('open-search').addEventListener('click', openPalette);
  $('palette-input').addEventListener('input', (event) => renderPalette(event.target.value));
  $('palette-input').addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); paletteCursor = Math.min(paletteResults.length - 1, paletteCursor + 1); drawPaletteList(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); paletteCursor = Math.max(0, paletteCursor - 1); drawPaletteList(); }
    if (event.key === 'Enter') { event.preventDefault(); choosePalette(paletteCursor); }
  });
  $('palette').addEventListener('click', (event) => { if (event.target === $('palette')) closePalette(); });
  $('export').addEventListener('click', exportProgress);
  $('import').addEventListener('change', (event) => {
    if (event.target.files[0]) importProgress(event.target.files[0]);
    event.target.value = '';
  });
  $('reset').addEventListener('click', () => {
    if (window.confirm('Clear all your progress in this browser?')) { progress = { items: {} }; saveProgress(); refresh(); }
  });
  $('theme').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* not remembered */ }
    labelTheme();
    readColors();
  });
  window.addEventListener('resize', resize);
  window.addEventListener('hashchange', openFromHash);
  bindPointer();
  bindKeys();
}

async function init() {
  document.body.classList.add('in-map');
  try {
    const response = await fetch('data/roadmap.json');
    if (!response.ok) throw new Error(response.status);
    data = await response.json();
  } catch (e) {
    $('dock-text').textContent = "The roadmap data couldn't load. Please reload the page.";
    return;
  }
  resize();
  portrait = viewH > viewW;
  placeMinimap();
  readColors();
  labelTheme();
  buildWorld();
  renderGantt();
  renderStatic();
  bindEvents();
  refresh();
  setMonth(currentMonth());
  fitAll();
  loop();
  setTimeout(dismissHint, 7000);
  openFromHash();
}

init();
