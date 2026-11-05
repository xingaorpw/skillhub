/**
 * Executes the real `web/app.js` against a minimal DOM shim.
 *
 * There is no browser in CI, but "the console throws on first render" is exactly
 * the bug that only shows up there. This test imports the shipped module — not a
 * copy — so a typo in a DOM API or a broken view fails the build.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

/* ------------------------------------------------------------------- DOM */

class ClassList {
  constructor() {
    this.set = new Set();
  }
  add(...names) {
    for (const name of names) this.set.add(name);
  }
  remove(...names) {
    for (const name of names) this.set.delete(name);
  }
  toggle(name, force) {
    const on = force ?? !this.set.has(name);
    if (on) this.set.add(name);
    else this.set.delete(name);
    return on;
  }
  contains(name) {
    return this.set.has(name);
  }
}

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.classList = new ClassList();
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.listeners = {};
    this._text = '';
    this._html = '';
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = '';
    this.tabIndex = 0;
    this.isFragment = false;
    this.title = '';
  }

  get className() {
    return [...this.classList.set].join(' ');
  }

  set className(value) {
    this.classList.set = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  get id() {
    return this._id ?? '';
  }

  set id(value) {
    this._id = String(value);
    globalThis.document?.registry?.set(this._id, this);
  }

  get textContent() {
    if (this.children.length === 0) return this._text;
    return this._text + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this._text = String(value);
    this.children.length = 0;
  }

  get innerHTML() {
    return this._html;
  }

  set innerHTML(value) {
    this._html = String(value);
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node?.isFragment) {
        for (const child of node.children) {
          child.parent = this;
          this.children.push(child);
        }
      } else if (typeof node === 'string' || typeof node === 'number') {
        const text = new Text(String(node));
        text.parent = this;
        this.children.push(text);
      } else if (node) {
        node.parent = this;
        this.children.push(node);
      }
    }
  }

  appendChild(node) {
    this.append(node);
    return node;
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._text = '';
    this.append(...nodes);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  addEventListener(type, handler) {
    (this.listeners[type] ??= []).push(handler);
  }

  dispatch(type, event = {}) {
    for (const handler of this.listeners[type] ?? []) handler({ target: this, ...event });
  }

  focus() {}
  blur() {}
  setSelectionRange() {}
  scrollTo() {}

  click() {
    this.dispatch('click', { target: this });
  }

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
  }

  descendants() {
    const out = [];
    for (const child of this.children) {
      if (child instanceof Element) {
        out.push(child, ...child.descendants());
      }
    }
    return out;
  }

  matches(selector) {
    for (const raw of selector.split(',')) {
      if (this.matchesComplex(raw.trim())) return true;
    }
    return false;
  }

  /** Supports `a b` (descendant) on top of compound selectors. */
  matchesComplex(selector) {
    const parts = selector.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return false;
    if (!this.matchesSimple(parts[parts.length - 1])) return false;

    let node = this.parent;
    for (let index = parts.length - 2; index >= 0; index -= 1) {
      while (node && !node.matchesSimple?.(parts[index])) node = node.parent;
      if (!node) return false;
      node = node.parent;
    }
    return true;
  }

  matchesSimple(part) {
    const tag = /^[a-zA-Z][\w-]*/.exec(part);
    if (tag && this.tagName !== tag[0].toUpperCase()) return false;

    const id = /#([\w-]+)/.exec(part);
    if (id && this.id !== id[1]) return false;

    const classes = [...part.matchAll(/\.([\w-]+)/g)].map((match) => match[1]);
    if (classes.length && !classes.every((name) => this.classList.contains(name))) return false;

    for (const [, name, value] of part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      const actual = name.startsWith('data-') ? this.dataset[name.slice(5)] : this.attributes[name];
      if (value === undefined ? actual === undefined : String(actual) !== value) return false;
    }
    return true;
  }

  querySelectorAll(selector) {
    return this.descendants().filter((node) => node.matches(selector));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches?.(selector)) return node;
      node = node.parent;
    }
    return null;
  }
}

class Text extends Element {
  constructor(value) {
    super('#text');
    this._text = value;
  }
}

function installDom(state) {
  const registry = new Map();

  const document = {
    documentElement: new Element('html'),
    activeElement: { tagName: 'BODY' },
    getElementById(id) {
      if (!registry.has(id)) {
        const node = new Element(id.toLowerCase().includes('modal') ? 'dialog' : 'div');
        node.id = id;
        registry.set(id, node);
      }
      return registry.get(id);
    },
    createElement: (tag) => new Element(tag),
    createDocumentFragment: () => {
      const fragment = new Element('#fragment');
      fragment.isFragment = true;
      return fragment;
    },
    addEventListener(type, handler) {
      (this.listeners ??= {});
      (this.listeners[type] ??= []).push(handler);
    },
    dispatch(type, event = {}) {
      for (const handler of this.listeners?.[type] ?? []) handler({ target: this, ...event });
    },
    listeners: {},
    registry,
  };

  const window = {
    listeners: {},
    addEventListener(type, handler) {
      (this.listeners[type] ??= []).push(handler);
    },
    scrollTo() {},
    dispatch(type, event = {}) {
      for (const handler of this.listeners[type] ?? []) handler({ target: this, ...event });
    },
  };

  globalThis.document = document;
  globalThis.window = window;
  globalThis.location = { search: '', pathname: '/' };
  globalThis.history = { replaceState() {} };
  globalThis.localStorage = {
    store: new Map(),
    getItem(key) {
      return this.store.get(key) ?? null;
    },
    setItem(key, value) {
      this.store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async () => {} } },
    configurable: true,
    writable: true,
  });
  globalThis.confirm = () => true;
  globalThis.fetch = makeFetch(state);

  return { document, window };
}

function makeFetch(initial) {
  const current = structuredClone(initial);

  return async (url, options = {}) => {
    const path = String(url);

    if (path.endsWith('/api/state')) return jsonResponse(current);

    const toggle = /\/api\/skills\/([^/]+)\/(enable|disable)/.exec(path);
    if (toggle && options.method === 'POST') {
      const name = decodeURIComponent(toggle[1]);
      const on = toggle[2] === 'enable';
      const skill = current.skills.find((item) => item.name === name);
      if (skill) skill.onShelf = on;
      const visible = current.skills.filter((item) => item.onShelf);
      current.stats.onShelf = visible.length;
      current.stats.visibleTokens = visible.reduce((sum, item) => sum + item.catalogTokens, 0);
      current.projection = { perRequest: current.stats.visibleTokens, perDay: current.stats.visibleTokens * 100, perMonth: 0 };
      return jsonResponse(current);
    }

    if (path.endsWith('/api/link')) return jsonResponse({ created: 0, removed: 0, failed: [], state: current });
    if (path.endsWith('/api/reveal')) {
      const body = options.body ? JSON.parse(options.body) : {};
      const target = body.skill ? `${current.hubDir}/${body.skill}` : current.hubDir;
      return jsonResponse({ path: target, opened: false });
    }
    if (path.endsWith('/api/preferences')) return jsonResponse(current);
    if (path.endsWith('/api/git/init')) return jsonResponse({ ok: true, state: current, next: [] });

    return jsonResponse({});
  };
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  };
}

function fixture() {
  return {
    hubDir: '/home/u/.skillhub',
    exists: true,
    platform: 'linux x64 · node v22.0.0',
    version: '0.2.0',
    shelf: ['alpha'],
    stats: { count: 2, onShelf: 1, catalogTokens: 60, visibleTokens: 30 },
    budget: 2000,
    dailyRequests: 100,
    projection: { perRequest: 30, perDay: 3000, perMonth: 90000 },
    savings: 30,
    spenders: [
      { name: 'beta', catalogTokens: 30, tier: 'normal', onShelf: false },
      { name: 'alpha', catalogTokens: 30, tier: 'normal', onShelf: true },
    ],
    tiers: [
      { id: 'light', label: '轻', hint: '几乎不占预算', count: 0 },
      { id: 'normal', label: '中', hint: '正常水平', count: 2 },
      { id: 'heavy', label: '重', hint: '描述偏长，值得压缩', count: 0 },
      { id: 'extreme', label: '极重', hint: '单条就吃掉可观预算', count: 0 },
    ],
    git: { isRepo: false, gitAvailable: false, branch: null, remote: null, dirty: null, commits: null },
    tools: [{ id: 'dsh', label: 'DeepSeek Harness', path: '/home/u/.dsh/skills', exists: true, links: 1 }],
    skills: [
      {
        name: 'alpha',
        description: 'Alpha skill',
        disableModelInvocation: false,
        files: 2,
        bytes: 1024,
        catalogTokens: 30,
        bodyTokens: 40,
        tier: 'normal',
        onShelf: true,
        updatedAt: new Date(0).toISOString(),
        source: null,
      },
      {
        name: 'beta',
        description: 'Beta skill',
        disableModelInvocation: true,
        files: 1,
        bytes: 512,
        catalogTokens: 30,
        bodyTokens: 20,
        tier: 'normal',
        onShelf: false,
        updatedAt: new Date(0).toISOString(),
        source: 'owner/repo',
      },
    ],
    sources: [{ source: 'owner/repo', skills: ['beta'], installedAt: new Date(0).toISOString() }],
  };
}

async function boot(tag) {
  const { document, window } = installDom(fixture());
  await import(`../web/app.js?test=${tag}`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { document, window };
}

/* ----------------------------------------------------------------- tests */

test('dashboard renders KPI cards and the budget meter', async () => {
  const { document } = await boot('dashboard');
  const content = document.getElementById('content');

  assert.equal(content.querySelectorAll('.kpi').length, 4);
  assert.match(content.querySelector('.budget-number').textContent, /^≈/);
  assert.match(content.querySelector('.meter-fill').style.width, /%$/);
  assert.equal(content.querySelectorAll('.rank-row').length, 2);
  assert.equal(content.querySelectorAll('.tool-row').length, 1);
  assert.equal(content.querySelectorAll('.index-chip').length, 2, 'every skill must be listed on the dashboard');
  assert.equal(content.querySelectorAll('.index-chip.is-off').length, 1);
  assert.match(document.getElementById('footHubPath').textContent, /skillhub$/);
});

test('the hub folder is visible and clickable from the sidebar', async () => {
  const { document } = await boot('hub-path');
  assert.equal(document.getElementById('footHubPath').textContent, '/home/u/.skillhub');

  document.getElementById('footHub').dispatch('click', { target: document.getElementById('footHub') });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.match(document.getElementById('toast').textContent, /\.skillhub/);
});

test('the sidebar lists every view with a skill count', async () => {
  const { document } = await boot('nav');
  const items = document.getElementById('nav').querySelectorAll('.nav-item');
  assert.equal(items.length, 5);
  assert.equal(items[0].classList.contains('is-active'), true);
  assert.equal(document.getElementById('nav').querySelectorAll('.nav-count')[0].textContent, '2');
});

test('switching to the skills view renders cards from state', async () => {
  const { document } = await boot('skills');
  document.getElementById('nav').querySelectorAll('.nav-item')[1].click();

  const content = document.getElementById('content');
  const cards = content.querySelectorAll('.skill-card');
  assert.equal(cards.length, 2);
  assert.equal(cards[1].classList.contains('is-off'), true);
  assert.equal(content.querySelectorAll('.chip.slash').length, 1);
});

test('search filters the skill grid', async () => {
  const { document } = await boot('search');
  document.getElementById('nav').querySelectorAll('.nav-item')[1].click();

  const input = document.getElementById('search');
  input.value = 'beta';
  input.dispatch('input', { target: input });

  const cards = document.getElementById('content').querySelectorAll('.skill-card');
  assert.equal(cards.length, 1);
  assert.match(cards[0].querySelector('.skill-name').textContent, /beta/);
});

test('the slash filter only keeps model-invisible skills', async () => {
  const { document } = await boot('slash');
  document.getElementById('nav').querySelectorAll('.nav-item')[1].click();

  const slash = document.getElementById('filters').querySelectorAll('.seg')[3];
  slash.click();

  const cards = document.getElementById('content').querySelectorAll('.skill-card');
  assert.equal(cards.length, 1);
  assert.match(cards[0].querySelector('.skill-name').textContent, /beta/);
});

test('the list layout renders a table with toggles', async () => {
  const { document } = await boot('table');
  document.getElementById('nav').querySelectorAll('.nav-item')[1].click();

  const toggle = document.getElementById('content').querySelectorAll('.view-toggle button')[1];
  toggle.click();

  const rows = document.getElementById('content').querySelectorAll('tbody tr');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelectorAll('.switch').length, 1);
});

test('toggling a skill posts to the API and re-renders', async () => {
  const { document } = await boot('toggle');
  document.getElementById('nav').querySelectorAll('.nav-item')[1].click();

  const firstSwitch = document.getElementById('content').querySelectorAll('.switch input')[0];
  firstSwitch.checked = false;
  firstSwitch.dispatch('change', { target: firstSwitch });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const cards = document.getElementById('content').querySelectorAll('.skill-card');
  assert.equal(cards[0].classList.contains('is-off'), true);
  assert.equal(document.getElementById('toast').classList.contains('is-on'), true);
});

test('the command palette opens with Ctrl+K and lists skills', async () => {
  const { document } = await boot('palette');
  document.getElementById('palette').hidden = true; // mirrors the `hidden` attribute in index.html

  document.dispatch('keydown', { key: 'k', ctrlKey: true, preventDefault() {} });
  assert.equal(document.getElementById('palette').hidden, false);

  const items = document.getElementById('paletteList').querySelectorAll('.palette-item');
  assert.ok(items.length >= 9, `expected commands + skills, got ${items.length}`);
});

test('the settings view exposes the budget and requests fields', async () => {
  const { document } = await boot('settings');
  document.getElementById('nav').querySelectorAll('.nav-item')[4].click();

  const content = document.getElementById('content');
  assert.equal(document.getElementById('budgetInput').value, '2000');
  assert.equal(document.getElementById('requestsInput').value, '100');
  assert.ok(content.querySelectorAll('.seg').length >= 3);
});

test('the sources view lists installed repositories', async () => {
  const { document } = await boot('sources');
  document.getElementById('nav').querySelectorAll('.nav-item')[2].click();

  const rows = document.getElementById('content').querySelectorAll('.source-row');
  assert.equal(rows.length, 1);
  assert.match(rows[0].querySelector('.source-name').textContent, /owner\/repo/);
});

test('the sync view shows git steps and an init button', async () => {
  const { document } = await boot('sync');
  document.getElementById('nav').querySelectorAll('.nav-item')[3].click();

  const content = document.getElementById('content');
  assert.equal(content.querySelectorAll('.step').length, 3);
  assert.equal(content.querySelectorAll('.cmd').length, 3);
  assert.match(content.textContent, /初始化仓库/);
});
