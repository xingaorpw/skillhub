/**
 * Minimal Markdown renderer for the skill preview pane.
 *
 * Kept as a separate module so it can be unit-tested in Node without a DOM, and
 * so the console keeps working if someone swaps the surrounding UI.
 *
 * Supported: ATX headings (1–6, rendered up to h3), ordered/unordered lists,
 * blockquotes, horizontal rules, fenced code, pipe tables, and inline
 * `code`, **bold**, *italic*, [links](https://…). Raw HTML is always escaped.
 */

/**
 * @param {string} markdown
 * @returns {string}
 */
export function renderMarkdown(markdown) {
  const fences = [];
  const src = String(markdown ?? '').replace(/\r\n/g, '\n');

  const withoutFences = src.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    fences.push(`<pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`);
    return `\u0000F${fences.length - 1}\u0000`;
  });

  const lines = withoutFences.split('\n');
  const out = [];
  let listType = null;
  let inQuote = false;
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  const closeQuote = () => {
    if (inQuote) {
      out.push('</blockquote>');
      inQuote = false;
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (/^\u0000F\d+\u0000$/.test(line.trim())) {
      flushParagraph();
      closeList();
      closeQuote();
      out.push(fences[Number(line.trim().replace(/\u0000F|\u0000/g, ''))]);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      closeQuote();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      closeQuote();
      const level = Math.min(3, heading[1].length);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushParagraph();
      closeList();
      closeQuote();
      out.push('<hr />');
      continue;
    }

    // Table: a row containing pipes followed by a separator row.
    if (line.includes('|') && /^\s*\|?[\s:-]+\|[\s:|-]*$/.test(lines[i + 1] ?? '')) {
      flushParagraph();
      closeList();
      closeQuote();
      const header = splitRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|')) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      i -= 1;
      out.push(
        `<table><thead><tr>${header.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>` +
          rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('') +
          '</tbody></table>',
      );
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      closeList();
      if (!inQuote) {
        out.push('<blockquote>');
        inQuote = true;
      }
      out.push(`<p>${inline(quote[1])}</p>`);
      continue;
    }
    closeQuote();

    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const unordered = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (ordered || unordered) {
      flushParagraph();
      const wanted = ordered ? 'ol' : 'ul';
      if (listType !== wanted) {
        closeList();
        out.push(`<${wanted}>`);
        listType = wanted;
      }
      out.push(`<li>${inline((ordered ?? unordered)[1])}</li>`);
      continue;
    }
    closeList();

    paragraph.push(line.trim());
  }

  flushParagraph();
  closeList();
  closeQuote();

  return out.join('\n');
}

/**
 * @param {string} row
 * @returns {string[]}
 */
function splitRow(row) {
  return row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

/**
 * @param {string} text
 * @returns {string}
 */
function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

/**
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
