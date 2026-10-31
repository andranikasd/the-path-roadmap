import { createScene } from './scene.js';

const STORE_KEY = 'the-path-progress-v1';
const THEME_KEY = 'the-path-theme';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TOTAL_MONTHS = 36;

let data;
let progress = loadProgress();
let selectedPhase = null;
let hoveredPhase = null;
let activeTab = 'overview';
let openTopic = null;
let month = 1;
let playing = false;
let searchQuery = '';
let world = null;      // the 3D scene, or null when WebGL is unavailable

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
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

function celebrate(topicId) {
  const found = allTopics().find(({ topic }) => topic.id === topicId);
  if (!found) return;
  const whole = topicsDone(found.phase) === found.phase.topics.length;
  world?.celebrate(topicId, whole);
  if (whole) toast(`Phase ${found.phase.n} complete: ${found.phase.title}`);
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


const KINDS = { course: 'Course', lab: 'Hands-on', docs: 'Docs', read: 'Read', book: 'Book' };

/* Labels the 3D world pins to its objects */

const labelFactory = {
  mile: (m) => el('div', {
    class: `wnode mile${m === 0 || m === 36 ? ' end' : ''}`, 'aria-hidden': 'true',
    text: m === 0 ? `Start · ${monthLabel(1)}` : m === 36 ? `Summit · ${monthLabel(36)}` : `Month ${m}`,
  }),
  you: () => el('div', { class: 'wnode you', id: 'you', 'aria-hidden': 'true' }),
  phase: (phase) => el('button', {
    class: 'wnode plabel', type: 'button', style: `--c:${color(phase)}`, 'data-phase': phase.id,
    'aria-label': `Phase ${phase.n}: ${phase.title}. Open details.`,
    onclick: () => focusPhase(phase.id),
    onmouseenter: () => hoverPhase(phase.id),
    onmouseleave: () => hoverPhase(null),
    onfocus: () => hoverPhase(phase.id),
    onblur: () => hoverPhase(null),
  },
  el('span', { class: 'plabel-top' }, el('b', { class: 'plabel-n', text: String(phase.n) }), el('strong', { text: phase.short }), el('em', { 'data-state': phase.id })),
  el('span', { class: 'plabel-sub', 'data-sub': phase.id }),
  el('span', { class: 'plabel-meter' }, el('i', { 'data-meter': phase.id }))),
  topic: (phase, topic) => el('div', {
    class: 'wnode moon', style: `--c:${color(phase)}`, 'data-moon': topic.id, 'data-phase': phase.id, title: topic.title,
    onclick: (event) => { if (!event.target.classList.contains('tick')) focusTopic(phase.id, topic.id); },
  },
  el('input', {
    class: 'tick', type: 'checkbox', 'aria-label': `Done: ${topic.title}`, 'data-key': `t:${topic.id}`,
    onchange: (event) => setDone(`t:${topic.id}`, event.target.checked),
  }),
  el('button', { class: 'moon-label', type: 'button', text: topic.short })),
  exam: (phase, cert) => el('button', {
    class: `wnode satellite${cert.core ? '' : ' opt'}`, type: 'button', style: `--c:${color(phase)}`, 'data-phase': phase.id,
    'data-cert': certKey(cert), 'data-month': cert.month, 'data-exam': cert.core ? 'core' : 'optional', text: cert.exam,
    title: `${cert.name}, target ${monthLabel(cert.month)}`, onclick: () => openPanel(phase.id, null, 'exams'),
  }),
};

function hoverPhase(id) {
  hoveredPhase = id;
  applyHighlight();
}

/* Course rail: the selected topic's courses, always fully visible */

function renderRail(topicId) {
  const rail = $('rail');
  const found = topicId && allTopics().find(({ topic }) => topic.id === topicId);
  rail.hidden = !found;
  if (!found) { rail.replaceChildren(); return; }
  rail.style.setProperty('--c', color(found.phase));
  rail.replaceChildren(...found.topic.videos.map((video, i) => el('button', {
    class: `course${isDone(`v:${video.id}`) ? ' watched' : ''}`, type: 'button', 'aria-label': `Play ${video.title}`, onclick: () => playVideo(video),
  },
  el('img', { src: video.thumb, alt: '', loading: 'lazy', draggable: 'false' }),
  el('span', { class: 'course-body' },
    i === 0 ? el('span', { class: 'course-start', text: 'START HERE' }) : null,
    el('span', { class: 'course-title', text: video.title }),
    el('span', { class: 'course-meta', text: `${isDone(`v:${video.id}`) ? 'Watched · ' : ''}${formatLength(video)} · ${video.by}` }))),
  ), ...['lab', 'read', 'docs'].flatMap((kind) => found.topic.resources.filter((item) => item.kind === kind).slice(0, 1)).map((item) => el('a', {
    class: 'rail-link', href: item.url, target: '_blank', rel: 'noopener',
  }, el('small', { text: KINDS[item.kind] }), el('span', { text: item.title }))));
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
  const key = `v:${video.id}`;
  const mark = el('button', {
    class: 'linkish', type: 'button', text: isDone(key) ? 'Watched ✓' : 'Mark watched',
    onclick: () => { setDone(key, !isDone(key)); mark.textContent = isDone(key) ? 'Watched ✓' : 'Mark watched'; },
  });
  player.hidden = false;
  player.replaceChildren(
    el('div', { class: 'player-bar' },
      el('span', { text: video.title }),
      mark,
      el('a', { class: 'linkish', href: videoUrl(video), target: '_blank', rel: 'noopener', text: 'YouTube ↗' }),
      el('button', { class: 'linkish', type: 'button', text: 'Close', onclick: () => { player.hidden = true; player.replaceChildren(); } })),
    el('iframe', { src: embedUrl(video), title: video.title, allow: 'autoplay; encrypted-media; picture-in-picture', allowfullscreen: true }),
  );
}

/* Camera commands */

function panelShift() {
  // On tall screens the HUD sits on top, so the mountain rides lower.
  if ($('panel').hidden) return world?.setPanelShift(0, window.innerHeight > window.innerWidth ? -window.innerHeight * 0.1 : 0);
  if (window.innerWidth <= 760) return world?.setPanelShift(0, $('panel').offsetHeight / 2 - 30);
  return world?.setPanelShift($('panel').offsetWidth / 2, 0);
}

const focusPhase = (phaseId) => {
  openPanel(phaseId);
  world?.focusPhase(phaseId);
};

function focusTopic(phaseId, topicId) {
  openPanel(phaseId, topicId, 'topics');
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
    if (typing || !$('plan-view').hidden || !$('library-view').hidden || !$('palette').hidden || !world) return;
    if ($('panel').contains(document.activeElement) || document.activeElement.type === 'range') return;
    if (event.key === 'ArrowLeft') world.pan(90, 0);
    else if (event.key === 'ArrowRight') world.pan(-90, 0);
    else if (event.key === 'ArrowUp') world.pan(0, 90);
    else if (event.key === 'ArrowDown') world.pan(0, -90);
    else if (event.key === '+' || event.key === '=') world.zoom(0.8);
    else if (event.key === '-') world.zoom(1.25);
    else if (event.key === '0') overviewAll();
    else if (event.key === ' ' && event.target === $('stage')) { event.preventDefault(); togglePlay(); }
  });
}

function dismissHint() {
  $('hint-keys').classList.add('gone');
}

function overviewAll() {
  closePanel();
  world?.overview();
}


/* Highlight and state */

function applyHighlight() {
  const active = hoveredPhase || selectedPhase;
  world?.setActive(active);
  document.querySelectorAll('.wnode[data-phase]').forEach((node) => {
    const id = node.dataset.phase;
    const related = !active || id === active || ancestors(active).has(id) || phaseById(id).needs.includes(active);
    node.classList.toggle('dim', !related);
  });
}

function syncWorld() {
  data.phases.forEach((phase) => {
    const done = topicsDone(phase) === phase.topics.length;
    const label = done ? 'Done' : inFocus(phase) ? 'Now' : practising(phase) ? 'Ongoing' : '';
    const state = document.querySelector(`[data-state="${phase.id}"]`);
    if (!state) return;
    state.textContent = label;
    state.hidden = !label;
    document.querySelector(`[data-sub="${phase.id}"]`).textContent = `${topicsDone(phase)}/${phase.topics.length} topics · M${phase.start}–${phase.end}`;
    document.querySelector(`[data-meter="${phase.id}"]`).style.width = `${phasePct(phase)}%`;
    document.querySelector(`.plabel[data-phase="${phase.id}"]`).classList.toggle('live', inFocus(phase));
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
  world?.sync();
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
  world?.setMonth(month);
  const you = $('you');
  if (you) you.textContent = clampMonth(currentMonth()) === month ? `You · ${monthLabel(month)}` : monthLabel(month);
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

function stopPlay() {
  if (!playing) return;
  playing = false;
  world?.stopJourney();
  $('play').textContent = '▶';
  $('play').setAttribute('aria-label', 'Climb the mountain');
}

function togglePlay() {
  if (playing) { stopPlay(); return; }
  if (!world) return;
  closePanel();
  if (month >= TOTAL_MONTHS) setMonth(1);
  playing = true;
  $('play').textContent = '❚❚';
  $('play').setAttribute('aria-label', 'Pause the climb');
  world.startJourney(month, (m) => {
    const before = data.phases.filter((phase) => inFocus(phase, m - 1)).map((phase) => phase.id);
    const due = setMonth(m);
    const started = data.phases.find((phase) => phase.start === m && !before.includes(phase.id));
    if (due.length) toast(`${monthLabel(m)}: ${due.map((cert) => cert.name).join(', ')}`);
    else if (started) toast(`Phase ${started.n} begins: ${started.title}`);
  }, () => {
    stopPlay();
    setMonth(TOTAL_MONTHS);
    toast('Month 36: the summit. Principal Engineer.');
    world.overview();
  });
}

function renderGantt() {
  const gantt = $('gantt');
  const pct = (value) => ((value - 1) / (TOTAL_MONTHS - 1)) * 100;
  data.phases.forEach((phase, i) => {
    gantt.append(el('i', { style: `--c:${color(phase)};left:${pct(phase.start)}%;width:${pct(phase.end + 1) - pct(phase.start)}%;top:${i * 2.2}px` }));
  });
  allCerts().forEach((cert) => gantt.append(el('b', { 'data-exam': cert.core ? 'core' : 'optional', style: `left:${pct(cert.month)}%` })));
}


/* Now card: what to do next, in one click */

function nextTopic() {
  const now = clampMonth(currentMonth());
  const ordered = data.phases.slice().sort((a, b) => Number(inFocus(b, now)) - Number(inFocus(a, now)) || a.start - b.start);
  for (const phase of ordered) {
    const topic = phase.topics.find((candidate) => !isDone(`t:${candidate.id}`));
    if (topic) return { phase, topic };
  }
  return null;
}

function renderNow() {
  const total = allTopics().length;
  const done = data.phases.reduce((sum, phase) => sum + topicsDone(phase), 0);
  const now = currentMonth();
  const exam = allCerts().find((cert) => cert.core && !isDone(certKey(cert)));
  let when = `Month ${clampMonth(now)} of ${TOTAL_MONTHS}`;
  if (now < 1) when = `Starts ${monthLabel(1)}`;
  if (now > TOTAL_MONTHS) when = 'The 36 months are up';
  const away = exam ? exam.month - Math.max(now, 1) : 0;
  const examText = !exam ? 'All core exams passed' : away > 0 ? `${exam.exam} in ${away} ${away === 1 ? 'month' : 'months'}` : away === 0 ? `${exam.exam} is due this month` : `${exam.exam} is ${-away} ${away === -1 ? 'month' : 'months'} overdue`;
  $('now-status').textContent = `${when} · ${examText} · ${done}/${total} topics`;
  const next = nextTopic();
  const go = $('now-go');
  const open = $('now-topic');
  if (!next) {
    $('now-title').textContent = 'Every topic is done.';
    $('now-detail').textContent = 'Nothing left on the road.';
    go.hidden = true;
    open.hidden = true;
    return;
  }
  const video = next.topic.videos.find((candidate) => !isDone(`v:${candidate.id}`));
  $('now-title').textContent = next.topic.short;
  $('now-title').style.setProperty('--c', color(next.phase));
  $('now-detail').textContent = video ? `${video.title} · ${formatLength(video)}` : `Courses watched. Lab: ${next.topic.lab}`;
  go.hidden = !video;
  go.textContent = done || Object.keys(progress.items).some((key) => key.startsWith('v:')) ? '▶ Continue' : '▶ Start';
  go.onclick = () => { focusTopic(next.phase.id, next.topic.id); if (video) playVideo(video); };
  open.hidden = false;
  open.onclick = () => focusTopic(next.phase.id, next.topic.id);
}

function renderPhaseList() {
  $('phase-list').replaceChildren(...data.phases.map((phase) => el('li', { style: `--c:${color(phase)}` },
    el('button', { class: 'phase-row', type: 'button', onclick: () => openPanel(phase.id, null, 'topics') },
      el('i', { class: 'swatch' }),
      el('strong', { text: phase.title }),
      el('span', { text: `${topicsDone(phase)}/${phase.topics.length} topics · ${monthLabel(phase.start)} – ${monthLabel(phase.end)}` })))));
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
  $('library-view').hidden = true;
  document.body.classList.remove('in-map');
  window.scrollTo(0, 0);
  world?.pause(true);
}

function libraryItems() {
  const found = new Map();
  const add = (key, entry, topic) => {
    if (!found.has(key)) found.set(key, { ...entry, key, topics: [] });
    if (topic) found.get(key).topics.push(topic);
  };
  data.phases.forEach((phase) => {
    phase.topics.forEach((topic) => {
      const ref = { phase, topic };
      topic.videos.forEach((video) => add(`v:${video.id}`, { kind: 'course', title: video.title, sub: `${formatLength(video)} · ${video.by}`, url: videoUrl(video), video, phase }, ref));
      topic.resources.forEach((item) => add(`r:${item.url}`, { kind: item.kind, title: item.title, url: item.url, phase }, ref));
    });
    phase.reading.filter((item) => !item.free).forEach((item) => add(`b:${item.title}`, { kind: 'book', title: item.title, sub: item.how, phase }));
    phase.reading.filter((item) => item.free).forEach((item) => add(`b:${item.title}`, { kind: 'read', title: item.title, sub: item.how, phase }));
  });
  return [...found.values()];
}

const library = { items: [], kind: 'all', phase: 'all', query: '', hideDone: false };

function renderLibraryFilters() {
  const counts = (kind) => (kind === 'all' ? library.items.length : library.items.filter((item) => item.kind === kind).length);
  const chip = (group, id, label, swatch) => el('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(library[group] === id), style: swatch ? `--c:${swatch}` : false,
    onclick: () => { library[group] = id; renderLibraryFilters(); renderLibrary(); },
  }, swatch ? el('i', { class: 'swatch' }) : null, label);
  $('lib-kinds').replaceChildren(chip('kind', 'all', `All ${counts('all')}`), ...Object.keys(KINDS).map((kind) => chip('kind', kind, `${KINDS[kind]} ${counts(kind)}`)));
  $('lib-phases').replaceChildren(chip('phase', 'all', 'All phases'), ...data.phases.map((phase) => chip('phase', phase.id, phase.short, color(phase))));
}

function renderLibrary() {
  const query = library.query.trim().toLowerCase();
  const rows = library.items.filter((item) => (library.kind === 'all' || item.kind === library.kind)
    && (library.phase === 'all' || item.phase.id === library.phase || item.topics.some(({ phase }) => phase.id === library.phase))
    && !(library.hideDone && isDone(item.key))
    && (!query || `${item.title} ${item.sub || ''} ${item.topics.map(({ topic }) => topic.title).join(' ')}`.toLowerCase().includes(query)));
  $('lib-count').textContent = `${rows.length} ${rows.length === 1 ? 'resource' : 'resources'}`;
  $('lib-list').replaceChildren(...rows.map((item) => el('li', { class: `lib-row${isDone(item.key) ? ' is-done' : ''}`, style: `--c:${color(item.phase)}` },
    el('input', { class: 'check', type: 'checkbox', 'aria-label': `Done: ${item.title}`, checked: isDone(item.key), onchange: (event) => { setDone(item.key, event.target.checked); renderLibrary(); } }),
    el('span', { class: 'lib-kind', text: KINDS[item.kind] }),
    el('div', { class: 'lib-main' },
      item.url ? el('a', { href: item.url, target: '_blank', rel: 'noopener', text: item.title }) : el('strong', { text: item.title }),
      item.sub ? el('small', { text: item.sub }) : null),
    el('div', { class: 'lib-topics' },
      item.video ? el('button', { class: 'linkish', type: 'button', text: '▶ Play', onclick: () => playVideo(item.video) }) : null,
      ...item.topics.slice(0, 2).map(({ phase, topic }) => el('button', {
        class: 'linkish', type: 'button', text: topic.short,
        onclick: () => { showMap(); focusTopic(phase.id, topic.id); },
      })),
      !item.topics.length ? el('button', { class: 'linkish', type: 'button', text: item.phase.short, onclick: () => { showMap(); openPanel(item.phase.id, null, 'reading'); world?.focusPhase(item.phase.id); } }) : null))));
}

function showLibrary() {
  stopPlay();
  closePanel();
  if (!library.items.length) { library.items = libraryItems(); renderLibraryFilters(); }
  renderLibrary();
  $('map-view').hidden = true;
  $('plan-view').hidden = true;
  $('library-view').hidden = false;
  document.body.classList.remove('in-map');
  window.scrollTo(0, 0);
  world?.pause(true);
}

function showMap() {
  if (!world) return;
  $('plan-view').hidden = true;
  $('library-view').hidden = true;
  $('map-view').hidden = false;
  document.body.classList.add('in-map');
  world.pause(false);
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
        el('label', { class: 'watched-toggle' }, el('input', { type: 'checkbox', checked: isDone(`v:${video.id}`), onchange: (event) => setDone(`v:${video.id}`, event.target.checked) }), 'Watched'),
        el('a', { class: 'linkish', href: videoUrl(video), target: '_blank', rel: 'noopener', text: 'Open on YouTube ↗' }))));
}

function renderResources(topic, kind) {
  const items = topic.resources.filter((item) => item.kind === kind);
  if (!items.length) return null;
  return el('div', {},
    el('p', { class: 'detail-label', text: kind === 'lab' ? 'Hands-on practice' : kind === 'docs' ? 'Official docs' : kind === 'read' ? 'Free reading' : 'Books' }),
    el('ul', { class: 'res-list' }, ...items.map(renderResource)));
}

function renderResource(item) {
  const key = `r:${item.url}`;
  return el('li', { class: isDone(key) ? 'is-done' : '' },
    el('input', { class: 'check', type: 'checkbox', 'aria-label': `Done: ${item.title}`, checked: isDone(key), onchange: (event) => setDone(key, event.target.checked) }),
    el('a', { href: item.url, target: '_blank', rel: 'noopener', text: item.title }));
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
          `${count} free ${count === 1 ? 'course' : 'courses'} · ${topic.resources.length} resources`)),
      el('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }))));
  if (expanded) {
    row.append(el('div', { class: 'topic-detail' },
      el('div', {}, el('p', { class: 'detail-label', text: 'What to learn' }), el('ul', { class: 'learn' }, ...topic.learn.map((line) => el('li', { text: line })))),
      el('div', {}, el('p', { class: 'detail-label', text: 'Free courses' }), el('div', { class: 'vids' }, ...topic.videos.map((video, i) => renderVideo(video, i === 0)))),
      ...['lab', 'docs', 'read', 'book'].map((kind) => renderResources(topic, kind)),
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
      fact(String(phase.topics.reduce((sum, topic) => sum + topic.resources.length, 0)), 'docs, labs and readings'),
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
  renderRail(topicId);
  panelShift();
  if (topicId) world?.focusTopic(topicId);
  else if (selectedPhase) world?.focusPhase(selectedPhase);
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
    renderRail(null);
    renderPanel();
    $('panel').scrollTop = 0;
  }
  panelShift();
  applyHighlight();
}

function closePanel() {
  if (!selectedPhase) return;
  selectedPhase = null;
  openTopic = null;
  renderRail(null);
  $('panel').hidden = true;
  document.body.classList.remove('panel-open');
  panelShift();
  applyHighlight();
  history.replaceState(null, '', location.pathname + location.search);
}

function refresh() {
  renderStats();
  renderNow();
  renderPhaseList();
  renderLadder();
  renderNinety();
  syncWorld();
  if (selectedPhase) renderPanel();
  if (openTopic) renderRail(openTopic);
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
      topic.resources.forEach((item) => {
        items.push({ label: item.title, hint: KINDS[item.kind], phase, go: () => window.open(item.url, '_blank', 'noopener'), text: `${item.title} ${topic.short}` });
      });
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
  $('month').addEventListener('input', (event) => { stopPlay(); setMonth(Number(event.target.value)); world?.focusMonth(month); });
  $('today').addEventListener('click', () => { stopPlay(); setMonth(currentMonth()); world?.focusMonth(month); });
  $('fit').addEventListener('click', () => { stopPlay(); overviewAll(); });
  $('to-plan').addEventListener('click', showPlan);
  $('to-library').addEventListener('click', showLibrary);
  $('plan-library').addEventListener('click', showLibrary);
  $('lib-back').addEventListener('click', () => { if (world) showMap(); else showPlan(); });
  $('lib-search').addEventListener('input', (event) => { library.query = event.target.value; renderLibrary(); });
  $('lib-hide').addEventListener('change', (event) => { library.hideDone = event.target.checked; renderLibrary(); });
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
    world?.refreshTheme();
  });
  window.addEventListener('resize', () => { world?.resize(); panelShift(); });
  window.addEventListener('hashchange', openFromHash);
  bindKeys();
}

function startWorld() {
  try {
    world = createScene({
      canvas: $('gl'), labelRoot: $('labels'), data, labels: labelFactory, isDone,
      callbacks: {
        onUserInput: () => { stopPlay(); dismissHint(); },
        onPhase: focusPhase,
        onTopic: focusTopic,
        onExam: (id) => openPanel(id, null, 'exams'),
        onHover: hoverPhase,
      },
    });
  } catch (e) {
    world = null;
  }
}

async function init() {
  document.body.classList.add('in-map');
  try {
    const response = await fetch('data/roadmap.json');
    if (!response.ok) throw new Error(response.status);
    data = await response.json();
  } catch (e) {
    $('now-title').textContent = "The roadmap data couldn't load. Please reload the page.";
    return;
  }
  labelTheme();
  startWorld();
  if (!world) {
    // No WebGL: the plan view plus the phase list still gives full access to every course.
    showPlan();
    $('to-map').hidden = true;
  }
  renderGantt();
  renderStatic();
  bindEvents();
  refresh();
  setMonth(currentMonth());
  panelShift();
  setTimeout(dismissHint, 8000);
  openFromHash();
}

init();
