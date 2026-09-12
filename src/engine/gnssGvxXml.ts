/**
 * Phase 12E0 — minimal secure XML tree parser for GVX intake.
 *
 * Zero-new-dependency, browser+Node-safe (pure string scanning; no
 * DOMParser, no network, only the 5 predefined entities decoded). A
 * hand-written scanner is used instead of regular-expression XML
 * parsing so nesting, comments,
 * processing instructions, and hostile declarations are handled
 * structurally rather than pattern-matched.
 *
 * Security posture (documented for the GVX intake review):
 * - No DTD/DOCTYPE/ENTITY/NOTATION support: any `<!...>` declaration
 *   other than comments/CDATA fails closed (no XXE, no billion-laughs).
 * - No external references: SYSTEM/PUBLIC can only appear inside the
 *   rejected declarations above.
 * - Exactly the 5 predefined entities (`&amp;` `&lt;` `&gt;` `&quot;`
 *   `&apos;`) are decoded in text/attribute values; any other `&...;`
 *   (custom, numeric `&#...;`, unterminated `&`) fails closed, so there
 *   is no partial custom/numeric/external expansion.
 * - Bounded input: max bytes, max nodes, max depth, max attribute count.
 * - No prototype pollution: attribute maps use null-prototype objects and
 *   `__proto__` attribute names are rejected.
 */

export class GvxXmlError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`XML line ${line}: ${message}`);
    this.name = 'GvxXmlError';
    this.line = line;
  }
}

export interface GvxXmlNode {
  readonly name: string;
  readonly attrs: Record<string, string>;
  readonly children: GvxXmlNode[];
  /** Concatenated direct character data, trimmed. */
  readonly text: string;
  /** 1-based source line of the opening tag (diagnostic context). */
  readonly line: number;
}

const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const MAX_NODES = 200_000;
const MAX_DEPTH = 64;
const MAX_ATTRS_PER_TAG = 32;
const MAX_TAG_CHARS = 4096;

const isSpace = (char: string): boolean =>
  char === ' ' || char === '\t' || char === '\n' || char === '\r';
const isNameChar = (char: string): boolean =>
  /[A-Za-z0-9_.:-]/.test(char);

const failAt = (line: number, message: string): never => {
  throw new GvxXmlError(message, line);
};

/** Decode exactly the 5 predefined XML entities; anything else fails closed. */
const PREDEFINED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

const decodeXmlEntities = (value: string, line: number, what: string): string => {
  if (!value.includes('&')) return value;
  let out = '';
  let i = 0;
  for (;;) {
    const amp = value.indexOf('&', i);
    if (amp === -1) {
      out += value.slice(i);
      return out;
    }
    out += value.slice(i, amp);
    const semi = value.indexOf(';', amp + 1);
    if (semi === -1) {
      throw new GvxXmlError(`${what} has an unterminated entity reference (no entity expansion beyond amp/lt/gt/quot/apos).`, line);
    }
    const name = value.slice(amp + 1, semi);
    // Null-prototype lookup: '__proto__'/'constructor'/'toString' must
    // fail closed, not resolve via Object.prototype.
    const decoded = Object.hasOwn(PREDEFINED_ENTITIES, name)
      ? PREDEFINED_ENTITIES[name]
      : undefined;
    if (decoded === undefined) {
      throw new GvxXmlError(
        `${what} uses forbidden entity '&${name};' (only &amp; &lt; &gt; &quot; &apos; are decoded; no custom/numeric/external entities).`,
        line,
      );
    }
    out += decoded;
    i = semi + 1;
  }
};

const parseAttributes = (
  body: string,
  start: number,
  end: number,
  line: number,
  attrs: Record<string, string>,
): void => {
  let i = start;
  let count = 0;
  while (i < end) {
    while (i < end && isSpace(body[i] ?? '')) i += 1;
    if (i >= end) break;
    const nameStart = i;
    while (i < end && isNameChar(body[i] ?? '')) i += 1;
    const name = body.slice(nameStart, i);
    if (!name || !/[A-Za-z_.:]/.test(name[0] ?? '')) {
      throw new GvxXmlError(`malformed attribute name '${name}'.`, line);
    }
    if (name === '__proto__') {
      throw new GvxXmlError('rejected attribute name (prototype pollution guard).', line);
    }
    while (i < end && isSpace(body[i] ?? '')) i += 1;
    if (body[i] !== '=') throw new GvxXmlError(`attribute '${name}' is missing '='.`, line);
    i += 1;
    while (i < end && isSpace(body[i] ?? '')) i += 1;
    const quote = body[i];
    if (quote !== '"' && quote !== "'") {
      throw new GvxXmlError(`attribute '${name}' value must be quoted.`, line);
    }
    i += 1;
    const valueStart = i;
    while (i < end && body[i] !== quote) i += 1;
    if (i >= end) throw new GvxXmlError(`attribute '${name}' is unterminated.`, line);
    const rawValue = body.slice(valueStart, i);
    i += 1;
    const value = decodeXmlEntities(rawValue, line, `attribute '${name}'`);
    if (Object.hasOwn(attrs, name)) {
      throw new GvxXmlError(`duplicate attribute '${name}'.`, line);
    }
    attrs[name] = value;
    count += 1;
    if (count > MAX_ATTRS_PER_TAG) {
      throw new GvxXmlError(`tag exceeds ${MAX_ATTRS_PER_TAG} attributes.`, line);
    }
  }
};

interface OpenFrame {
  name: string;
  attrs: Record<string, string>;
  line: number;
  children: GvxXmlNode[];
  text: string[];
}

/**
 * Parse an XML document into a minimal element tree. Returns the root
 * element. Throws GvxXmlError (never returns partial trees) on any
 * malformed, hostile, or over-limit input.
 */
export const parseXmlDocument = (text: string): GvxXmlNode => {
  if (text.length > MAX_INPUT_BYTES) {
    throw new GvxXmlError(`input exceeds ${MAX_INPUT_BYTES} bytes (${text.length}).`, 1);
  }
  let resolved: GvxXmlNode | null = null;
  const stack: OpenFrame[] = [];
  let nodeCount = 0;
  let i = 0;
  const n = text.length;
  let line = 1;
  // ponytail: single forward scan; jump() counts newlines only in the skipped span.
  const jump = (next: number): number => {
    for (let k = i; k < next; k += 1) {
      if (text[k] === '\n') line += 1;
    }
    return next;
  };
  const fail = (message: string): never => failAt(line, message);
  // Quote-aware tag end: a '>' inside a quoted attribute value is data,
  // not the tag terminator (an unterminated quote runs to EOF → -1).
  // ponytail: single linear scan, no regex/backtracking.
  const findTagEnd = (from: number): number => {
    let quote: string | null = null;
    for (let k = from; k < n; k += 1) {
      const char = text[k] ?? '';
      if (quote !== null) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '>') {
        return k;
      }
    }
    return -1;
  };

  while (i < n) {
    if (text[i] !== '<') {
      const next = text.indexOf('<', i);
      const chunk = next === -1 ? text.slice(i) : text.slice(i, next);
      const top = stack[stack.length - 1];
      // CDATA sections push raw text (XML-literal, never entity-decoded);
      // regular character data decodes exactly the 5 predefined entities.
      if (top) top.text.push(decodeXmlEntities(chunk, line, 'character data'));
      else if (chunk.trim() !== '') fail('character data outside the root element.');
      i = jump(next === -1 ? n : next);
      continue;
    }
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      if (end === -1) fail('unterminated comment.');
      i = jump(end + 3);
      continue;
    }
    if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i + 2);
      if (end === -1) fail('unterminated processing instruction.');
      i = jump(end + 2);
      continue;
    }
    if (text.startsWith('<![CDATA[', i)) {
      const end = text.indexOf(']]>', i + 9);
      if (end === -1) fail('unterminated CDATA section.');
      const top = stack[stack.length - 1];
      if (top) top.text.push(text.slice(i + 9, end));
      i = jump(end + 3);
      continue;
    }
    if (text.startsWith('<!', i)) {
      const kind = text.slice(i + 2, i + 9).toUpperCase();
      fail(`rejected XML declaration '${kind}' (no DTD/DOCTYPE/ENTITY support).`);
    }
    if (text.startsWith('</', i)) {
      const end = text.indexOf('>', i + 2);
      if (end === -1) fail('unterminated closing tag.');
      if (end - i > MAX_TAG_CHARS) fail('closing tag too long.');
      const name = text.slice(i + 2, end).trim();
      const open = stack.pop() as OpenFrame | undefined;
      if (open === undefined || open.name !== name) {
        fail(`mismatched closing tag '</${name}>'.`);
      }
      const done = open as OpenFrame;
      const finished: GvxXmlNode = {
        name: done.name,
        attrs: done.attrs,
        children: done.children,
        text: done.text.join('').trim(),
        line: done.line,
      };
      if (stack.length === 0) {
        if (resolved) fail('multiple root elements.');
        resolved = finished;
      } else {
        stack[stack.length - 1]?.children.push(finished);
      }
      i = jump(end + 1);
      continue;
    }
    const end = findTagEnd(i + 1);
    if (end === -1) fail('unterminated opening tag.');
    if (end - i > MAX_TAG_CHARS) fail('opening tag too long.');
    const tagLine = line;
    let body = text.slice(i + 1, end);
    const selfClosing = body.endsWith('/');
    if (selfClosing) body = body.slice(0, -1);
    let k = 0;
    while (k < body.length && isSpace(body[k] ?? '')) k += 1;
    const nameStart = k;
    while (k < body.length && isNameChar(body[k] ?? '')) k += 1;
    const name = body.slice(nameStart, k);
    if (!name) fail('empty opening tag.');
    const attrs: Record<string, string> = Object.create(null);
    parseAttributes(body, k, body.length, tagLine, attrs);
    nodeCount += 1;
    if (nodeCount > MAX_NODES) fail(`document exceeds ${MAX_NODES} elements.`);
    if (stack.length + 1 > MAX_DEPTH) {
      fail(`document exceeds nesting depth ${MAX_DEPTH}.`);
    }
    if (selfClosing) {
      const leaf: GvxXmlNode = { name, attrs, children: [], text: '', line: tagLine };
      if (stack.length === 0) {
        if (resolved) fail('multiple root elements.');
        resolved = leaf;
      } else {
        stack[stack.length - 1]?.children.push(leaf);
      }
    } else {
      stack.push({ name, attrs, line: tagLine, children: [], text: [] });
    }
    i = jump(end + 1);
  }
  if (stack.length > 0) {
    fail(`unclosed tag '<${stack[stack.length - 1]?.name ?? '?'}>'.`);
  }
  if (!resolved) throw new GvxXmlError('empty document (no root element).', 1);
  return resolved;
};

/** First direct child with the given name, or undefined. */
export const xmlChild = (node: GvxXmlNode, name: string): GvxXmlNode | undefined =>
  node.children.find((child) => child.name === name);

/** All direct children with the given name, in document order. */
export const xmlChildren = (node: GvxXmlNode, name: string): GvxXmlNode[] =>
  node.children.filter((child) => child.name === name);

/** Trimmed text of the first direct child with the given name, or undefined. */
export const xmlChildText = (node: GvxXmlNode, name: string): string | undefined => {
  const child = xmlChild(node, name);
  if (!child) return undefined;
  if (child.text === '' && child.children.length > 0) return undefined;
  return child.text;
};
