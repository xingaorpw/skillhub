/**
 * SkillHub console — plain ES modules, no build step.
 *
 * The server is the single source of truth: every mutation returns the whole new
 * state and the view is a pure function of it. That is what keeps the dashboard,
 * the table and the command palette from drifting apart.
 */

import { renderMarkdown } from './markdown.js';

const el = (id) => document.getElementById(id);
const TOKEN_KEY = 'skillhub.token';

// A token is only needed when the console is bound to a non-loopback address.
const urlToken = new URLSearchParams(location.search).get('token');
if (urlToken) {
  localStorage.setItem(TOKEN_KEY, urlToken);
  history.replaceState(null, '', location.pathname);
}

/* --------------------------------------------------------------- utilities */

/**
 * Tiny hyperscript: `h('div', { class: 'x', onclick: fn }, child, 'text')`.
 *
 * @param {string} tag
 * @param {Record<string, any> | null} [props]
 * @param {...any} children
 * @returns {HTMLElement}
 */
function h(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node[key] = value;
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

const ICONS = {
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
  layers:
    '<path d="M12 3.2 3.6 7.4 12 11.6l8.4-4.2L12 3.2Z"/><path d="m3.6 12 8.4 4.2 8.4-4.2"/><path d="m3.6 16.4 8.4 4.2 8.4-4.2"/>',
  folder: '<path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h3.6l1.7 2H19a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 19 18H5a1.5 1.5 0 0 1-1.5-1.5v-9Z"/>',
  git: '<circle cx="6.5" cy="6" r="2.2"/><circle cx="6.5" cy="18" r="2.2"/><circle cx="17.5" cy="8" r="2.2"/><path d="M6.5 8.2v7.6M8.7 6h4.8a2 2 0 0 1 2 2v.2"/>',
  sliders: '<path d="M4 7.5h9M17 7.5h3M4 16.5h4M12 16.5h8"/><circle cx="15" cy="7.5" r="2"/><circle cx="10" cy="16.5" r="2"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  gridView: '<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.6"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.6"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.6"/><rect x="13" y="13" width="7.5" height="7.5" rx="1.6"/>',
  box: '<path d="M12 3.2 4.6 7v9.6L12 20.8l7.4-4.2V7L12 3.2Z"/><path d="m4.6 7 7.4 4.2L19.4 7M12 11.2v9.6"/>',
  zap: '<path d="M13 3 5 13.5h5L10 21l8-10.5h-5L13 3Z"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.6"/><path d="M20 5v6h-6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  alert: '<path d="M12 4.5 21 19.5H3L12 4.5Z"/><path d="M12 10v4M12 16.5v.01"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  sun: '<circle cx="12" cy="12" r="3.6"/><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4m0-12.8L17 7M7 17l-1.4 1.4"/>',
  upload: '<path d="M12 16V4m0 0 4.5 4.5M12 4 7.5 8.5M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"/>',
  arrow: '<path d="M5 12h14m0 0-6-6m6 6-6 6"/>',
};

/**
 * @param {keyof ICONS} name
 * @param {number} [size]
 * @returns {HTMLElement}
 */
function icon(name, size = 16) {
  const wrap = document.createElement('span');
  wrap.style.display = 'inline-flex';
  wrap.style.flex = 'none';
  wrap.innerHTML =
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
    `stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`;
  return wrap;
}

/**
 * @param {number} value
 * @returns {string}
 */
function fmt(value) {
  const number = Number(value) || 0;
  if (Math.abs(number) < 1000) return String(Math.round(number));
  if (Math.abs(number) < 1_000_000) return `${(number / 1000).toFixed(number < 10_000 ? 1 : 0)}k`;
  return `${(number / 1_000_000).toFixed(1)}M`;
}

/* ------------------------------------------------------------------- state */

let state = null;
let view = 'dashboard';
let query = '';
let filter = 'all';
let sort = 'name';
let layout = 'grid';
let busy = false;
let paletteIndex = 0;
let paletteItems = [];
let undoTimer = null;

const VIEWS = [
  { id: 'dashboard', label: '概览', icon: 'grid' },
  { id: 'skills', label: '技能', icon: 'layers' },
  { id: 'sources', label: '来源', icon: 'folder' },
  { id: 'sync', label: '同步', icon: 'git' },
  { id: 'settings', label: '设置', icon: 'sliders' },
];

/* ------------------------------------------------------------------- fetch */

async function api(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = { ...(options.body ? { 'content-type': 'application/json' } : {}) };
  if (token) headers['x-skillhub-token'] = token;

  const response = await fetch(path, { ...options, headers: { ...headers, ...(options.headers ?? {}) } });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(json?.error ?? `HTTP ${response.status}`);
  return json;
}

async function load() {
  try {
    state = await api('/api/state');
    render();
  } catch (error) {
    el('content').replaceChildren(
      h('div', { class: 'empty' }, icon('alert', 30), h('h2', {}, '连不上服务'), h('p', {}, error.message)),
    );
  }
}

/* ------------------------------------------------------------------ render */

function render() {
  if (!state) return;

  el('version').textContent = `v${state.version ?? '0.0.0'}`;
  el('footPlatform').textContent = state.platform.split(' · ')[0];
  el('footHubPath').textContent = state.hubDir;
  el('footHub').title = `在文件管理器中打开 ${state.hubDir}`;

  renderNav();
  renderView();
}

function renderNav() {
  const counts = { skills: state.stats.count, sources: state.sources.length };
  el('nav').replaceChildren(
    ...VIEWS.map((item) =>
      h(
        'button',
        {
          class: `nav-item${item.id === view ? ' is-active' : ''}`,
          onclick: () => setView(item.id),
          'aria-current': item.id === view ? 'page' : null,
        },
        icon(item.icon, 16),
        h('span', {}, item.label),
        counts[item.id] !== undefined ? h('span', { class: 'nav-count' }, String(counts[item.id])) : null,
      ),
    ),
  );
}

/**
 * The view lives in the URL hash so a panel can be linked or bookmarked
 * (`#/skills`), and so a reload lands where you left off.
 *
 * @returns {string}
 */
function viewFromHash() {
  const id = String(location.hash ?? '').replace(/^#\/?/, '');
  return VIEWS.some((item) => item.id === id) ? id : 'dashboard';
}

/**
 * @param {string} next
 */
function setView(next) {
  view = next;
  query = '';
  const hash = `#/${next}`;
  if (location.hash !== hash) location.hash = hash;
  render();
  window.scrollTo?.({ top: 0 });
}

function renderView() {
  const content = el('content');
  if (!state) {
    content.replaceChildren(h('div', { class: 'skill-grid' }, ...Array.from({ length: 6 }, skeletonCard)));
    return;
  }

  const builders = {
    dashboard: viewDashboard,
    skills: viewSkills,
    sources: viewSources,
    sync: viewSync,
    settings: viewSettings,
  };
  content.replaceChildren(...[builders[view]?.() ?? viewDashboard()].flat(Infinity).filter(Boolean));
}

function skeletonCard() {
  return h(
    'div',
    { class: 'skeleton' },
    h('div', { class: 'sk-line w40' }),
    h('div', { class: 'sk-line w90' }),
    h('div', { class: 'sk-line w70' }),
  );
}

/* -------------------------------------------------------------- dashboard */

function viewDashboard() {
  const used = state.stats.visibleTokens;
  const budget = state.budget || 0;
  const ratio = budget > 0 ? used / budget : 0;
  const meterState = ratio >= 1 ? 'is-over' : ratio >= 0.8 ? 'is-warn' : '';

  return [
    h('div', { class: 'view-head' },
      h('div', {},
        h('h1', { class: 'view-title' }, '概览'),
        h('p', { class: 'view-sub' }, '一个技能中心，所有 AI 工具共用同一份 skill。'),
      ),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost sm', onclick: applyLinks }, icon('refresh', 14), '应用链接'),
        h('button', { class: 'btn ghost sm', onclick: putAllOnShelf }, '全部上架'),
      ),
    ),

    h('button', { class: 'path-chip', onclick: () => reveal(), title: '在文件管理器中打开总目录' },
      icon('folder', 14),
      h('span', { class: 'path-chip-text' }, state.hubDir),
      h('span', { class: 'path-chip-action' }, '打开目录'),
    ),

    h('div', { class: 'grid-kpi' },
      kpi('技能总数', String(state.stats.count), `${state.sources.length} 个来源`),
      kpi('已上架', String(state.stats.onShelf), `共 ${state.stats.count} 个，其余留在中心`),
      kpi('目录开销', `≈${fmt(used)}`, `每轮注入 · 全部技能需 ≈${fmt(state.stats.catalogTokens)}`),
      kpi('已接入工具', String(state.tools.length), state.tools.map((tool) => tool.label).join(' · ') || '未检测到'),
    ),

    h('div', { class: 'grid-2' },
      h('section', { class: 'card' },
        h('div', { class: 'card-head' },
          h('h2', { class: 'card-title' }, '目录预算'),
          h('span', { class: 'card-hint' }, `每轮请求注入 ${state.stats.onShelf} 个技能的名字和描述`),
        ),
        h('div', { class: 'card-body' },
          h('div', { class: 'budget-top' },
            h('strong', { class: 'budget-number' }, `≈${fmt(used)}`),
            h('span', { class: 'budget-of' }, `tokens / 预算 ${fmt(budget)}`),
            h('span', { class: `budget-delta${meterState === 'is-over' ? ' is-over' : meterState === 'is-warn' ? ' is-warn' : ''}` },
              ratio >= 1 ? `超出 ${fmt(used - budget)}` : `剩余 ${fmt(budget - used)}`,
            ),
          ),
          h('div', { class: 'meter', role: 'progressbar', 'aria-valuenow': Math.round(ratio * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 },
            h('div', { class: `meter-fill ${meterState}`, style: { width: `${Math.min(100, ratio * 100).toFixed(1)}%` } }),
          ),
          h('div', { class: 'meter-scale' },
            h('span', {}, '0'),
            h('span', {}, `${Math.round(ratio * 100)}%`),
            h('span', {}, fmt(budget)),
          ),
          h('div', { class: 'projection' },
            h('div', {}, h('span', {}, '每轮请求'), h('strong', {}, `≈${fmt(state.projection.perRequest)}`)),
            h('div', {}, h('span', {}, `每天 ${state.dailyRequests} 轮`), h('strong', {}, `≈${fmt(state.projection.perDay)}`)),
            h('div', {}, h('span', {}, '每月（30 天）'), h('strong', {}, `≈${fmt(state.projection.perMonth)}`)),
          ),
          h('p', { class: 'budget-note' },
            icon('zap', 14),
            `下架的 ${state.stats.count - state.stats.onShelf} 个技能每轮可省 ≈${fmt(state.savings)} tokens`,
            h('button', { class: 'btn ghost sm', onclick: () => setView('skills') }, '去管理', icon('arrow', 13)),
          ),
        ),
      ),

      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, '构成')),
        h('div', { class: 'card-body' }, donut(), tierLegend()),
      ),
    ),

    h('div', { class: 'grid-2' },
      h('section', { class: 'card' },
        h('div', { class: 'card-head' },
          h('h2', { class: 'card-title' }, '最贵的技能'),
          h('span', { class: 'card-hint' }, '按目录开销排序'),
        ),
        h('div', { class: 'card-body' }, spenders()),
      ),

      h('section', { class: 'card' },
        h('div', { class: 'card-head' },
          h('h2', { class: 'card-title' }, '工具接入'),
          h('span', { class: 'card-hint' }, `${state.tools.length} 个`),
        ),
        h('div', { class: 'card-body' }, toolsList()),
      ),
    ),

    syncPanel(),
  ];
}

/**
 * @param {string} label
 * @param {string} value
 * @param {string} hint
 */
function kpi(label, value, hint) {
  return h('div', { class: 'kpi' },
    h('span', { class: 'kpi-label' }, label),
    h('strong', { class: 'kpi-value' }, value),
    h('span', { class: 'kpi-hint' }, hint),
  );
}

function donut() {
  const visible = state.stats.visibleTokens;
  const total = Math.max(state.stats.catalogTokens, 1);
  const ratio = Math.min(1, visible / total);
  const circumference = 2 * Math.PI * 44;
  const dash = `${(ratio * circumference).toFixed(1)} ${circumference.toFixed(1)}`;

  return h('div', { class: 'donut-wrap' },
    h('div', { class: 'donut', html:
      `<svg viewBox="0 0 104 104" class="donut" style="transform:rotate(-90deg)">
        <circle class="track" cx="52" cy="52" r="44"></circle>
        <circle class="visible" cx="52" cy="52" r="44" stroke-dasharray="${dash}"></circle>
      </svg>`,
    }),
    h('div', { class: 'donut-center' },
      h('strong', {}, `${Math.round(ratio * 100)}%`),
      h('span', {}, '在目录中'),
    ),
    h('div', { class: 'legend' },
      h('div', { class: 'legend-row' }, h('span', { class: 'dot' }), '已上架', h('b', {}, `≈${fmt(visible)}`)),
      h('div', { class: 'legend-row' }, h('span', { class: 'dot off' }), '未上架', h('b', {}, `≈${fmt(state.stats.catalogTokens - visible)}`)),
      h('div', { class: 'legend-row muted' }, h('span', {}, `共 ${state.stats.count} 个技能`)),
    ),
  );
}

function tierLegend() {
  const max = Math.max(1, ...state.tiers.map((tier) => tier.count));
  return h('div', { class: 'legend mt-12', style: { gap: '6px' } },
    ...state.tiers.map((tier) =>
      h('div', { class: 'legend-row', title: tier.hint },
        h('span', { class: 'dot', style: { background: `var(--tier-${tier.id})` } }),
        h('span', {}, tier.label),
        h('span', { class: 'muted', style: { fontSize: '11px' } }, tier.hint),
        h('b', {}, String(tier.count)),
      ),
    ),
  );
}

function spenders() {
  if (!state.spenders.length) return h('p', { class: 'muted' }, '还没有技能');
  const max = Math.max(...state.spenders.map((item) => item.catalogTokens), 1);

  return h('div', { class: 'rank-list' },
    ...state.spenders.map((item) =>
      h('button', { class: 'rank-row', onclick: () => openDrawer(item.name), style: { '--tier-color': `var(--tier-${item.tier})` } },
        h('span', { class: 'rank-name' }, item.name),
        h('span', { class: 'rank-bar' }, h('span', { style: { width: `${Math.max(4, (item.catalogTokens / max) * 100)}%` } })),
        h('span', { class: 'rank-tokens' }, `≈${item.catalogTokens}`),
        h('span', { class: `rank-state${item.onShelf ? ' on' : ''}` }, item.onShelf ? '上架' : '下架'),
      ),
    ),
  );
}

function toolsList() {
  if (!state.tools.length) return h('p', { class: 'muted' }, '未检测到 AI 工具目录');
  return h('div', { class: 'tool-list' },
    ...state.tools.map((tool) =>
      h('div', { class: 'tool-row' },
        h('span', { class: `tool-status${tool.exists ? '' : ' is-off'}` }),
        h('div', { style: { minWidth: 0 } },
          h('div', { class: 'tool-name' }, tool.label),
          h('div', { class: 'tool-path', title: tool.path }, tool.path),
        ),
        h('span', { class: 'tool-count' }, `${tool.links} 链接`),
      ),
    ),
  );
}

/* ------------------------------------------------------------------- skills */

function filteredSkills() {
  const needle = query.toLowerCase();
  const rows = state.skills.filter((skill) => {
    if (filter === 'on' && !skill.onShelf) return false;
    if (filter === 'off' && skill.onShelf) return false;
    if (filter === 'slash' && !skill.disableModelInvocation) return false;
    if (!needle) return true;
    return `${skill.name} ${skill.description}`.toLowerCase().includes(needle);
  });

  const sorted = [...rows];
  if (sort === 'cost') sorted.sort((a, b) => b.catalogTokens - a.catalogTokens || a.name.localeCompare(b.name));
  else if (sort === 'updated') sorted.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  else sorted.sort((a, b) => a.name.localeCompare(b.name));
  return sorted;
}

function viewSkills() {
  const rows = filteredSkills();

  const toolbar = h('div', { class: 'toolbar' },
    h('div', { class: 'search' },
      icon('layers', 15),
      h('input', {
        id: 'search',
        type: 'search',
        placeholder: '搜索技能名或描述…',
        value: query,
        autocomplete: 'off',
        oninput: (event) => {
          query = event.target.value.trim().toLowerCase();
          renderView();
          const input = el('search');
          if (input) {
            input.focus();
            input.setSelectionRange?.(input.value.length, input.value.length);
          }
        },
      }),
    ),
    h('div', { class: 'segmented', id: 'filters' },
      ...['all', 'on', 'off', 'slash'].map((id) =>
        h('button', {
          class: `seg${filter === id ? ' is-active' : ''}`,
          dataset: { filter: id },
          onclick: () => {
            filter = id;
            renderView();
          },
        }, { all: '全部', on: '已上架', off: '未上架', slash: '斜杠命令' }[id]),
      ),
    ),
    h('select', {
      class: 'select',
      'aria-label': '排序',
      onchange: (event) => {
        sort = event.target.value;
        renderView();
      },
    },
      h('option', { value: 'name', selected: sort === 'name' }, '按名称'),
      h('option', { value: 'cost', selected: sort === 'cost' }, '按开销'),
      h('option', { value: 'updated', selected: sort === 'updated' }, '按更新时间'),
    ),
    h('div', { class: 'view-toggle' },
      h('button', {
        class: layout === 'grid' ? 'is-active' : '',
        title: '网格视图',
        onclick: () => {
          layout = 'grid';
          renderView();
        },
      }, icon('gridView', 15)),
      h('button', {
        class: layout === 'list' ? 'is-active' : '',
        title: '列表视图',
        onclick: () => {
          layout = 'list';
          renderView();
        },
      }, icon('list', 15)),
    ),
  );

  const body = rows.length === 0
    ? h('div', { class: 'empty' },
        icon('layers', 30),
        h('h2', {}, state.skills.length ? '没有匹配的技能' : '还没有技能'),
        h('p', {}, state.skills.length ? '换个关键词，或切换筛选条件。' : '从 GitHub 安装一个技能包，或把技能文件夹直接拖进窗口。'),
        h('button', { class: 'btn primary', onclick: () => el('installBtn').click() }, icon('plus', 14), '安装技能'),
      )
    : layout === 'list'
      ? skillsTable(rows)
      : h('div', { class: 'skill-grid' }, ...rows.map(skillCard));

  return [
    h('div', { class: 'view-head' },
      h('div', {},
        h('h1', { class: 'view-title' }, '技能'),
        h('p', { class: 'view-sub' }, `${rows.length} / ${state.skills.length} 个 · 目录开销 ≈${fmt(state.stats.visibleTokens)} tokens`),
      ),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost sm', onclick: applyLinks }, icon('refresh', 14), '应用链接'),
        h('button', { class: 'btn primary sm', onclick: () => el('installBtn').click() }, icon('plus', 14), '安装'),
      ),
    ),
    toolbar,
    body,
  ];
}

/**
 * @param {any} skill
 */
function skillCard(skill) {
  const toggle = h('label', { class: 'switch', title: skill.onShelf ? '下架（从模型目录移除）' : '上架（让所有 AI 工具看到）' },
    h('input', {
      type: 'checkbox',
      checked: skill.onShelf,
      'aria-label': `切换 ${skill.name}`,
      onclick: (event) => event.stopPropagation(),
      onchange: (event) => toggleSkill(skill.name, event.target.checked),
    }),
    h('span', {}),
  );

  return h('article', {
    class: `skill-card${skill.onShelf ? '' : ' is-off'}`,
    tabIndex: 0,
    style: { '--tier-color': `var(--tier-${skill.tier})` },
    onclick: () => openDrawer(skill.name),
    onkeydown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openDrawer(skill.name);
      }
    },
  },
    h('div', { class: 'skill-head' }, h('h3', { class: 'skill-name' }, skill.name), toggle),
    h('p', { class: `skill-desc${skill.description ? '' : ' is-missing'}` },
      skill.description || '（没有 description，模型无法判断何时使用）'),
    h('div', { class: 'skill-meta' },
      h('span', { class: 'chip tier' }, `≈${skill.catalogTokens} tok`),
      h('span', { class: 'chip' }, `${skill.files} 文件`),
      skill.disableModelInvocation ? h('span', { class: 'chip slash' }, '/命令') : null,
      skill.source ? h('span', { class: 'chip', title: skill.source }, skill.source) : null,
    ),
  );
}

/**
 * @param {any[]} rows
 */
function skillsTable(rows) {
  return h('table', { class: 'table' },
    h('thead', {},
      h('tr', {},
        h('th', {}, '技能'),
        h('th', {}, '描述'),
        h('th', { style: { textAlign: 'right' } }, '开销'),
        h('th', {}, '类型'),
        h('th', { class: 'cell-toggle' }, '上架'),
      ),
    ),
    h('tbody', {},
      ...rows.map((skill) =>
        h('tr', { onclick: () => openDrawer(skill.name) },
          h('td', { class: 'cell-name' }, skill.name),
          h('td', { class: 'cell-desc' }, skill.description || '—'),
          h('td', { class: 'cell-num' }, `≈${skill.catalogTokens}`),
          h('td', {},
            skill.disableModelInvocation
              ? h('span', { class: 'chip slash' }, '/命令')
              : h('span', { class: 'chip tier', style: { '--tier-color': `var(--tier-${skill.tier})` } }, `T${skill.catalogTokens}`),
          ),
          h('td', { class: 'cell-toggle' },
            h('label', { class: 'switch' },
              h('input', {
                type: 'checkbox',
                checked: skill.onShelf,
                'aria-label': `切换 ${skill.name}`,
                onclick: (event) => event.stopPropagation(),
                onchange: (event) => toggleSkill(skill.name, event.target.checked),
              }),
              h('span', {}),
            ),
          ),
        ),
      ),
    ),
  );
}

/* ------------------------------------------------------------------ sources */

function viewSources() {
  const sources = state.sources ?? [];

  return [
    h('div', { class: 'view-head' },
      h('div', {},
        h('h1', { class: 'view-title' }, '来源'),
        h('p', { class: 'view-sub' }, '记录每个技能来自哪个仓库，方便审计和更新。'),
      ),
    ),
    sources.length === 0
      ? h('div', { class: 'empty' },
          icon('folder', 30),
          h('h2', {}, '还没有记录来源'),
          h('p', {}, '通过「安装技能」从 GitHub 安装后，这里会自动记录仓库与安装时间。'),
          h('button', { class: 'btn primary', onclick: () => el('installBtn').click() }, icon('plus', 14), '安装技能'),
        )
      : h('div', { class: 'source-list' },
          ...sources.map((source) =>
            h('div', { class: 'source-row' },
              h('span', { class: 'source-icon' }, icon('git', 15)),
              h('div', { style: { minWidth: 0 } },
                h('div', { class: 'source-name' }, source.source),
                h('div', { class: 'source-meta' },
                  `${(source.skills ?? []).length} 个技能 · ${source.installedAt ? new Date(source.installedAt).toLocaleString() : '未知时间'}`),
              ),
              h('span', { class: 'source-count' }, (source.skills ?? []).slice(0, 2).join(', ')),
            ),
          ),
        ),
  ];
}

/* --------------------------------------------------------------------- sync */

function viewSync() {
  return [
    h('div', { class: 'view-head' },
      h('div', {},
        h('h1', { class: 'view-title' }, '同步'),
        h('p', { class: 'view-sub' }, '中心就是一个普通文件夹，用 git 同步到其它设备即可。'),
      ),
      h('div', { class: 'row' }, gitActionButton()),
    ),
    syncPanel(),
  ];
}

function gitActionButton() {
  const git = state.git ?? {};
  if (git.isRepo) return h('span', { class: 'badge ok' }, icon('check', 13), '已初始化');
  return h('button', { class: 'btn primary sm', onclick: initGit }, icon('git', 14), '初始化仓库');
}

function syncPanel() {
  const git = state.git ?? {};
  const repo = git.isRepo;

  const status = repo
    ? h('div', { class: 'status-line' },
        h('span', { class: 'badge ok' }, icon('check', 12), 'git 仓库'),
        h('span', { class: 'badge' }, git.branch ?? 'main'),
        git.remote ? h('span', { class: 'badge' }, git.remote) : h('span', { class: 'badge warn' }, '未配置 remote'),
        typeof git.dirty === 'number' && git.dirty > 0 ? h('span', { class: 'badge warn' }, `${git.dirty} 个未提交改动`) : null,
        typeof git.commits === 'number' ? h('span', { class: 'muted' }, `${git.commits} 个提交`) : null,
      )
    : h('div', { class: 'status-line' },
        h('span', { class: 'badge warn' }, icon('alert', 12), '未初始化'),
        h('span', { class: 'muted' }, git.gitAvailable ? '可以一键初始化' : '这台机器上没找到 git，可先手动执行下面的命令'),
      );

  const commands = repo
    ? [
        ['把改动推上去', 'git add -A && git commit -m "chore: sync skills" && git push'],
        ['在另一台设备上', 'git clone <repo> ~/.skillhub && cd ~/.skillhub && skillhub link'],
      ]
    : [
        ['初始化并提交', git.gitAvailable ? 'skillhub git init' : 'git init -b main && git add -A && git commit -m "chore: add skills"'],
        ['关联远端并推送', 'git remote add origin git@github.com:<you>/my-skills.git && git push -u origin main'],
        ['在另一台设备上', 'git clone <repo> ~/.skillhub && cd ~/.skillhub && skillhub link'],
      ];

  return h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title' }, '跨设备同步'),
      h('span', { class: 'card-hint' }, repo ? '已接入 git' : '尚未初始化'),
    ),
    h('div', { class: 'card-body' },
      status,
      h('div', { class: 'steps mt-12' },
        ...commands.map(([title, command], index) =>
          h('div', { class: 'step' },
            h('span', { class: 'step-num' }, String(index + 1)),
            h('div', { class: 'step-body' },
              h('p', { class: 'step-title' }, title),
              commandBlock(command),
            ),
          ),
        ),
      ),
      h('p', { class: 'budget-note' },
        icon('alert', 14),
        '链接里存的是绝对路径，换机器后必须跑一次 ',
        h('code', {}, 'skillhub link'),
        ' 重建链接。',
      ),
    ),
  );
}

/**
 * @param {string} command
 */
function commandBlock(command) {
  return h('div', { class: 'cmd' },
    command,
    h('button', {
      class: 'cmd-copy',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(command);
          toast('命令已复制');
        } catch {
          toast(command);
        }
      },
    }, '复制'),
  );
}

/* ----------------------------------------------------------------- settings */

function viewSettings() {
  const budgetInput = h('input', { type: 'number', id: 'budgetInput', min: '0', step: '100', value: String(state.budget) });
  const requestsInput = h('input', { type: 'number', id: 'requestsInput', min: '1', step: '10', value: String(state.dailyRequests) });

  return [
    h('div', { class: 'view-head' },
      h('div', {},
        h('h1', { class: 'view-title' }, '设置'),
        h('p', { class: 'view-sub' }, '偏好会写进中心的 skillhub.json，跟着 git 一起同步。'),
      ),
    ),

    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, '目录预算')),
      h('div', { class: 'card-body' },
        h('div', { class: 'field' },
          h('label', { for: 'budgetInput' }, '每轮允许的目录开销（tokens）'),
          budgetInput,
          h('p', {}, '超过这个值时概览会变黄/变红，提醒你下架技能或压缩描述。'),
        ),
        h('div', { class: 'field' },
          h('label', { for: 'requestsInput' }, '估算用的每日请求数'),
          requestsInput,
          h('p', {}, '只影响「每天/每月」的换算，不改变实际行为。'),
        ),
        h('button', {
          class: 'btn primary',
          onclick: async () => {
            try {
              state = await api('/api/preferences', {
                method: 'POST',
                body: JSON.stringify({
                  budget: Number(budgetInput.value) || null,
                  dailyRequests: Number(requestsInput.value) || null,
                }),
              });
              render();
              toast('偏好已保存');
            } catch (error) {
              toast(`保存失败：${error.message}`, true);
            }
          },
        }, '保存'),
      ),
    ),

    h('section', { class: 'card mt-12' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, '外观')),
      h('div', { class: 'card-body' },
        h('div', { class: 'segmented' },
          ...[['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(([id, label]) =>
            h('button', {
              class: `seg${(document.documentElement.dataset.theme ?? 'auto') === id ? ' is-active' : ''}`,
              onclick: () => {
                document.documentElement.dataset.theme = id;
                localStorage.setItem('skillhub.theme', id);
                renderView();
              },
            }, label),
          ),
        ),
      ),
    ),

    h('section', { class: 'card mt-12' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, '维护')),
      h('div', { class: 'card-body' },
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost', onclick: applyLinks }, icon('refresh', 14), '重新应用所有链接'),
          h('button', { class: 'btn ghost', onclick: putAllOnShelf }, '全部上架'),
          h('button', { class: 'btn ghost', onclick: takeAllOffShelf }, '全部下架'),
        ),
        h('p', { class: 'budget-note' }, '「应用链接」是幂等的：只补齐缺失的链接、移除多余的链接，从不覆盖真实文件夹。'),
      ),
    ),

    h('section', { class: 'card mt-12' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, '关于')),
      h('div', { class: 'card-body' },
        h('div', { class: 'status-line' },
          h('span', { class: 'badge' }, `v${state.version ?? '0.0.0'}`),
          h('span', { class: 'badge' }, state.platform),
          h('span', { class: 'badge' }, `${state.tools.length} 个工具`),
        ),
        h('p', { class: 'budget-note' }, h('code', {}, state.hubDir)),
        h('div', { class: 'row mt-12' },
          h('button', { class: 'btn ghost sm', onclick: () => reveal() }, icon('folder', 14), '打开总目录'),
          h('button', { class: 'btn ghost sm', onclick: () => copyText(state.hubDir) }, icon('copy', 14), '复制路径'),
        ),
      ),
    ),
  ];
}

/* ------------------------------------------------------------------ actions */

/**
 * @param {string} name
 * @param {boolean} on
 */
async function toggleSkill(name, on) {
  if (busy) return;
  busy = true;
  try {
    const action = on ? 'enable' : 'disable';
    state = await api(`/api/skills/${encodeURIComponent(name)}/${action}`, { method: 'POST' });
    render();
    showUndo(name, on);
  } catch (error) {
    toast(`操作失败：${error.message}`, true);
    await load();
  } finally {
    busy = false;
  }
}

/**
 * @param {string} name
 * @param {boolean} on
 */
function showUndo(name, on) {
  const message = on ? `已上架 ${name}` : `已下架 ${name}`;
  toast(message, false, {
    label: '撤销',
    run: async () => {
      try {
        state = await api(`/api/skills/${encodeURIComponent(name)}/${on ? 'disable' : 'enable'}`, { method: 'POST' });
        render();
        toast('已撤销');
      } catch (error) {
        toast(`撤销失败：${error.message}`, true);
      }
    },
  });
}

/**
 * @param {string} text
 */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`已复制：${text}`);
  } catch {
    toast(text);
  }
}

/**
 * Open the hub — or one skill folder — in the OS file manager.
 *
 * The server only does this for loopback clients; when the console is exposed on
 * the LAN it returns `opened: false` and we fall back to copying the path.
 *
 * @param {string | null} [skill]
 */
async function reveal(skill = null) {
  try {
    const result = await api('/api/reveal', { method: 'POST', body: JSON.stringify({ skill }) });
    if (result.opened) {
      toast(`已打开 ${result.path}`);
      return;
    }
    await copyText(result.path);
  } catch (error) {
    toast(`打不开：${error.message}`, true);
  }
}

async function applyLinks() {
  if (busy) return;
  busy = true;
  try {
    const result = await api('/api/link', { method: 'POST', body: JSON.stringify({}) });
    state = result.state ?? state;
    render();
    const failed = result.failed?.length ?? 0;
    toast(`链接已同步：新建 ${result.created}，移除 ${result.removed}${failed ? `，失败 ${failed}` : ''}`, failed > 0);
  } catch (error) {
    toast(`同步失败：${error.message}`, true);
  } finally {
    busy = false;
  }
}

async function putAllOnShelf() {
  if (busy) return;
  if (!confirm('把所有技能都上架？模型目录会变大，token 消耗也会上升。')) return;
  busy = true;
  try {
    state = await api('/api/shelf', { method: 'POST', body: JSON.stringify({ mode: 'all' }) });
    render();
    toast('全部技能已上架');
  } catch (error) {
    toast(`操作失败：${error.message}`, true);
  } finally {
    busy = false;
  }
}

async function takeAllOffShelf() {
  if (busy) return;
  if (!confirm('把所有技能都下架？链接会被移除，但技能仍留在中心。')) return;
  busy = true;
  try {
    state = await api('/api/shelf', { method: 'POST', body: JSON.stringify({ mode: 'none' }) });
    render();
    toast('全部技能已下架');
  } catch (error) {
    toast(`操作失败：${error.message}`, true);
  } finally {
    busy = false;
  }
}

async function initGit() {
  try {
    const result = await api('/api/git/init', { method: 'POST', body: JSON.stringify({}) });
    state = result.state ?? state;
    render();
    toast(result.ok ? '已初始化 git 仓库' : `没做成：${result.reason}`, !result.ok);
  } catch (error) {
    toast(`初始化失败：${error.message}`, true);
  }
}

/**
 * @param {string} source
 * @param {boolean} overwrite
 */
async function install(source, overwrite) {
  busy = true;
  el('installSubmit').disabled = true;
  toast(`正在安装 ${source}…`);
  try {
    const result = await api('/api/install', { method: 'POST', body: JSON.stringify({ source, overwrite }) });
    state = result.state ?? state;
    render();
    const added = result.installed.filter((item) => item.action === 'added').length;
    const updated = result.installed.filter((item) => item.action === 'updated').length;
    toast(`安装完成：新增 ${added}，更新 ${updated}`);
  } catch (error) {
    toast(`安装失败：${error.message}`, true);
  } finally {
    busy = false;
    el('installSubmit').disabled = false;
  }
}

/* ------------------------------------------------------------------- drawer */

let currentSkill = null;

async function openDrawer(name) {
  try {
    const skill = await api(`/api/skills/${encodeURIComponent(name)}`);
    currentSkill = skill;

    el('drawerName').textContent = skill.name;
    el('drawerDesc').textContent = skill.description || '（没有 description）';
    el('drawerBody').innerHTML = renderMarkdown(skill.markdown);

    const meta = state.skills.find((item) => item.name === name);
    el('drawerMeta').replaceChildren(
      ...(meta
        ? [
            h('span', { class: 'chip tier', style: { '--tier-color': `var(--tier-${meta.tier})` } }, `≈${meta.catalogTokens} tok 目录开销`),
            h('span', { class: 'chip' }, `正文 ≈${meta.bodyTokens} tok`),
            h('span', { class: 'chip' }, `${meta.files} 文件 · ${(meta.bytes / 1024).toFixed(1)} KB`),
            meta.disableModelInvocation ? h('span', { class: 'chip slash' }, '/命令 · 不进目录') : null,
            meta.source ? h('span', { class: 'chip' }, meta.source) : null,
          ]
        : []),
    );

    el('drawerMeta').append(
      h('button', {
        class: 'chip path',
        title: '在文件管理器中打开这个技能的目录',
        onclick: () => reveal(skill.name),
      }, skill.path),
    );

    el('drawerToggle').textContent = meta?.onShelf ? '下架' : '上架';
    el('drawerToggle').dataset.name = name;
    el('drawerToggle').dataset.on = String(Boolean(meta?.onShelf));

    el('drawer').classList.add('is-open');
    el('drawer').setAttribute('aria-hidden', 'false');
  } catch (error) {
    toast(`读取失败：${error.message}`, true);
  }
}

function closeDrawer() {
  el('drawer').classList.remove('is-open');
  el('drawer').setAttribute('aria-hidden', 'true');
  currentSkill = null;
}

async function deleteCurrent() {
  if (!currentSkill) return;
  if (!confirm(`从中心删除 ${currentSkill.name}？该技能的所有链接会一并移除。`)) return;
  try {
    state = await api(`/api/skills/${encodeURIComponent(currentSkill.name)}/remove`, { method: 'POST' });
    closeDrawer();
    render();
    toast('已删除');
  } catch (error) {
    toast(`删除失败：${error.message}`, true);
  }
}

/* ------------------------------------------------------------------- toast */

let toastTimer = null;

/**
 * @param {string} message
 * @param {boolean} [isError]
 * @param {{ label: string, run: () => void }} [action]
 */
function toast(message, isError = false, action = null) {
  const node = el('toast');
  node.textContent = '';
  node.append(h('span', {}, message));
  if (action) {
    node.append(h('button', {
      class: 'toast-action',
      onclick: () => {
        action.run();
        node.classList.remove('is-on');
      },
    }, action.label));
  }
  node.classList.toggle('is-error', Boolean(isError));
  node.classList.add('is-on');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('is-on'), action ? 7000 : isError ? 5200 : 2600);
}

/* --------------------------------------------------------------- palette */

/**
 * @returns {{ label: string, kind: string, hint?: string, run: () => void }[]}
 */
function paletteCommands() {
  const commands = [
    { label: '安装技能…', kind: '动作', run: () => el('installBtn').click() },
    { label: '应用链接', kind: '动作', run: applyLinks },
    { label: '全部上架', kind: '动作', run: putAllOnShelf },
    { label: '全部下架', kind: '动作', run: takeAllOffShelf },
    { label: '打开概览', kind: '跳转', run: () => setView('dashboard') },
    { label: '打开技能列表', kind: '跳转', run: () => setView('skills') },
    { label: '打开同步设置', kind: '跳转', run: () => setView('sync') },
    { label: '打开设置', kind: '跳转', run: () => setView('settings') },
    { label: '切换主题', kind: '动作', run: () => el('themeBtn').click() },
  ];

  const skills = state
    ? state.skills.map((skill) => ({
        label: skill.name,
        kind: skill.onShelf ? '已上架' : '未上架',
        hint: skill.description,
        run: () => openDrawer(skill.name),
      }))
    : [];

  return [...commands, ...skills];
}

function openPalette() {
  el('palette').hidden = false;
  const input = el('paletteInput');
  input.value = '';
  paletteIndex = 0;
  renderPalette('');
  setTimeout(() => input.focus(), 20);
}

function closePalette() {
  el('palette').hidden = true;
}

/**
 * @param {string} needle
 */
function renderPalette(needle) {
  const all = paletteCommands();
  const lower = needle.trim().toLowerCase();
  paletteItems = lower
    ? all.filter((item) => `${item.label} ${item.hint ?? ''}`.toLowerCase().includes(lower)).slice(0, 40)
    : all.slice(0, 40);

  paletteIndex = Math.min(paletteIndex, Math.max(0, paletteItems.length - 1));
  const list = el('paletteList');

  if (!paletteItems.length) {
    list.replaceChildren(h('div', { class: 'palette-empty' }, '没有匹配项'));
    return;
  }

  list.replaceChildren(
    ...paletteItems.map((item, index) =>
      h('button', {
        class: `palette-item${index === paletteIndex ? ' is-active' : ''}`,
        onmouseenter: () => {
          paletteIndex = index;
          renderPalette(el('paletteInput').value);
        },
        onclick: () => {
          closePalette();
          item.run();
        },
      },
        h('span', {}, item.label),
        item.hint ? h('span', { class: 'p-desc' }, item.hint) : null,
        h('span', { class: 'p-kind' }, item.kind),
      ),
    ),
  );
}

/* ------------------------------------------------------------- drag & drop */

let dragDepth = 0;

/**
 * @param {DataTransferItemList} items
 * @returns {Promise<{ file: File, path: string }[]>}
 */
async function collectDroppedFiles(items) {
  /** @type {{ file: File, path: string }[]} */
  const out = [];

  /**
   * @param {any} entry
   * @param {string} prefix
   */
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      out.push({ file, path: prefix + entry.name });
      return;
    }
    if (!entry.isDirectory) return;

    const reader = entry.createReader();
    // readEntries returns at most 100 entries per call.
    for (;;) {
      const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
    }
  };

  for (const item of items) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) await walk(entry, '');
  }
  return out;
}

/**
 * @param {{ file: File, path: string }[]} files
 */
async function uploadDropped(files) {
  if (!files.length) return;
  const form = new FormData();
  for (const item of files) form.append('files', item.file, item.path);
  form.append('overwrite', 'false');

  toast(`正在导入 ${files.length} 个文件…`);
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const response = await fetch('/api/import', {
      method: 'POST',
      body: form,
      headers: token ? { 'x-skillhub-token': token } : {},
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json?.error ?? `HTTP ${response.status}`);
    state = json.state ?? state;
    render();
    const names = (json.installed ?? []).map((item) => item.name).join(', ');
    toast(names ? `已导入：${names}` : '没有找到 SKILL.md');
  } catch (error) {
    toast(`导入失败：${error.message}`, true);
  }
}

/* ------------------------------------------------------------------ wiring */

el('cmdkTrigger').addEventListener('click', openPalette);
el('footHub').addEventListener('click', () => reveal());
el('themeBtn').addEventListener('click', () => {
  const root = document.documentElement;
  const order = ['auto', 'light', 'dark'];
  const next = order[(order.indexOf(root.dataset.theme ?? 'auto') + 1) % order.length];
  root.dataset.theme = next;
  localStorage.setItem('skillhub.theme', next);
  toast(`主题：${next === 'auto' ? '跟随系统' : next === 'light' ? '浅色' : '深色'}`);
  if (view === 'settings') renderView();
});

el('installBtn').addEventListener('click', () => {
  el('installInput').value = '';
  el('installModal').showModal();
  setTimeout(() => el('installInput').focus(), 30);
});

el('installForm').addEventListener('submit', (event) => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  const source = el('installInput').value.trim();
  if (!source) {
    el('installInput').focus();
    return;
  }
  el('installModal').close();
  install(source, el('installOverwrite').checked);
});

el('drawerClose').addEventListener('click', closeDrawer);
el('drawerToggle').addEventListener('click', async () => {
  const name = el('drawerToggle').dataset.name;
  const on = el('drawerToggle').dataset.on === 'true';
  if (!name) return;
  await toggleSkill(name, !on);
  await openDrawer(name);
});
el('drawerCopy').addEventListener('click', async () => {
  if (!currentSkill) return;
  await copyText(currentSkill.path);
});
el('drawerDelete').addEventListener('click', deleteCurrent);

el('paletteInput').addEventListener('input', (event) => {
  paletteIndex = 0;
  renderPalette(event.target.value);
});

el('paletteInput').addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    paletteIndex = Math.min(paletteIndex + 1, paletteItems.length - 1);
    renderPalette(el('paletteInput').value);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    paletteIndex = Math.max(paletteIndex - 1, 0);
    renderPalette(el('paletteInput').value);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const item = paletteItems[paletteIndex];
    if (item) {
      closePalette();
      item.run();
    }
  }
});

el('palette').addEventListener('click', (event) => {
  if (event.target === el('palette')) closePalette();
});

document.addEventListener('keydown', (event) => {
  const meta = event.metaKey || event.ctrlKey;
  if (meta && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (el('palette').hidden) openPalette();
    else closePalette();
    return;
  }
  if (event.key === 'Escape') {
    if (!el('palette').hidden) closePalette();
    else closeDrawer();
    return;
  }
  if (event.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
    event.preventDefault();
    if (view !== 'skills') setView('skills');
    setTimeout(() => el('search')?.focus(), 0);
  }
});

// drag & drop of a skill folder anywhere on the page
window.addEventListener('dragenter', (event) => {
  if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
  dragDepth += 1;
  el('dropzone').hidden = false;
});
window.addEventListener('dragover', (event) => {
  if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
  event.preventDefault();
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) el('dropzone').hidden = true;
});
window.addEventListener('drop', async (event) => {
  if (!event.dataTransfer) return;
  event.preventDefault();
  dragDepth = 0;
  el('dropzone').hidden = true;
  const files = await collectDroppedFiles(event.dataTransfer.items);
  await uploadDropped(files);
});

const savedTheme = localStorage.getItem('skillhub.theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;

view = viewFromHash();

window.addEventListener('hashchange', () => {
  const next = viewFromHash();
  if (next !== view) {
    view = next;
    render();
  }
});

load();
