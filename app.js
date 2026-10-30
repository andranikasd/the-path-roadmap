'use strict';

const STORE_KEY = 'the-path-progress-v1';
const THEME_KEY = 'the-path-theme';
const VIEW_KEY = 'the-path-view';
const SVG_NS = 'http://www.w3.org/2000/svg';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COLUMNS = [['systems'], ['network', 'code'], ['cloud', 'k8s'], ['security', 'data'], ['principal']];

const LAYOUT = { width: 1256, gutter: 178, right: 18, top: 50, row: 72, months: 36 };
LAYOUT.month = (LAYOUT.width - LAYOUT.gutter - LAYOUT.right) / LAYOUT.months;

let data;
let progress = loadProgress();
let selectedPhase = null;
let hoveredPhase = null;
let activeTab = 'overview';
let openTopic = null;
let lastFocus = null;
let month = 1;
let playTimer = null;
let view = 'skill';

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
  refresh();
}

function monthLabel(value) {
  const index = data.startMonth - 1 + value - 1;
  return `${MONTHS[index % 12]} ${data.startYear + Math.floor(index / 12)}`;
}

function currentMonth(now = new Date()) {
  return (now.getFullYear() - data.startYear) * 12 + now.getMonth() + 1 - data.startMonth + 1;
}

const clampMonth = (value) => Math.min(LAYOUT.months, Math.max(1, value));
const phaseById = (id) => data.phases.find((phase) => phase.id === id);
const color = (phase) => `var(--s${phase.n})`;
const topicsDone = (phase) => phase.topics.filter((topic) => isDone(`t:${topic.id}`)).length;
const phasePct = (phase) => Math.round((topicsDone(phase) / phase.topics.length) * 100);
const allCerts = () => data.phases
  .flatMap((phase) => phase.certs.map((cert) => ({ ...cert, phase })))
  .sort((a, b) => a.month - b.month);
const certKey = (cert) => `c:${cert.exam}`;
const monthX = (value) => LAYOUT.gutter + (value - 1) * LAYOUT.month;
const laneY = (index) => LAYOUT.top + index * LAYOUT.row;
const barY = (index) => laneY(index) + 44;
const unlocks = (phase) => data.phases.filter((other) => other.needs.includes(phase.id));
const inFocus = (phase, at = month) => at >= phase.start && at <= phase.end;

function practising(phase, at = month) {
  const range = faintRange(phase);
  return Boolean(range) && at >= range[0] && at < range[1];
}

function ancestors(id, found = new Set()) {
  phaseById(id).needs.forEach((need) => { found.add(need); ancestors(need, found); });
  return found;
}

function faintRange(phase) {
  if (phase.ongoing) return [phase.end + 1, LAYOUT.months + 1];
  if (phase.habit) return [1, phase.start];
  return null;
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

/* Skill map */

function renderSkillMap() {
  const graph = el('div', { class: 'graph', id: 'graph' });
  graph.append(svg('svg', { class: 'graph-edges', id: 'graph-edges', 'aria-hidden': 'true' }));
  COLUMNS.forEach((ids) => graph.append(el('div', { class: 'col' }, ...ids.map((id) => renderNode(phaseById(id))))));
  $('skill-view').replaceChildren(graph);
  new ResizeObserver(drawEdges).observe(graph);
}

function renderNode(phase) {
  const list = el('ul', { class: 'node-topics' }, ...phase.topics.map((topic) => el('li', { class: 'node-topic', 'data-topic': topic.id },
    el('input', {
      class: 'check', type: 'checkbox', 'aria-label': `Done: ${topic.title}`, 'data-key': `t:${topic.id}`,
      onchange: (event) => setDone(`t:${topic.id}`, event.target.checked),
    }),
    el('button', { type: 'button', text: topic.short, onclick: () => openPanel(phase.id, topic.id, 'topics') }))));
  const exams = phase.certs.slice().sort((a, b) => a.month - b.month).map((cert) => el('button', {
    class: `chip${cert.core ? '' : ' opt'}`, type: 'button', 'data-cert-chip': certKey(cert), 'data-exam': cert.core ? 'core' : 'optional', 'data-month': cert.month, text: cert.exam,
    title: `${cert.name}, target ${monthLabel(cert.month)}`,
    onclick: () => openPanel(phase.id, null, 'exams'),
  }));
  const needs = phase.needs.map((id) => phaseById(id).short).join(', ');
  const enter = () => { hoveredPhase = phase.id; highlight(); };
  const leave = () => { hoveredPhase = null; highlight(); };
  return el('article', {
    class: 'node', 'data-node': phase.id, style: `--c:${color(phase)}`,
    onmouseenter: enter, onmouseleave: leave, onfocusin: enter, onfocusout: leave,
  },
  el('button', { class: 'node-head', type: 'button', onclick: () => openPanel(phase.id), 'aria-label': `Phase ${phase.n}: ${phase.title}. Open details.` },
    el('span', { class: 'node-kicker' }, el('span', { text: `Phase ${phase.n} · M${phase.start}–${phase.end}` }), el('span', { class: 'state', 'data-state': phase.id })),
    el('span', { class: 'node-title', text: phase.title }),
    el('span', { class: 'meter' }, el('i', { 'data-meter': phase.id }))),
  list,
  needs ? el('p', { class: 'node-needs', text: `Builds on: ${needs}` }) : null,
  el('div', { class: 'node-exams' }, ...exams));
}

function drawEdges() {
  const layer = $('graph-edges');
  const graph = $('graph');
  if (!layer || view !== 'skill' || !graph.offsetWidth) return;
  const box = graph.getBoundingClientRect();
  const parts = [];
  data.phases.forEach((phase) => {
    const target = graph.querySelector(`[data-node="${phase.id}"]`).getBoundingClientRect();
    const toY = target.top - box.top + 34;
    const toX = target.left - box.left - 7;
    const direct = phase.needs.filter((need) => !phase.needs.some((other) => other !== need && ancestors(other).has(need)));
    direct.forEach((need, i) => {
      const source = graph.querySelector(`[data-node="${need}"]`).getBoundingClientRect();
      const fromX = source.right - box.left;
      const fromY = source.top - box.top + 34;
      const bend = Math.max(26, (toX - fromX) * 0.45);
      const landY = toY + (i - (direct.length - 1) / 2) * 7;
      const style = `--c:${color(phaseById(need))}`;
      parts.push(
        svg('path', { class: 'g-edge', style, 'data-from': need, 'data-to': phase.id, d: `M${fromX} ${fromY} C${fromX + bend} ${fromY} ${toX - bend} ${landY} ${toX} ${landY}` }),
        svg('path', { class: 'g-arrow', style, 'data-from': need, 'data-to': phase.id, d: `M${toX} ${landY - 4}l7 4-7 4z` }),
      );
    });
  });
  layer.replaceChildren(...parts);
  highlight();
}

/* Timeline */

function renderTimeline() {
  const height = LAYOUT.top + data.phases.length * LAYOUT.row + 10;
  const root = svg('svg', {
    class: 'map', viewBox: `0 0 ${LAYOUT.width} ${height}`, role: 'group',
    'aria-label': 'Timeline of eight phases over 36 months. Select a phase to see its topics and courses.',
  });

  for (let year = 0; year < 3; year += 1) {
    root.append(svg('text', { class: 'axis-year', x: monthX(year * 12 + 1) + 4, y: 17, text: `Year ${year + 1}` }));
  }
  for (let m = 1; m <= LAYOUT.months + 1; m += 6) {
    const x = monthX(m);
    root.append(svg('line', { class: 'grid', x1: x, x2: x, y1: m % 12 === 1 ? 4 : 24, y2: height - 6 }));
    if (m <= LAYOUT.months) root.append(svg('text', { class: 'axis-text', x: x + 4, y: 37, text: `M${m} · ${monthLabel(m)}` }));
  }

  data.phases.forEach((phase, index) => root.append(renderLane(phase, index)));
  data.phases.forEach((phase, index) => {
    phase.needs.forEach((need) => {
      const from = data.phases.findIndex((other) => other.id === need);
      const source = data.phases[from];
      const x1 = monthX(Math.min(source.end + 1, Math.max(phase.start, source.start + 1)));
      const x2 = monthX(phase.start);
      const y1 = barY(from);
      const y2 = barY(index);
      const mid = (y1 + y2) / 2;
      root.append(
        svg('path', { class: 'edge', 'data-to': phase.id, 'data-from': need, d: `M${x1} ${y1} C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}` }),
        svg('circle', { class: 'edge-dot', 'data-to': phase.id, 'data-from': need, cx: x1, cy: y1, r: 3 }),
      );
    });
  });

  root.append(
    svg('line', { class: 'now-line', id: 'playhead', x1: 0, x2: 0, y1: 41, y2: height - 6 }),
    svg('text', { class: 'now-label', id: 'playhead-label', y: 50 }),
  );
  $('time-view').replaceChildren(root);
}

function renderLane(phase, index) {
  const y = laneY(index);
  const by = barY(index);
  const x1 = monthX(phase.start);
  const x2 = monthX(phase.end + 1);
  const lane = svg('g', {
    class: 'lane', 'data-phase': phase.id, tabindex: 0, role: 'button', style: `color:${color(phase)}`,
    'aria-label': `Phase ${phase.n}, ${phase.title}, months ${phase.start} to ${phase.end}`,
    onclick: () => openPanel(phase.id),
    onkeydown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPanel(phase.id); }
    },
    onmouseenter: () => { hoveredPhase = phase.id; highlight(); },
    onmouseleave: () => { hoveredPhase = null; highlight(); },
    onfocus: () => { hoveredPhase = phase.id; highlight(); },
    onblur: () => { hoveredPhase = null; highlight(); },
  });

  lane.append(
    svg('rect', { class: 'lane-hit', x: 0, y: y + 2, width: LAYOUT.width, height: LAYOUT.row - 4, rx: 8 }),
    svg('text', { class: 'lane-num', x: 16, y: by - 8, text: String(phase.n).padStart(2, '0') }),
    svg('text', { class: 'lane-name', x: 38, y: by - 7, text: phase.short }),
    svg('text', { class: 'lane-pct', x: 38, y: by + 10, 'data-pct': phase.id }),
  );

  const faint = faintRange(phase);
  if (faint) lane.append(svg('rect', { class: 'bar-faint', x: monthX(faint[0]), y: by - 1.5, width: monthX(faint[1]) - monthX(faint[0]), height: 3, rx: 1.5 }));
  lane.append(svg('rect', { class: 'bar', x: x1, y: by - 5, width: x2 - x1, height: 10, rx: 5 }));

  const inset = 11;
  const step = phase.topics.length > 1 ? (x2 - x1 - inset * 2) / (phase.topics.length - 1) : 0;
  phase.topics.forEach((topic, i) => {
    const cx = x1 + inset + i * step;
    lane.append(svg('g', {
      class: 'station-g', 'data-topic': topic.id,
      onclick: (event) => { event.stopPropagation(); openPanel(phase.id, topic.id, 'topics'); },
      onmousemove: (event) => showTip(event, topic.short, `${topic.videos.length} free ${topic.videos.length === 1 ? 'course' : 'courses'}`),
      onmouseleave: hideTip,
    },
    svg('circle', { class: 'station-hit', cx, cy: by, r: Math.max(step / 2, 8) }),
    svg('circle', { class: 'station', cx, cy: by, r: 5.5 })));
  });

  phase.certs.forEach((cert) => {
    const cx = monthX(cert.month) + LAYOUT.month / 2;
    const cy = cert.core ? by - 20 : by + 17;
    const size = cert.core ? 7 : 6;
    const group = svg('g', {
      'data-exam': cert.core ? 'core' : 'optional',
      onclick: (event) => { event.stopPropagation(); openPanel(phase.id, null, 'exams'); },
      onmousemove: (event) => showTip(event, cert.name, `M${cert.month} · ${monthLabel(cert.month)} · ${cert.core ? 'core' : 'optional'} · ${cert.cost}`),
      onmouseleave: hideTip,
    },
    svg('path', { class: `exam${cert.core ? '' : ' opt'}`, 'data-cert': certKey(cert), d: `M${cx} ${cy - size}l${size} ${size}-${size} ${size}-${size}-${size}z` }));
    if (cert.core) group.append(svg('text', { class: 'exam-label', x: cx + 10, y: cy + 4, text: cert.exam }));
    lane.append(group);
  });
  return lane;
}

/* Shared map state */

function highlight() {
  const active = hoveredPhase || selectedPhase;
  const chain = active ? ancestors(active) : new Set();
  const related = (id) => !active || id === active || chain.has(id) || phaseById(active).needs.includes(id) || phaseById(id).needs.includes(active);

  document.querySelectorAll('[data-node]').forEach((node) => {
    node.classList.toggle('dim', !related(node.dataset.node));
    node.classList.toggle('selected', node.dataset.node === selectedPhase);
  });
  document.querySelectorAll('.lane').forEach((lane) => {
    lane.classList.toggle('dim', !related(lane.dataset.phase));
    lane.classList.toggle('selected', lane.dataset.phase === selectedPhase);
  });
  document.querySelectorAll('.g-edge, .g-arrow').forEach((edge) => {
    const on = Boolean(active) && (edge.dataset.from === active || edge.dataset.to === active || chain.has(edge.dataset.to));
    edge.classList.toggle('on', on);
    edge.classList.toggle('off', Boolean(active) && !on);
  });
  document.querySelectorAll('.edge, .edge-dot').forEach((edge) => {
    edge.classList.toggle('on', Boolean(active) && (edge.dataset.to === active || edge.dataset.from === active));
  });
}

function syncMap() {
  data.phases.forEach((phase) => {
    const state = document.querySelector(`[data-state="${phase.id}"]`);
    const done = topicsDone(phase) === phase.topics.length;
    state.textContent = done ? 'Done' : inFocus(phase) ? 'In focus' : practising(phase) ? 'Practice' : `${topicsDone(phase)}/${phase.topics.length}`;
    state.classList.toggle('now', !done && inFocus(phase));
    document.querySelector(`[data-node="${phase.id}"]`).classList.toggle('focus-now', inFocus(phase));
    document.querySelector(`[data-meter="${phase.id}"]`).style.width = `${phasePct(phase)}%`;
  });
  document.querySelectorAll('[data-pct]').forEach((node) => {
    const phase = phaseById(node.dataset.pct);
    node.textContent = `${topicsDone(phase)}/${phase.topics.length} · M${phase.start}–${phase.end}`;
  });
  document.querySelectorAll('.station-g').forEach((group) => {
    group.querySelector('.station').classList.toggle('done', isDone(`t:${group.dataset.topic}`));
  });
  document.querySelectorAll('[data-key]').forEach((input) => {
    input.checked = isDone(input.dataset.key);
    input.closest('.node-topic')?.classList.toggle('done', input.checked);
  });
  document.querySelectorAll('[data-cert]').forEach((node) => node.classList.toggle('done', isDone(node.dataset.cert)));
  document.querySelectorAll('[data-cert-chip]').forEach((chip) => {
    chip.classList.toggle('passed', isDone(chip.dataset.certChip));
    chip.classList.toggle('due', Number(chip.dataset.month) === month);
  });
  const showOptional = $('optional').checked;
  document.querySelectorAll('[data-exam="optional"]').forEach((node) => { node.style.display = showOptional ? '' : 'none'; });
  document.querySelectorAll('.node-exams').forEach((row) => {
    row.hidden = ![...row.children].some((chip) => chip.dataset.exam === 'core' || showOptional);
  });
  document.querySelectorAll('#ladder tr.is-opt').forEach((row) => row.classList.toggle('hide', !showOptional));
}

function setMonth(value) {
  month = clampMonth(value);
  $('month').value = month;
  const x = monthX(month);
  const head = $('playhead');
  head.setAttribute('x1', x);
  head.setAttribute('x2', x);
  const label = $('playhead-label');
  label.setAttribute('x', x + 4);
  label.textContent = `M${month}`;

  const focus = data.phases.filter((phase) => inFocus(phase)).map((phase) => phase.short);
  const practice = data.phases.filter((phase) => practising(phase)).map((phase) => phase.short);
  const showOptional = $('optional').checked;
  const exams = allCerts().filter((cert) => cert.core || showOptional);
  const due = exams.filter((cert) => cert.month === month).map((cert) => cert.exam);
  const next = exams.find((cert) => cert.month > month);
  const text = $('scrub-text');
  text.replaceChildren(
    el('b', { text: `Month ${month} · ${monthLabel(month)}. ` }),
    `In focus: ${focus.join(', ') || 'none'}. `,
    practice.length ? `Ongoing: ${practice.join(', ')}. ` : '',
    due.length ? el('b', { text: `Exam this month: ${due.join(', ')}. ` }) : '',
    next ? `Next exam: ${next.exam} in ${monthLabel(next.month)}.` : 'No more exams after this.',
  );
  syncMap();
}

function stopPlay() {
  clearInterval(playTimer);
  playTimer = null;
  $('play').textContent = '▶';
  $('play').setAttribute('aria-label', 'Play through the 36 months');
}

function togglePlay() {
  if (playTimer) { stopPlay(); return; }
  if (month >= LAYOUT.months) setMonth(1);
  $('play').textContent = '❚❚';
  $('play').setAttribute('aria-label', 'Pause');
  playTimer = setInterval(() => {
    if (month >= LAYOUT.months) { stopPlay(); return; }
    setMonth(month + 1);
  }, 650);
}

function setView(next) {
  view = next;
  const skill = next === 'skill';
  $('skill-view').hidden = !skill;
  $('time-view').hidden = skill;
  $('legend-skill').hidden = !skill;
  $('legend-time').hidden = skill;
  $('view-skill').setAttribute('aria-pressed', String(skill));
  $('view-time').setAttribute('aria-pressed', String(!skill));
  try { localStorage.setItem(VIEW_KEY, next); } catch (e) { /* not remembered */ }
  drawEdges();
}

function showTip(event, title, detail) {
  const tip = $('tip');
  tip.replaceChildren(document.createTextNode(title), el('small', { text: detail }));
  tip.hidden = false;
  const box = tip.getBoundingClientRect();
  const left = Math.min(event.clientX + 14, window.innerWidth - box.width - 8);
  const top = event.clientY - box.height - 12;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${top < 8 ? event.clientY + 16 : top}px`;
}

function hideTip() { $('tip').hidden = true; }

/* Page sections */

function nextTopic() {
  const now = clampMonth(currentMonth());
  const ordered = data.phases.slice().sort((a, b) => Number(inFocus(b, now)) - Number(inFocus(a, now)) || a.start - b.start);
  for (const phase of ordered) {
    const topic = phase.topics.find((candidate) => !isDone(`t:${candidate.id}`));
    if (topic) return { phase, topic };
  }
  return null;
}

function renderNext() {
  const next = nextTopic();
  if (!next) {
    $('next').replaceChildren(el('div', { class: 'next-inner', style: '--c:var(--text)' }, el('strong', { text: 'Every topic is done. Time to mentor someone.' })));
    return;
  }
  const { phase, topic } = next;
  const started = data.phases.some(topicsDone);
  $('next').replaceChildren(el('div', { class: 'next-inner', style: `--c:${color(phase)}` },
    el('div', {},
      el('small', { text: `${started ? 'Next up' : 'Start here'} · Phase ${phase.n}, ${phase.short}` }),
      el('strong', { text: topic.title })),
    el('button', { class: 'primary', type: 'button', text: started ? 'Continue' : 'Start', onclick: () => openPanel(phase.id, topic.id, 'topics') })));
}

function renderStats() {
  const total = data.phases.reduce((sum, phase) => sum + phase.topics.length, 0);
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
    el('td', {}, el('button', { class: 'phase-link', type: 'button', style: `--c:${color(cert.phase)}`, onclick: () => openPanel(cert.phase.id, null, 'exams') },
      el('i', { class: 'swatch' }), cert.phase.short)),
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

/* Detail panel */

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

function renderVideo(video, first) {
  const card = el('div', { class: 'vid' });
  const play = el('button', {
    class: 'linkish', type: 'button', text: 'Play here',
    onclick: () => {
      const existing = card.querySelector('iframe');
      if (existing) { existing.remove(); play.textContent = 'Play here'; return; }
      play.textContent = 'Close player';
      card.append(el('iframe', {
        class: 'player', src: embedUrl(video), title: video.title, loading: 'lazy',
        allow: 'autoplay; encrypted-media; picture-in-picture', allowfullscreen: true,
      }));
    },
  });
  card.append(
    el('img', { src: video.thumb, alt: '', loading: 'lazy', width: 112, height: 63 }),
    el('div', {},
      el('div', { class: 'vid-title' }, first ? el('span', { class: 'start', text: 'START HERE' }) : null, video.title),
      el('div', { class: 'vid-by', text: `${formatLength(video)} · ${video.by}` }),
      video.note ? el('div', { class: 'vid-note', text: video.note }) : null,
      el('div', { class: 'vid-actions' }, play,
        el('a', { class: 'linkish', href: videoUrl(video), target: '_blank', rel: 'noopener', text: 'Open on YouTube ↗' }))),
  );
  return card;
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
        onclick: () => { openTopic = expanded ? null : topic.id; renderPanel(); focusTopic(topic.id); },
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

function focusTopic(topicId) {
  document.querySelector(`#topic-${CSS.escape(topicId)} .topic-btn`)?.focus();
}

function checkItem(key, label, title, detail) {
  return el('div', { class: 'item' },
    el('input', { class: 'check', type: 'checkbox', 'aria-label': label, checked: isDone(key), onchange: (event) => setDone(key, event.target.checked) }),
    el('div', {}, el('strong', { text: title }), el('p', { text: detail })));
}

function phaseLinks(phases, empty) {
  if (!phases.length) return el('p', { class: 'sec-note', text: empty });
  return el('div', { class: 'links' }, ...phases.map((phase) => el('button', {
    class: 'result', type: 'button', style: `--c:${color(phase)}`, onclick: () => openPanel(phase.id),
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

function openPanel(phaseId, topicId = null, tab = 'overview') {
  const phase = phaseById(phaseId);
  if (!phase) return;
  if (!selectedPhase) lastFocus = document.activeElement;
  selectedPhase = phaseId;
  activeTab = tab;
  openTopic = topicId;
  hideTip();
  $('panel').hidden = false;
  $('scrim').hidden = false;
  renderPanel();
  $('panel').scrollTop = 0;
  highlight();
  history.replaceState(null, '', `#${phaseId}${topicId ? `/${topicId}` : ''}`);
  if (topicId) {
    const row = document.getElementById(`topic-${topicId}`);
    if (row) $('panel').scrollTop = row.offsetTop - $('panel').querySelector('.panel-head').offsetHeight - 8;
  }
  $('panel').focus({ preventScroll: true });
}

function closePanel() {
  selectedPhase = null;
  $('panel').hidden = true;
  $('scrim').hidden = true;
  highlight();
  history.replaceState(null, '', location.pathname + location.search);
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

function refresh() {
  renderStats();
  renderNext();
  renderLadder();
  renderNinety();
  syncMap();
  if (selectedPhase) renderPanel();
}

function runSearch(raw) {
  const query = raw.trim().toLowerCase();
  const results = $('results');
  document.querySelectorAll('.station-g, .node-topic').forEach((node) => node.classList.remove('miss', 'hit'));
  if (!query) { results.replaceChildren(); return; }
  const hits = [];
  data.phases.forEach((phase) => phase.topics.forEach((topic) => {
    const haystack = [topic.title, topic.short, topic.lab, ...topic.learn, ...topic.videos.flatMap((video) => [video.title, video.by, video.note])].join(' ').toLowerCase();
    const match = haystack.includes(query);
    if (match) hits.push({ phase, topic });
    document.querySelectorAll(`[data-topic="${topic.id}"]`).forEach((node) => {
      node.classList.toggle('miss', !match);
      node.classList.toggle('hit', match);
    });
  }));
  if (!hits.length) { results.replaceChildren(`No topics match "${raw.trim()}".`); return; }
  results.replaceChildren(...hits.slice(0, 12).map(({ phase, topic }) => el('button', {
    class: 'result', type: 'button', style: `--c:${color(phase)}`, onclick: () => openPanel(phase.id, topic.id, 'topics'),
  }, el('i', { class: 'swatch' }), topic.short)), hits.length > 12 ? `and ${hits.length - 12} more` : '');
}

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
  const set = document.documentElement.dataset.theme;
  if (set) return set;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function labelTheme() {
  $('theme').textContent = currentTheme() === 'dark' ? 'Light theme' : 'Dark theme';
}

function openFromHash() {
  const [phaseId, topicId] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (phaseId && phaseById(phaseId)) openPanel(phaseId, topicId || null, topicId ? 'topics' : 'overview');
}

function bindEvents() {
  $('search').addEventListener('input', (event) => runSearch(event.target.value));
  $('optional').addEventListener('change', () => setMonth(month));
  $('scrim').addEventListener('click', closePanel);
  $('view-skill').addEventListener('click', () => setView('skill'));
  $('view-time').addEventListener('click', () => setView('time'));
  $('play').addEventListener('click', togglePlay);
  $('month').addEventListener('input', (event) => { stopPlay(); setMonth(Number(event.target.value)); });
  $('today').addEventListener('click', () => { stopPlay(); setMonth(currentMonth()); });
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
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && selectedPhase) closePanel();
    if (event.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { event.preventDefault(); $('search').focus(); }
  });
  window.addEventListener('hashchange', openFromHash);
}

async function init() {
  try {
    const response = await fetch('data/roadmap.json');
    if (!response.ok) throw new Error(response.status);
    data = await response.json();
  } catch (e) {
    $('stats').replaceChildren(el('p', { text: "The roadmap data couldn't load. Please reload the page." }));
    return;
  }
  labelTheme();
  bindEvents();
  renderSkillMap();
  renderTimeline();
  renderStatic();
  refresh();
  setMonth(currentMonth());
  let savedView = 'skill';
  try { savedView = localStorage.getItem(VIEW_KEY) || 'skill'; } catch (e) { /* default view */ }
  setView(savedView === 'time' ? 'time' : 'skill');
  openFromHash();
}

init();
