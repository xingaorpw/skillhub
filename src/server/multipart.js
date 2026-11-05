/**
 * Minimal `multipart/form-data` parser.
 *
 * Needed for drag-and-drop import: the browser can hand us a folder's files as a
 * FormData payload, but Node has no built-in parser and we refuse to add a
 * dependency for ~80 lines of byte slicing.
 */

/**
 * @typedef {{ name: string | null, filename: string | null, contentType: string | null, data: Buffer }} Part
 */

/**
 * @param {Buffer} buffer
 * @param {string} contentType
 * @returns {Part[]}
 */
export function parseMultipart(buffer, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? '');
  if (!boundaryMatch) throw new Error('multipart body has no boundary');

  const boundary = Buffer.from(`--${(boundaryMatch[1] ?? boundaryMatch[2]).trim()}`, 'utf8');
  const parts = [];
  let cursor = buffer.indexOf(boundary);
  if (cursor < 0) throw new Error('multipart boundary not found in body');
  cursor += boundary.length;

  // Walk boundary to boundary; each chunk is `\r\n<headers>\r\n\r\n<body>\r\n`.
  for (let guard = 0; guard < 10_000; guard += 1) {
    if (buffer[cursor] === 0x2d && buffer[cursor + 1] === 0x2d) break; // closing "--"
    if (buffer[cursor] === 0x0d) cursor += 2; // leading CRLF

    const next = buffer.indexOf(boundary, cursor);
    if (next < 0) break;

    let end = next;
    if (buffer[end - 2] === 0x0d && buffer[end - 1] === 0x0a) end -= 2;

    parts.push(parsePart(buffer.subarray(cursor, end)));
    cursor = next + boundary.length;
  }

  return parts;
}

/**
 * @param {Buffer} raw
 * @returns {Part}
 */
function parsePart(raw) {
  const separator = raw.indexOf('\r\n\r\n');
  if (separator < 0) return { name: null, filename: null, contentType: null, data: raw };

  const headerText = raw.subarray(0, separator).toString('utf8');
  const data = raw.subarray(separator + 4);

  /** @type {Record<string, string>} */
  const headers = {};
  for (const line of headerText.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
  }

  const disposition = headers['content-disposition'] ?? '';
  return {
    name: /name="([^"]*)"/.exec(disposition)?.[1] ?? null,
    filename: /filename="([^"]*)"/.exec(disposition)?.[1] ?? null,
    contentType: headers['content-type'] ?? null,
    data,
  };
}
