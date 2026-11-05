import assert from 'node:assert/strict';
import test from 'node:test';

import { escapeHtml, renderMarkdown } from '../web/markdown.js';

test('renders headings up to h3', () => {
  assert.equal(renderMarkdown('# Title'), '<h1>Title</h1>');
  assert.equal(renderMarkdown('### Deep'), '<h3>Deep</h3>');
  assert.equal(renderMarkdown('#### Deeper'), '<h3>Deeper</h3>');
});

test('renders paragraphs and joins soft-wrapped lines', () => {
  assert.equal(renderMarkdown('one\ntwo'), '<p>one two</p>');
  assert.equal(renderMarkdown('a\n\nb'), '<p>a</p>\n<p>b</p>');
});

test('renders unordered and ordered lists', () => {
  assert.equal(renderMarkdown('- a\n- b'), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
  assert.equal(renderMarkdown('1. a\n2. b'), '<ol>\n<li>a</li>\n<li>b</li>\n</ol>');
});

test('switches list types instead of nesting them wrongly', () => {
  const html = renderMarkdown('- a\n\n1. b');
  assert.match(html, /<\/ul>\n<ol>/);
});

test('renders fenced code blocks verbatim', () => {
  const html = renderMarkdown('```bash\nskillhub link --dry-run\n```');
  assert.equal(html, '<pre><code>skillhub link --dry-run</code></pre>');
});

test('keeps markdown inside code fences unparsed', () => {
  const html = renderMarkdown('```\n# not a heading\n**not bold**\n```');
  assert.match(html, /# not a heading/);
  assert.match(html, /\*\*not bold\*\*/);
  assert.doesNotMatch(html, /<h1>/);
});

test('renders blockquotes and rules', () => {
  assert.equal(renderMarkdown('> quoted'), '<blockquote>\n<p>quoted</p>\n</blockquote>');
  assert.equal(renderMarkdown('---'), '<hr />');
});

test('renders inline code, bold, italic and links', () => {
  assert.equal(renderMarkdown('use `npm test`'), '<p>use <code>npm test</code></p>');
  assert.equal(renderMarkdown('**bold**'), '<p><strong>bold</strong></p>');
  assert.equal(renderMarkdown('*italic*'), '<p><em>italic</em></p>');
  assert.equal(
    renderMarkdown('[docs](https://example.com/x)'),
    '<p><a href="https://example.com/x" target="_blank" rel="noreferrer">docs</a></p>',
  );
});

test('renders pipe tables', () => {
  const html = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |');
  assert.match(html, /<table>/);
  assert.match(html, /<th>a<\/th>/);
  assert.match(html, /<td>2<\/td>/);
});

test('escapes raw HTML instead of executing it', () => {
  const html = renderMarkdown('<script>alert(1)</script>');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('does not turn javascript: urls into links', () => {
  const html = renderMarkdown('[x](javascript:alert(1))');
  assert.doesNotMatch(html, /href="javascript/);
});

test('escapeHtml handles the four dangerous characters', () => {
  assert.equal(escapeHtml('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
});

test('handles empty and null input', () => {
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown(null), '');
});

test('renders a realistic SKILL.md without crashing', () => {
  const markdown = `---
name: demo
description: demo skill
---

# Demo

Some text with \`code\` and **bold**.

## Steps

1. Do this
2. Then that

\`\`\`bash
echo ok
\`\`\`

> A note

| col | val |
| --- | --- |
| a | 1 |
`;
  const html = renderMarkdown(markdown);
  assert.match(html, /<h1>Demo<\/h1>/);
  assert.match(html, /<h2>Steps<\/h2>/);
  assert.match(html, /<pre><code>echo ok<\/code><\/pre>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<table>/);
});
