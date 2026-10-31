'use strict';

const STORE_KEY = 'the-path-progress-v1';
const THEME_KEY = 'the-path-theme';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TOTAL_MONTHS = 36;

let data;
let progress = loadProgress();
let selectedPhase = null;
let activeTab = 'overview';
let openTopic = null;
let month = 1;
let searchQuery = '';

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


function toast(message) {
  const node = $('toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 2600);
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
      onclick: () => { showMap(); openPanel(cert.phase.id, null, 'exams'); },
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
  closePanel();
  $('map-view').hidden = true;
  $('plan-view').hidden = false;
  $('library-view').hidden = true;
  window.scrollTo(0, 0);
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
      !item.topics.length ? el('button', { class: 'linkish', type: 'button', text: item.phase.short, onclick: () => { showMap(); openPanel(item.phase.id, null, 'reading'); } }) : null))));
}

function showLibrary() {
  closePanel();
  if (!library.items.length) { library.items = libraryItems(); renderLibraryFilters(); }
  renderLibrary();
  $('map-view').hidden = true;
  $('plan-view').hidden = true;
  $('library-view').hidden = false;
  window.scrollTo(0, 0);
}

function showMap() {
  $('plan-view').hidden = true;
  $('library-view').hidden = true;
  $('map-view').hidden = false;
  drawLinks();
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

function stepCallout(key, label, text) {
  return el('label', { class: 'callout step-callout' },
    el('input', { class: 'check', type: 'checkbox', checked: isDone(key), onchange: (event) => setDone(key, event.target.checked) }),
    el('span', {}, el('span', { class: 'detail-label', text: label }), text));
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
      stepCallout(`l:${topic.id}`, 'Do the lab', topic.lab),
      stepCallout(`s:${topic.id}`, 'Answer without notes', topic.check),
      el('button', {
        class: 'now-go', type: 'button', text: isDone(key) ? 'Topic done ✓' : 'Mark topic done',
        onclick: () => setDone(key, !isDone(key)),
      })));
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
}

function openPanel(phaseId, topicId = null, tab = 'overview') {
  if (!phaseById(phaseId)) return;
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
    renderPanel();
    $('panel').scrollTop = 0;
  }
  renderRoad();
}

function closePanel() {
  if (!selectedPhase) return;
  selectedPhase = null;
  openTopic = null;
  $('panel').hidden = true;
  document.body.classList.remove('panel-open');
  renderRoad();
  history.replaceState(null, '', location.pathname + location.search);
}

function refresh() {
  renderStats();
  renderNow();
  renderStrip();
  renderRoad();
  syncOptional();
  renderLadder();
  renderNinety();
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
  showMap();
  if (!paletteIndex.length) paletteIndex = searchIndex();
  $('palette').hidden = false;
  $('palette-input').value = '';
  renderPalette('');
  $('palette-input').focus();
}

function closePalette() {
  $('palette').hidden = true;
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
  $('optional').addEventListener('change', refresh);
  $('road-filter').addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    roadFilter = button.dataset.filter;
    renderRoad();
  });
  $('to-plan').addEventListener('click', showPlan);
  $('to-library').addEventListener('click', showLibrary);
  $('plan-library').addEventListener('click', showLibrary);
  $('lib-back').addEventListener('click', showMap);
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
  });
  window.addEventListener('resize', drawLinks);
  new ResizeObserver(drawLinks).observe($('road'));
  window.addEventListener('hashchange', openFromHash);
  document.addEventListener('keydown', (event) => {
    const typing = /INPUT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.type !== 'checkbox';
    if (event.key === 'Escape') {
      if (!$('palette').hidden) closePalette();
      else if (selectedPhase) closePanel();
    } else if ((event.key === 'k' && (event.ctrlKey || event.metaKey)) || (event.key === '/' && !typing)) {
      event.preventDefault();
      openPalette();
    }
  });
}

init();

/* Actions and pace */

const focusPhase = (phaseId) => openPanel(phaseId);

function focusTopic(phaseId, topicId) {
  openPanel(phaseId, topicId, 'topics');
}

const topicStep = (topic) => {
  if (isDone(`t:${topic.id}`)) return 3;
  if (isDone(`s:${topic.id}`)) return 3;
  if (isDone(`l:${topic.id}`)) return 2;
  return topic.videos.some((video) => isDone(`v:${video.id}`)) ? 1 : 0;
};

function nextTopic() {
  const now = clampMonth(currentMonth());
  const ordered = data.phases.slice().sort((a, b) => Number(inFocus(b, now)) - Number(inFocus(a, now)) || a.start - b.start);
  for (const phase of ordered) {
    const topic = phase.topics.find((candidate) => !isDone(`t:${candidate.id}`));
    if (topic) return { phase, topic };
  }
  return null;
}

function nextAction(found) {
  const { phase, topic } = found;
  const go = () => focusTopic(phase.id, topic.id);
  const step = topicStep(topic);
  if (step === 0) {
    const video = topic.videos[0];
    return {
      n: 1, title: `Watch ${video.title}`, detail: `${formatLength(video)} · ${video.by}${video.note ? `. ${video.note}` : ''}`, cta: '▶ Watch',
      run: () => { go(); playVideo(video); }, finish: () => setDone(`v:${video.id}`, true), finishLabel: 'I watched it',
    };
  }
  if (step === 1) return { n: 2, title: 'Do the lab', detail: topic.lab, cta: 'Open the topic', run: go, finish: () => setDone(`l:${topic.id}`, true), finishLabel: 'Lab done' };
  if (step === 2) return { n: 3, title: 'Answer this without notes', detail: topic.check, cta: 'Open the topic', run: go, finish: () => setDone(`s:${topic.id}`, true), finishLabel: 'I can answer it' };
  return { n: 3, title: 'Finish this topic', detail: 'Watched, practised and checked. Mark it done to move on.', cta: 'Open the topic', run: go, finish: () => setDone(`t:${topic.id}`, true), finishLabel: 'Mark topic done' };
}

function expectedDone(at) {
  return data.phases.reduce((sum, phase) => {
    const span = phase.end + 1 - phase.start;
    return sum + Math.floor(Math.min(1, Math.max(0, (at - phase.start) / span)) * phase.topics.length);
  }, 0);
}

function paceText(done) {
  const now = currentMonth();
  if (now < 1) return { text: `Starts ${monthLabel(1)}`, state: 'ahead' };
  const gap = done - expectedDone(now);
  if (gap < 0) return { text: `${-gap} ${gap === -1 ? 'topic' : 'topics'} behind plan`, state: 'behind' };
  if (gap > 0) return { text: `${gap} ${gap === 1 ? 'topic' : 'topics'} ahead of plan`, state: 'ahead' };
  return { text: 'On track', state: 'ahead' };
}

function renderNow() {
  const total = allTopics().length;
  const done = data.phases.reduce((sum, phase) => sum + topicsDone(phase), 0);
  const found = nextTopic();
  const pace = paceText(done);
  const now = currentMonth();
  const exam = allCerts().find((cert) => cert.core && !isDone(certKey(cert)));
  const away = exam ? exam.month - Math.max(now, 1) : 0;
  const stat = (big, small, cls = '') => el('div', { class: `now-stat ${cls}` }, el('b', { text: big }), el('span', { text: small }));
  $('stats-row').replaceChildren(
    stat(`${done}/${total}`, 'topics done'),
    stat(pace.text, now < 1 ? 'first month of the plan' : `month ${clampMonth(now)} of ${TOTAL_MONTHS}`, pace.state === 'behind' ? 'warn' : ''),
    stat(exam ? exam.exam : 'All passed', !exam ? 'every core exam' : away > 0 ? `in ${away} ${away === 1 ? 'month' : 'months'}, ${monthLabel(exam.month)}` : away === 0 ? 'due this month' : `${-away} months overdue`, away < 0 ? 'warn' : ''),
  );
  if (!found) {
    $('action').replaceChildren(el('h2', { text: 'Every topic is done.' }), el('p', { text: 'Nothing left on the road. Check the exams and projects.' }));
    $('week-card').replaceChildren();
    return;
  }
  const action = nextAction(found);
  $('action').style.setProperty('--c', color(found.phase));
  $('action').replaceChildren(
    el('p', { class: 'action-kicker' }, el('i', { class: 'swatch' }), `Do this next · ${found.topic.short}`),
    el('h2', { text: action.title }),
    el('p', { class: 'action-detail', text: action.detail }),
    el('ol', { class: 'stepper', 'aria-label': `Step ${action.n} of 3` }, ...['Watch', 'Lab', 'Check'].map((label, i) => el('li', {
      class: i < topicStep(found.topic) ? 'on' : i === topicStep(found.topic) ? 'cur' : '', text: label,
    }))),
    el('div', { class: 'now-actions' },
      el('button', { class: 'now-go', type: 'button', text: action.cta, onclick: action.run }),
      el('button', { class: 'ghost', type: 'button', text: `${action.finishLabel} ✓`, onclick: action.finish })),
  );
  renderWeek(found, exam);
}

function renderWeek(found, exam) {
  const { phase, topic } = found;
  const project = phase.projects.find((item) => !isDone(`p:${phase.id}:${item.name}`));
  const task = (when, what, key, open) => el('li', { class: key && isDone(key) ? 'is-done' : '' },
    key ? el('input', { class: 'check', type: 'checkbox', 'aria-label': what, checked: isDone(key), onchange: (event) => setDone(key, event.target.checked) }) : null,
    el('span', { class: 'week-when', text: when }),
    open ? el('button', { class: 'linkish', type: 'button', text: what, onclick: open }) : el('span', { text: what }));
  const go = () => focusTopic(phase.id, topic.id);
  const video = topic.videos[0];
  const items = [
    task('Tue · 90 min', `Watch: ${video.title}`, `v:${video.id}`, go),
    task('Thu · 90 min', `Lab: ${topic.short}`, `l:${topic.id}`, go),
    project ? task('Weekend · 5 h', `Build: ${project.name}`, `p:${phase.id}:${project.name}`, () => openPanel(phase.id, null, 'projects')) : null,
    task('Daily · 10 min', 'Anki review'),
  ];
  if (exam && exam.month - Math.max(currentMonth(), 1) <= 6 && !isDone(certKey(exam))) {
    items.unshift(task('This week', `Book ${exam.exam} for ${monthLabel(exam.month)}`, `k:${exam.exam}`, () => openPanel(exam.phase.id, null, 'exams')));
  }
  $('week-card').replaceChildren(el('h2', { text: 'This week' }), el('ul', { class: 'week-list' }, ...items));
}

/* The 2D roadmap */

const ROWS = [['systems'], ['network', 'code'], ['cloud', 'k8s'], ['security', 'data'], ['principal']];
let roadFilter = 'all';

function phaseState(phase) {
  const now = clampMonth(currentMonth());
  if (topicsDone(phase) === phase.topics.length) return 'done';
  if (inFocus(phase, now)) return 'now';
  if (phase.start > now && phase.start - now <= 3) return 'soon';
  if (phase.start > now) return 'later';
  return practising(phase, now) ? 'ongoing' : 'overdue';
}
const STATE_LABEL = { done: 'Done', now: 'In focus', soon: 'Up next', later: 'Later', ongoing: 'Keep practising', overdue: 'Overdue' };

function renderStrip() {
  const pct = (value) => ((value - 1) / TOTAL_MONTHS) * 100;
  const showOptional = $('optional').checked;
  const today = currentMonth();
  const todayMark = today >= 1 && today <= TOTAL_MONTHS
    ? [el('div', { class: 'strip-today', style: `--at-n:${pct(today + (new Date().getDate() - 1) / 30) / 100}` }, el('span', { text: 'Today' }))]
    : [];
  $('strip').replaceChildren(
    el('div', { class: 'strip-years' }, ...[0, 1, 2].map((year) => el('span', { style: `left:${(year * 12 / TOTAL_MONTHS) * 100}%`, text: monthLabel(year * 12 + 1) }))),
    ...data.phases.map((phase) => el('button', {
      class: 'strip-row', type: 'button', style: `--c:${color(phase)}`, title: `${phase.title}: ${monthLabel(phase.start)} to ${monthLabel(phase.end)}`,
      onclick: () => document.getElementById(`phase-${phase.id}`).scrollIntoView({ block: 'start' }),
    },
    el('span', { class: 'strip-name', text: `${phase.n} ${phase.short}` }),
    el('span', { class: 'strip-track' },
      el('i', { style: `left:${pct(phase.start)}%;width:${pct(phase.end + 1) - pct(phase.start)}%` }, el('u', { style: `width:${phasePct(phase)}%` })),
      ...phase.certs.filter((cert) => cert.core || showOptional).map((cert) => el('b', {
        class: isDone(certKey(cert)) ? 'passed' : '', style: `left:${pct(cert.month + 0.5)}%`, title: `${cert.exam}, ${monthLabel(cert.month)}`,
      }))))),
    ...todayMark,
  );
}

function topicMonth(phase, i) {
  return Math.floor(phase.start + ((i + 0.5) / phase.topics.length) * (phase.end + 1 - phase.start));
}

function renderTopicRow(phase, topic, i, next) {
  const key = `t:${topic.id}`;
  const done = isDone(key);
  const isNext = next?.topic.id === topic.id;
  const step = done ? 3 : topicStep(topic);
  return el('li', { class: `node${done ? ' done' : ''}${isNext ? ' next' : ''}${openTopic === topic.id ? ' open' : ''}`, id: `node-${topic.id}` },
    el('input', { class: 'tick', type: 'checkbox', 'aria-label': `Done: ${topic.title}`, checked: done, onchange: (event) => setDone(key, event.target.checked) }),
    el('button', { class: 'node-main', type: 'button', onclick: () => focusTopic(phase.id, topic.id) },
      el('span', { class: 'node-title', text: topic.short }),
      el('span', { class: 'node-meta' },
        isNext ? el('em', { text: 'Next' }) : null,
        `${monthLabel(topicMonth(phase, i))} · ${topic.videos.length + topic.resources.length} resources`)),
    el('span', { class: 'dots', role: 'img', 'aria-label': `${step} of 3 steps done` }, ...[0, 1, 2].map((n) => el('i', { class: n < step ? 'on' : '' }))));
}

function renderExamRow(phase, cert) {
  const key = certKey(cert);
  return el('li', { class: `node exam${isDone(key) ? ' done' : ''}${cert.core ? '' : ' opt'}` },
    el('input', { class: 'tick', type: 'checkbox', 'aria-label': `Passed ${cert.name}`, checked: isDone(key), onchange: (event) => setDone(key, event.target.checked) }),
    el('button', { class: 'node-main', type: 'button', onclick: () => openPanel(phase.id, null, 'exams') },
      el('span', { class: 'node-title', text: `Exam: ${cert.exam}` }),
      el('span', { class: 'node-meta', text: `${monthLabel(cert.month)} · ${cert.cost}${cert.core ? '' : ' · optional'}` })));
}

function renderPhaseCard(phase, next) {
  const state = phaseState(phase);
  const showOptional = $('optional').checked;
  const entries = [
    ...phase.topics.map((topic, i) => ({ at: topicMonth(phase, i) + 0.1 * i / phase.topics.length, row: () => renderTopicRow(phase, topic, i, next), done: isDone(`t:${topic.id}`) })),
    ...phase.certs.filter((cert) => cert.core || showOptional).map((cert) => ({ at: cert.month + 0.95, row: () => renderExamRow(phase, cert), done: isDone(certKey(cert)) })),
  ].sort((a, b) => a.at - b.at).filter((entry) => roadFilter !== 'todo' || !entry.done);
  const dimmed = (selectedPhase && selectedPhase !== phase.id) ? ' quiet' : '';
  return el('article', { class: `phase ${state}${dimmed}`, id: `phase-${phase.id}`, 'data-phase': phase.id, style: `--c:${color(phase)}` },
    el('header', { class: 'phase-head' },
      el('span', { class: 'phase-n', text: phase.n }),
      el('button', { class: 'phase-title', type: 'button', onclick: () => focusPhase(phase.id) },
        el('strong', { text: phase.short }),
        el('small', { text: `${monthLabel(phase.start)} – ${monthLabel(phase.end)}` })),
      el('span', { class: `pill state-${state}`, text: STATE_LABEL[state] })),
    el('div', { class: 'phase-progress' },
      el('span', { class: 'meter' }, el('i', { style: `width:${phasePct(phase)}%` })),
      el('small', { text: `${topicsDone(phase)}/${phase.topics.length}` })),
    phase.needs.length ? el('p', { class: 'phase-needs', text: `Builds on ${phase.needs.map((id) => phaseById(id).short).join(', ')}` }) : null,
    entries.length ? el('ol', { class: 'nodes' }, ...entries.map((entry) => entry.row())) : el('p', { class: 'phase-needs', text: 'Everything here is finished.' }));
}

function renderRoad() {
  const next = nextTopic();
  // Rows are rebuilt, so put keyboard focus back where it was.
  const active = document.activeElement;
  const focusRow = active?.closest?.('.node')?.id;
  const focusClass = active?.classList?.[0];
  const scope = (id) => {
    if (roadFilter !== 'focus') return true;
    const state = phaseState(phaseById(id));
    return state === 'now' || state === 'soon' || state === 'overdue';
  };
  $('road-filter').querySelectorAll('[data-filter]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.filter === roadFilter)));
  $('road-rows').replaceChildren(...ROWS
    .map((row) => row.filter(scope))
    .filter((row) => row.length)
    .map((row) => el('div', { class: `road-row n${row.length}` }, ...row.map((id) => renderPhaseCard(phaseById(id), next)))));
  if (focusRow && focusClass) document.getElementById(focusRow)?.querySelector(`.${focusClass}`)?.focus({ preventScroll: true });
  drawLinks();
}

function syncOptional() {
  const showOptional = $('optional').checked;
  document.querySelectorAll('#ladder tr.is-opt').forEach((row) => row.classList.toggle('hide', !showOptional));
}

// Dependency lines between phase cards. Lines that skip a row run down the outer gutter.
function drawLinks() {
  const svg = $('links');
  const road = $('road');
  if (!road.offsetWidth) return;
  const box = road.getBoundingClientRect();
  const rect = (id) => {
    const node = document.getElementById(`phase-${id}`);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { l: r.left - box.left, r: r.right - box.left, t: r.top - box.top, b: r.bottom - box.top, cx: (r.left + r.right) / 2 - box.left };
  };
  svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
  svg.setAttribute('height', box.height);
  const paths = [];
  const rowOf = (id) => ROWS.findIndex((row) => row.includes(id));
  data.phases.forEach((phase) => {
    phase.needs
      .filter((need) => !phase.needs.some((other) => other !== need && ancestors(other).has(need)))
      .forEach((need) => {
        const from = rect(need);
        const to = rect(phase.id);
        if (!from || !to) return;
        const skip = rowOf(phase.id) - rowOf(need) > 1;
        let d;
        if (skip) {
          const x = box.width - 8;
          d = `M${from.r} ${from.b - 40} C${x} ${from.b - 40} ${x} ${from.b + 20} ${x} ${from.b + 60} L${x} ${to.t - 20} C${x} ${to.t + 20} ${x} ${to.t + 40} ${to.r} ${to.t + 40}`;
        } else {
          const mid = (from.b + to.t) / 2;
          d = `M${from.cx} ${from.b} C${from.cx} ${mid} ${to.cx} ${mid} ${to.cx} ${to.t}`;
        }
        const source = phaseById(need);
        const state = topicsDone(source) === source.topics.length ? 'done' : inFocus(source, clampMonth(currentMonth())) ? 'live' : 'wait';
        const quiet = selectedPhase && selectedPhase !== need && selectedPhase !== phase.id ? ' quiet' : '';
        paths.push(`<path class="link ${state}${quiet}" style="--c:var(--s${source.n})" d="${d}"/>`);
      });
  });
  svg.innerHTML = paths.join('');
}

async function init() {
  try {
    const response = await fetch('data/roadmap.json');
    if (!response.ok) throw new Error(response.status);
    data = await response.json();
  } catch (e) {
    $('action').textContent = "The roadmap data couldn't load. Please reload the page.";
    return;
  }
  month = clampMonth(currentMonth());
  labelTheme();
  renderStatic();
  bindEvents();
  refresh();
  openFromHash();
}

init();
