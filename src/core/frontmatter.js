/**
 * Minimal YAML frontmatter reader/writer for `SKILL.md` files.
 *
 * Deliberately tiny: skills only use flat `key: value` pairs, occasionally a
 * folded (`>`) or literal (`|`) block scalar. Anything fancier is out of scope —
 * we never want to pull a YAML engine into the dependency tree of a CLI that
 * people run on every device.
 */

const FENCE = '---';

/** @typedef {{ data: Record<string, string>, body: string, hasFrontmatter: boolean }} ParsedSkill */

/**
 * @param {string} text
 * @returns {ParsedSkill}
 */
export function parse(text) {
  const src = String(text ?? '');
  const lines = src.split(/\r?\n/);
  if (lines[0]?.trim() !== FENCE) {
    return { data: {}, body: src, hasFrontmatter: false };
  }
  const end = closingFence(lines, 1);
  if (end < 0) {
    return { data: {}, body: src, hasFrontmatter: false };
  }

  /** @type {Record<string, string>} */
  const data = {};
  for (let i = 1; i < end; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;

    const key = match[1];
    const rawValue = match[2].trim();

    if (/^[>|][+-]?$/.test(rawValue)) {
      const folded = rawValue.startsWith('>');
      const block = [];
      let j = i + 1;
      while (j < end && (lines[j].trim() === '' || /^\s+\S/.test(lines[j]))) {
        block.push(lines[j].replace(/^\s+/, ''));
        j += 1;
      }
      i = j - 1;
      data[key] = folded ? block.join(' ').replace(/\s+/g, ' ').trim() : block.join('\n').trim();
    } else {
      data[key] = unquote(rawValue);
    }
  }

  return { data, body: lines.slice(end + 1).join('\n'), hasFrontmatter: true };
}

/**
 * Replace the `description:` line (plus any block continuation lines) while
 * leaving every other byte of the file alone.
 *
 * @param {string} text
 * @param {string} value
 * @returns {string}
 */
export function setDescription(text, value) {
  const src = String(text ?? '');
  const lines = src.split(/\r?\n/);
  if (lines[0]?.trim() !== FENCE) return src;

  const end = closingFence(lines, 1);
  if (end < 0) return src;

  let index = -1;
  for (let i = 1; i < end; i += 1) {
    if (/^description\s*:/.test(lines[i])) {
      index = i;
      break;
    }
  }
  if (index < 0) return src;

  let j = index + 1;
  while (j < end && lines[j].trim() !== '' && /^\s+\S/.test(lines[j])) j += 1;

  const next = [
    ...lines.slice(0, index),
    `description: ${value}`,
    ...lines.slice(j),
  ];
  return next.join('\n');
}

/**
 * @param {string[]} lines
 * @param {number} from
 * @returns {number} index of the closing fence, or -1
 */
function closingFence(lines, from) {
  for (let i = from; i < lines.length; i += 1) {
    if (lines[i].trim() === FENCE) return i;
  }
  return -1;
}

/**
 * @param {string} value
 * @returns {string}
 */
function unquote(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' || first === "'") && last === first) {
      const inner = value.slice(1, -1);
      return first === '"' ? inner.replace(/\\"/g, '"') : inner.replace(/''/g, "'");
    }
  }
  return value;
}
