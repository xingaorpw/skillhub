/**
 * Executes the real `web/app.js` against a minimal DOM shim.
 *
 * There is no browser in CI, but "the console throws on first render" is the
 * kind of bug that only shows up there. This test runs the actual module — not a
 * copy — so a typo in a DOM API or a broken render path fails the build.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

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
    this.innerHTML = '';
    this.className = '';
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = '';
    this.tabIndex = 0;
    this.isFragment = false;
    this.title = '';
  }

  get textContent() {
    return this._text ?? '';
  }

  set textContent(value) {
    this._text = String(value);
    // Setting textContent replaces all children, which is how render() clears
    // the grid before rebuilding it.
    if (this._text === '') this.children.length = 0;
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node?.isFragment) this.children.push(...node.children);
      else this.children.push(node);
    }
  }

  appendChild(node) {
    this.append(node);
    return node;
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

  querySelectorAll() {
    return [];
  }

  querySelector() {
    return null;
  }

  closest() {
    return null;
  }

  focus() {}

  click() {
    this.dispatch('click');
  }

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
  }
}

function installDom() {
  const registry = new Map();

  const document = {
    documentElement: { dataset: {} },
    activeElement: { tagName: 'BODY' },
    getElementById(id) {
      if (!registry.has(id)) {
        const node = new Element(id.includes('Modal') ? 'dialog' : 'div');
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
    addEventListener() {},
    registry,
  };

  globalThis.document = document;
  globalThis.window = { location: { search: '', pathname: '/' } };
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
  // Node 24 ships a getter-only global `navigator`, so a plain assignment throws.
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async () => {} } },
    configurable: true,
    writable: true,
  });
  globalThis.confirm = () => true;

  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/state')) {
      return jsonResponse({
        hubDir: '/home/u/.skillhub',
        exists: true,
        platform: 'linux x64 · node v22.0.0',
        shelf: ['alpha'],
        stats: { count: 2, onShelf: 1, catalogTokens: 60, visibleTokens: 30 },
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
            updatedAt: new Date(0).toISOString(),
            source: 'owner/repo',
          },
        ],
        sources: [],
      });
    }
    return jsonResponse({});
  };

  return document;
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  };
}

test('the console module renders cards from /api/state', async () => {
  const document = installDom();

  await import('../web/app.js?test=render');
  // load() is async: let its promise chain finish.
  await new Promise((resolve) => setTimeout(resolve, 20));

  const grid = document.getElementById('grid');
  assert.equal(grid.children.length, 2, 'both skills should render as cards');
  assert.equal(document.getElementById('statTotal').textContent, '2');
  assert.equal(document.getElementById('statShelf').textContent, '1/2');
  assert.equal(document.getElementById('hubPath').textContent, '/home/u/.skillhub');

  const names = grid.children.map((card) => card.children[0].children[0].textContent);
  assert.deepEqual(names, ['alpha', 'beta']);

  // The off-shelf card must be visually marked.
  assert.equal(grid.children[1].className, 'card is-off');
  assert.equal(grid.children[0].className, 'card');
});

test('search filters the rendered cards', async () => {
  const document = installDom();
  await import('../web/app.js?test=search');
  await new Promise((resolve) => setTimeout(resolve, 20));

  const search = document.getElementById('search');
  search.value = 'beta';
  search.dispatch('input', { target: search });

  const grid = document.getElementById('grid');
  assert.equal(grid.children.length, 1);
  assert.equal(grid.children[0].children[0].children[0].textContent, 'beta');
});

test('the slash filter only shows model-invisible skills', async () => {
  const document = installDom();
  await import('../web/app.js?test=slash');
  await new Promise((resolve) => setTimeout(resolve, 20));

  const filters = document.getElementById('filters');
  filters.dispatch('click', {
    target: { closest: () => ({ dataset: { filter: 'slash' }, classList: new ClassList() }) },
  });

  const grid = document.getElementById('grid');
  assert.equal(grid.children.length, 1);
  assert.equal(grid.children[0].children[0].children[0].textContent, 'beta');
});
