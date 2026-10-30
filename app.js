'use strict';

const STORE_KEY = 'the-path-progress-v1';
const THEME_KEY = 'the-path-theme';
const SVG_NS = 'http://www.w3.org/2000/svg';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const LAYOUT = { width: 1256, gutter: 178, right: 18, top: 50, row: 72, months: 36 };
LAYOUT.month = (LAYOUT.width - LAYOUT.gutter - LAYOUT.right) / LAYOUT.months;

let data;
let progress = loadProgress();
let selectedPhase = null;
let activeTab = 'topics';
let openTopic = null;
let lastFocus = null;

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

function monthLabel(month) {
  const index = data.startMonth - 1 + month - 1;
  return `${MONTHS[index % 12]} ${data.startYear + Math.floor(index / 12)}`;
}

function currentMonth(now = new Date()) {
  return (now.getFullYear() - data.startYear) * 12 + now.getMonth() + 1 - data.startMonth + 1;
}

const phaseById = (id) => data.phases.find((phase) => phase.id === id);
const color = (phase) => `var(--s${phase.n})`;
const topicsDone = (phase) => phase.topics.filter((topic) => isDone(`t:${topic.id}`)).length;
const phasePct = (phase) => Math.round((topicsDone(phase) / phase.topics.length) * 100);
const allCerts = () => data.phases
  .flatMap((phase) => phase.certs.map((cert) => ({ ...cert, phase })))
  .sort((a, b) => a.month - b.month);
const certKey = (cert) => `c:${cert.exam}`;
const monthX = (month) => LAYOUT.gutter + (month - 1) * LAYOUT.month;
const laneY = (index) => LAYOUT.top + index * LAYOUT.row;
const barY = (index) => laneY(index) + 44;

function faintRange(phase) {
  if (phase.ongoing) return [phase.end + 1, LAYOUT.months + 1];
  if (phase.habit) return [1, phase.start];
  return null;
}

function renderMap() {
  const height = LAYOUT.top + data.phases.length * LAYOUT.row + 10;
  const root = svg('svg', {
    class: 'map', viewBox: `0 0 ${LAYOUT.width} ${height}`, role: 'group',
    'aria-label': 'Timeline of eight phases over 36 months. Select a phase to see its topics and courses.',
  });

  for (let year = 0; year < 3; year += 1) {
    const x = monthX(year * 12 + 1);
    root.append(svg('text', { class: 'axis-year', x: x + 4, y: 17, text: `Year ${year + 1}` }));
  }
  for (let month = 1; month <= LAYOUT.months + 1; month += 6) {
    const x = monthX(month);
    root.append(svg('line', { class: 'grid', x1: x, x2: x, y1: month % 12 === 1 ? 4 : 24, y2: height - 6 }));
    if (month <= LAYOUT.months) root.append(svg('text', { class: 'axis-text', x: x + 4, y: 37, text: `M${month} · ${monthLabel(month)}` }));
  }

  const edges = svg('g');
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
      edges.append(
        svg('path', { class: 'edge', 'data-to': phase.id, 'data-from': need, d: `M${x1} ${y1} C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}` }),
        svg('circle', { class: 'edge-dot', 'data-to': phase.id, 'data-from': need, cx: x1, cy: y1, r: 3 }),
      );
    });
  });
  root.append(edges);

  const month = currentMonth();
  const nowMonth = month < 1 ? 1 : month;
  if (month <= LAYOUT.months) {
    const x = monthX(nowMonth);
    root.append(
      svg('line', { class: 'now-line', x1: x, x2: x, y1: 41, y2: height - 6 }),
      svg('text', { class: 'now-label', x: x + 4, y: 50, text: month < 1 ? 'START' : 'NOW' }),
    );
  }

  $('map-scroll').replaceChildren(root);
  syncMap();
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
    onmouseenter: () => highlight(phase.id),
    onmouseleave: () => highlight(selectedPhase),
    onfocus: () => highlight(phase.id),
    onblur: () => highlight(selectedPhase),
  });

  lane.append(
    svg('rect', { class: 'lane-hit', x: 0, y: y + 2, width: LAYOUT.width, height: LAYOUT.row - 4, rx: 8 }),
    svg('text', { class: 'lane-num', x: 16, y: by - 8, text: String(phase.n).padStart(2, '0') }),
    svg('text', { class: 'lane-name', x: 38, y: by - 7, text: phase.short }),
    svg('text', { class: 'lane-pct', x: 38, y: by + 10, 'data-pct': phase.id }),
  );

  const faint = faintRange(phase);
  if (faint) lane.append(svg('rect', { class: 'bar-faint', x: monthX(faint[0]), y: by - 1.5, width: monthX(faint[1]) - monthX(faint[0]), height: 3, rx: 1.5 }));
  lane.append(svg('rect', { class: 'bar', x: x1, y: by - 4, width: x2 - x1, height: 8, rx: 4 }));

  const inset = 11;
  const step = phase.topics.length > 1 ? (x2 - x1 - inset * 2) / (phase.topics.length - 1) : 0;
  phase.topics.forEach((topic, i) => {
    const cx = x1 + inset + i * step;
    lane.append(svg('g', {
      class: 'station-g', 'data-topic': topic.id,
      onclick: (event) => { event.stopPropagation(); openPanel(phase.id, topic.id); },
      onmousemove: (event) => showTip(event, topic.title, `${topic.videos.length} free ${topic.videos.length === 1 ? 'course' : 'courses'}`),
      onmouseleave: hideTip,
    },
    svg('circle', { class: 'station-hit', cx, cy: by, r: Math.max(step / 2, 8) }),
    svg('circle', { class: 'station', cx, cy: by, r: 5.5 })));
  });

  phase.certs.forEach((cert) => {
    const cx = monthX(cert.month) + LAYOUT.month / 2;
    const cy = by - 20;
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

function highlight(phaseId) {
  document.querySelectorAll('.lane').forEach((lane) => {
    const phase = phaseById(lane.dataset.phase);
    const related = !phaseId || lane.dataset.phase === phaseId
      || phase.needs.includes(phaseId) || phaseById(phaseId).needs.includes(lane.dataset.phase);
    lane.classList.toggle('dim', !related);
    lane.classList.toggle('selected', lane.dataset.phase === selectedPhase);
  });
  document.querySelectorAll('.edge, .edge-dot').forEach((edge) => {
    edge.classList.toggle('on', Boolean(phaseId) && (edge.dataset.to === phaseId || edge.dataset.from === phaseId));
  });
}

function syncMap() {
  document.querySelectorAll('[data-pct]').forEach((node) => {
    const phase = phaseById(node.dataset.pct);
    node.textContent = `${topicsDone(phase)}/${phase.topics.length} · M${phase.start}–${phase.end}`;
  });
  document.querySelectorAll('.station-g').forEach((group) => {
    group.querySelector('.station').classList.toggle('done', isDone(`t:${group.dataset.topic}`));
  });
  document.querySelectorAll('[data-cert]').forEach((node) => node.classList.toggle('done', isDone(node.dataset.cert)));
  const showOptional = $('optional').checked;
  document.querySelectorAll('[data-exam="optional"]').forEach((node) => { node.style.display = showOptional ? '' : 'none'; });
  document.querySelectorAll('#ladder tr.is-opt').forEach((row) => row.classList.toggle('hide', !showOptional));
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

function renderStats() {
  const total = data.phases.reduce((sum, phase) => sum + phase.topics.length, 0);
  const done = data.phases.reduce((sum, phase) => sum + topicsDone(phase), 0);
  const core = allCerts().filter((cert) => cert.core);
  const passed = core.filter((cert) => isDone(certKey(cert))).length;
  const next = core.find((cert) => !isDone(certKey(cert)));
  const month = currentMonth();
  let timing = `Month ${month} of 36`;
  let timingDetail = monthLabel(Math.max(month, 1));
  if (month < 1) { timing = 'Not started'; timingDetail = `Month 1 is ${monthLabel(1)}`; }
  if (month > 36) { timing = 'Finished'; timingDetail = 'The 36 months are up'; }
  const stat = (big, small) => el('div', { class: 'stat' }, el('b', { text: big }), el('span', { text: small }));
  $('stats').replaceChildren(
    stat(timing, timingDetail),
    stat(`${done} / ${total}`, 'topics done'),
    stat(`${passed} / ${core.length}`, 'core exams passed'),
    stat(next ? next.exam : 'All passed', next ? `next exam, target ${monthLabel(next.month)}` : 'every core exam is done'),
  );
}

function renderCards() {
  $('cards').replaceChildren(...data.phases.map((phase) => {
    const videos = phase.topics.reduce((sum, topic) => sum + topic.videos.length, 0);
    return el('button', { class: 'card', type: 'button', style: `--c:${color(phase)}`, onclick: () => openPanel(phase.id) },
      el('span', { class: 'card-top' }, el('i', { class: 'swatch' }), `Phase ${phase.n} · M${phase.start}–${phase.end}`),
      el('strong', { text: phase.title }),
      el('small', { text: `${topicsDone(phase)} of ${phase.topics.length} topics · ${videos} free courses` }),
      el('span', { class: 'meter' }, el('i', { style: `width:${phasePct(phase)}%` })));
  }));
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

function renderVideo(video) {
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
      el('div', { class: 'vid-title', text: video.title }),
      el('div', { class: 'vid-by', text: `${video.kind === 'playlist' ? 'Playlist' : 'Video'} · ${video.by}` }),
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
  if (expanded) row.append(el('div', { class: 'vids' }, ...topic.videos.map(renderVideo)));
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

function renderTabBody(phase) {
  if (activeTab === 'exams') {
    return [...phase.certs.map((cert) => checkItem(certKey(cert), `Passed ${cert.name}`, cert.name,
      `${cert.exam} · ${cert.cost} · ${cert.core ? 'Core' : 'Optional'} · target M${cert.month}, ${monthLabel(cert.month)}. ${cert.why}`))];
  }
  if (activeTab === 'projects') {
    return phase.projects.map((project) => checkItem(`p:${phase.id}:${project.name}`, `Shipped ${project.name}`,
      project.name, `${project.level} · proves ${project.proves.toLowerCase()}. ${project.detail}`));
  }
  if (activeTab === 'more') {
    const needs = phase.needs.map((id) => phaseById(id).title).join(', ');
    return [
      el('h3', { text: "You're done when you can" }),
      el('ul', { class: 'plain' }, ...phase.done.map((line) => el('li', { text: line }))),
      el('h3', { text: 'Reading and labs' }),
      el('ul', { class: 'plain' }, ...phase.reading.map((line) => el('li', { text: line }))),
      el('h3', { text: 'Security thread' }),
      el('p', { class: 'sec-note', text: phase.security }),
      el('h3', { text: 'Builds on' }),
      el('p', { class: 'sec-note', text: needs || 'Your existing Senior DevOps, AWS SAA and CKA experience.' }),
    ];
  }
  return phase.topics.map(renderTopic);
}

function renderPanel() {
  const phase = phaseById(selectedPhase);
  if (!phase) return;
  const panel = $('panel');
  const scroll = panel.scrollTop;
  const tabs = [['topics', 'Topics & courses'], ['exams', 'Exams'], ['projects', 'Projects'], ['more', 'Goals & reading']];
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

function openPanel(phaseId, topicId = null, tab = 'topics') {
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
  highlight(phaseId);
  history.replaceState(null, '', `#${phaseId}${topicId ? `/${topicId}` : ''}`);
  if (topicId) document.getElementById(`topic-${topicId}`)?.scrollIntoView({ block: 'center' });
  $('panel').focus({ preventScroll: true });
}

function closePanel() {
  selectedPhase = null;
  $('panel').hidden = true;
  $('scrim').hidden = true;
  highlight(null);
  history.replaceState(null, '', location.pathname + location.search);
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

function refresh() {
  renderStats();
  renderCards();
  renderLadder();
  syncMap();
  if (selectedPhase) renderPanel();
}

function runSearch(raw) {
  const query = raw.trim().toLowerCase();
  const status = $('search-status');
  if (!query) {
    document.querySelectorAll('.station-g').forEach((group) => group.classList.remove('miss', 'hit'));
    status.textContent = '';
    return;
  }
  let hits = 0;
  data.phases.forEach((phase) => phase.topics.forEach((topic) => {
    const haystack = [topic.title, ...topic.videos.flatMap((video) => [video.title, video.by, video.note])].join(' ').toLowerCase();
    const match = haystack.includes(query);
    if (match) hits += 1;
    const group = document.querySelector(`.station-g[data-topic="${topic.id}"]`);
    group.classList.toggle('miss', !match);
    group.classList.toggle('hit', match);
  }));
  status.textContent = hits ? `${hits} matching ${hits === 1 ? 'topic' : 'topics'} highlighted on the map. Select one to see its courses.` : `No topics match "${raw.trim()}".`;
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
  if (phaseId && phaseById(phaseId)) openPanel(phaseId, topicId || null);
}

function bindEvents() {
  $('search').addEventListener('input', (event) => runSearch(event.target.value));
  $('optional').addEventListener('change', syncMap);
  $('scrim').addEventListener('click', closePanel);
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
  renderMap();
  refresh();
  openFromHash();
}

init();
