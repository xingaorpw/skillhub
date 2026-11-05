/**
 * SkillHub console — plain ES modules, no build step.
 *
 * The server is the single source of truth: every mutation returns the whole
 * new state, and the view is a pure function of that state. No client-side
 * cache to go stale.
 */

import { renderMarkdown } from './markdown.js';

const el = (id) => document.getElementById(id);
const TOKEN_KEY = 'skillhub.token';

/** @type {any} */
let state = null;
let filter = 'all';
let query = '';
let busy = false;

// A token is only needed when the console is bound to a non-loopback address.
const urlToken = new URLSearchParams(location.search).get('token');
if (urlToken) {
  localStorage.setItem(TOKEN_KEY, urlToken);
  history.replaceState(null, '', location.pathname);
}

// ------------------------------------------------------------------- network

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
    toast(`加载失败：${error.message}`, true);
  }
}

// --------------------------------------------------------------------- render

function render() {
  if (!state) return;

  const shelf = state.shelf;
  const onShelf = (name) => shelf === null || shelf.includes(name);

  el('hubPath').textContent = state.hubDir;
  el('version').textContent = state.skills.length ? `v0.1.0 · ${state.platform.split(' · ')[0]}` : 'v0.1.0';

  el('statTotal').textContent = state.stats.count;
  el('statShelf').textContent = `${state.stats.onShelf}/${state.stats.count}`;
  el('statTokens').textContent = `≈${formatTokens(state.stats.visibleTokens)}`;
  el('statTokensHint').textContent =
    shelf === null ? '全部上架' : `未上架技能再省 ≈${formatTokens(state.stats.catalogTokens - state.stats.visibleTokens)}`;
  el('statTools').textContent = state.tools.length;
  el('statToolsHint').textContent = state.tools.map((tool) => tool.label).join(' · ') || '未检测到工具';

  el('footInfo').textContent = `${state.stats.count} 个技能 · ${state.stats.onShelf} 个可见 · ≈${formatTokens(state.stats.visibleTokens)} tokens`;

  const grid = el('grid');
  const visible = state.skills.filter((skill) => {
    if (filter === 'on' && !onShelf(skill.name)) return false;
    if (filter === 'off' && onShelf(skill.name)) return false;
    if (filter === 'slash' && !skill.disableModelInvocation) return false;
    if (!query) return true;
    const haystack = `${skill.name} ${skill.description}`.toLowerCase();
    return haystack.includes(query);
  });

  grid.textContent = '';
  const fragment = document.createDocumentFragment();
  for (const skill of visible) fragment.append(card(skill, onShelf(skill.name)));
  grid.append(fragment);

  const isEmpty = state.skills.length === 0;
  el('empty').hidden = !isEmpty;
  grid.hidden = isEmpty;

  el('linkBtn').disabled = busy;
  el('allBtn').disabled = busy || shelf === null;
}

/**
 * @param {any} skill
 * @param {boolean} on
 */
function card(skill, on) {
  const article = document.createElement('article');
  article.className = `card${on ? '' : ' is-off'}`;
  article.tabIndex = 0;
  article.setAttribute('role', 'button');
  article.setAttribute('aria-label', `${skill.name}：${on ? '已上架' : '未上架'}，点击查看详情`);

  const head = document.createElement('div');
  head.className = 'card-head';

  const title = document.createElement('h3');
  title.className = 'card-name';
  title.textContent = skill.name;

  const toggle = document.createElement('label');
  toggle.className = 'switch';
  toggle.title = on ? '下架（从模型目录中移除）' : '上架（让所有 AI 工具看到）';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = on;
  input.setAttribute('aria-label', `切换 ${skill.name}`);
  input.addEventListener('click', (event) => event.stopPropagation());
  input.addEventListener('change', () => toggleSkill(skill.name, input.checked, input));
  const track = document.createElement('span');
  toggle.append(input, track);

  head.append(title, toggle);

  const desc = document.createElement('p');
  desc.className = 'card-desc';
  desc.textContent = skill.description || '（没有 description，模型无法判断何时使用）';
  if (!skill.description) desc.style.color = 'var(--warn)';

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  meta.append(chip(`≈${skill.catalogTokens} tok`));
  meta.append(chip(`${skill.files} 文件`));
  if (skill.disableModelInvocation) meta.append(chip('/命令', 'slash'));
  if (skill.source) meta.append(chip(skill.source, 'src'));

  article.append(head, desc, meta);
  article.addEventListener('click', () => openDrawer(skill.name));
  article.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openDrawer(skill.name);
    }
  });
  return article;
}

/**
 * @param {string} text
 * @param {string} [kind]
 */
function chip(text, kind = '') {
  const span = document.createElement('span');
  span.className = `chip ${kind}`.trim();
  span.textContent = text;
  span.title = text;
  return span;
}

// ------------------------------------------------------------------ mutations

/**
 * @param {string} name
 * @param {boolean} on
 * @param {HTMLInputElement} [input]
 */
async function toggleSkill(name, on, input) {
  if (busy) return;
  busy = true;
  if (input) input.disabled = true;
  try {
    const action = on ? 'enable' : 'disable';
    state = await api(`/api/skills/${encodeURIComponent(name)}/${action}`, { method: 'POST' });
    render();
    toast(`${on ? '已上架' : '已下架'} ${name}`, false);
  } catch (error) {
    toast(`操作失败：${error.message}`, true);
    if (input) input.checked = !on;
  } finally {
    busy = false;
    if (input) input.disabled = false;
    render();
  }
}

async function applyLinks() {
  if (busy) return;
  busy = true;
  render();
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
    render();
  }
}

async function putAllOnShelf() {
  if (busy) return;
  if (!confirm('把所有技能都上架？模型目录会变大，token 消耗也会上升。')) return;
  busy = true;
  render();
  try {
    state = await api('/api/shelf', { method: 'POST', body: JSON.stringify({ mode: 'all' }) });
    render();
    toast('全部技能已上架', false);
  } catch (error) {
    toast(`操作失败：${error.message}`, true);
  } finally {
    busy = false;
    render();
  }
}

/**
 * @param {string} source
 * @param {boolean} overwrite
 */
async function install(source, overwrite) {
  busy = true;
  el('installSubmit').disabled = true;
  toast(`正在安装 ${source}…`, false);
  try {
    const result = await api('/api/install', {
      method: 'POST',
      body: JSON.stringify({ source, overwrite }),
    });
    state = result.state ?? state;
    render();
    const added = result.installed.filter((item) => item.action === 'added').length;
    const updated = result.installed.filter((item) => item.action === 'updated').length;
    toast(`安装完成：新增 ${added}，更新 ${updated}`, false);
  } catch (error) {
    toast(`安装失败：${error.message}`, true);
  } finally {
    busy = false;
    el('installSubmit').disabled = false;
    render();
  }
}

// --------------------------------------------------------------------- drawer

let currentSkill = null;

async function openDrawer(name) {
  try {
    const skill = await api(`/api/skills/${encodeURIComponent(name)}`);
    currentSkill = skill;
    el('drawerName').textContent = skill.name;
    el('drawerDesc').textContent = skill.description || '（没有 description）';
    el('drawerBody').innerHTML = renderMarkdown(skill.markdown);
    el('drawerMeta').textContent = '';

    const meta = state.skills.find((item) => item.name === name);
    if (meta) {
      el('drawerMeta').append(
        chip(`≈${meta.catalogTokens} tok 目录开销`),
        chip(`${meta.files} 文件`),
        chip(`${(meta.bytes / 1024).toFixed(1)} KB`),
      );
      if (meta.disableModelInvocation) el('drawerMeta').append(chip('/命令 · 不进目录', 'slash'));
      if (meta.source) el('drawerMeta').append(chip(meta.source, 'src'));
    }

    const on = state.shelf === null || state.shelf.includes(name);
    el('drawerToggle').textContent = on ? '下架' : '上架';
    el('drawerToggle').dataset.on = String(on);
    el('drawerToggle').dataset.name = name;

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
    toast('已删除', false);
  } catch (error) {
    toast(`删除失败：${error.message}`, true);
  }
}

// --------------------------------------------------------------------- toast

let toastTimer = null;

/**
 * @param {string} message
 * @param {boolean} isError
 */
function toast(message, isError) {
  const node = el('toast');
  node.textContent = message;
  node.classList.toggle('is-error', Boolean(isError));
  node.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('is-on'), isError ? 5200 : 2600);
}

/**
 * @param {number} value
 * @returns {string}
 */
function formatTokens(value) {
  if (value < 1000) return String(Math.round(value));
  return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}k`;
}

// --------------------------------------------------------------------- wiring

el('search').addEventListener('input', (event) => {
  query = event.target.value.trim().toLowerCase();
  render();
});

el('filters').addEventListener('click', (event) => {
  const button = event.target.closest('.seg');
  if (!button) return;
  filter = button.dataset.filter;
  for (const node of el('filters').querySelectorAll('.seg')) node.classList.toggle('is-active', node === button);
  render();
});

el('linkBtn').addEventListener('click', applyLinks);
el('allBtn').addEventListener('click', putAllOnShelf);
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
  try {
    await navigator.clipboard.writeText(currentSkill.path);
    toast('路径已复制', false);
  } catch {
    toast(currentSkill.path, false);
  }
});

el('drawerDelete').addEventListener('click', deleteCurrent);

el('installBtn').addEventListener('click', () => {
  el('installInput').value = '';
  el('installModal').showModal();
  setTimeout(() => el('installInput').focus(), 30);
});

el('emptyInstall').addEventListener('click', () => el('installBtn').click());

el('installForm').addEventListener('submit', (event) => {
  if (event.submitter?.value === 'cancel') return; // dialog closes itself
  event.preventDefault();
  const source = el('installInput').value.trim();
  if (!source) {
    el('installInput').focus();
    return;
  }
  el('installModal').close();
  install(source, el('installOverwrite').checked);
});

el('themeBtn').addEventListener('click', () => {
  const root = document.documentElement;
  const order = ['auto', 'light', 'dark'];
  const next = order[(order.indexOf(root.dataset.theme ?? 'auto') + 1) % order.length];
  root.dataset.theme = next;
  localStorage.setItem('skillhub.theme', next);
  toast(`主题：${next === 'auto' ? '跟随系统' : next === 'light' ? '浅色' : '深色'}`, false);
});

const savedTheme = localStorage.getItem('skillhub.theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeDrawer();
  if (event.key === '/' && document.activeElement?.tagName !== 'INPUT') {
    event.preventDefault();
    el('search').focus();
  }
});

load();
