// SVG output safety boundary (SEC-182).
//
// Every dynamic string that reaches the SVG serializer crosses this module
// at the LAST serialization boundary. Three concerns, one authoritative
// place each:
//
// 1. XML escaping — text nodes and double-quoted attribute values. Also
//    strips characters XML 1.0 cannot represent (C0 controls, lone
//    surrogates, noncharacters) so hostile text cannot make the document
//    unparseable. Apostrophes stay untouched (attributes use double quotes)
//    so valid labels serialize byte-identically.
// 2. Fragment id codec — `clipPath` ids (from persisted viewport ids) and
//    their `url(#…)` references must survive SVG/CSS fragment semantics.
//    Safe ids are returned unchanged (fixture byte parity); everything else
//    is folded into an injective, deterministic, safe identifier.
// 3. Paint contract — colors are XML-escaped anyway, but `url(...)` /
//    external paint references must never reach the document. Only
//    well-formed hex/keyword/named/functional colors pass; the rest fall
//    back to a caller-chosen inert value.

const XML_ESCAPES: ReadonlyArray<readonly [RegExp, string]> = [
  [/&/g, '&amp;'],
  [/</g, '&lt;'],
  [/>/g, '&gt;'],
  [/"/g, '&quot;'],
];

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

// XML 1.0 valid chars: #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD]
// | [#x10000-#x10FFFF]. Lone surrogates become U+FFFD (valid, deterministic);
// other illegal controls/noncharacters are dropped.
const stripInvalidXmlChars = (text: string): string => {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (isHighSurrogate(code)) {
      const next = text.charCodeAt(index + 1);
      if (isLowSurrogate(next)) {
        out += text[index] as string;
        out += text[index + 1] as string;
        index += 1;
      } else {
        out += '\uFFFD';
      }
      continue;
    }
    if (isLowSurrogate(code)) {
      out += '\uFFFD';
      continue;
    }
    if (code === 0x9 || code === 0xa || code === 0xd) {
      out += text[index] as string;
      continue;
    }
    if (code < 0x20 || code === 0xfffe || code === 0xffff) continue;
    out += text[index] as string;
  }
  return out;
};

/** XML-escape for text nodes and double-quoted attribute values. */
export const escapeXml = (text: string): string =>
  XML_ESCAPES.reduce(
    (escaped, [pattern, entity]) => escaped.replace(pattern, entity),
    stripInvalidXmlChars(text),
  );

/**
 * Prefix for encoded fragment ids. Excluded from the pass-through set so the
 * encoded image and the identity image stay disjoint (injective overall).
 */
export const SVG_FRAGMENT_ENCODED_PREFIX = 'cad-';

/** Safe XML-name / URL-fragment charset: `viewport-<uuid>`, `abc_1.2` … */
const SAFE_FRAGMENT_ID = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/**
 * Strings shaped exactly like an encoded id. The identity branch never emits
 * these, so `toSafeSvgFragmentId` is injective across safe and unsafe ids —
 * two distinct inputs can never collapse onto one clip id.
 */
const ENCODED_FRAGMENT_SHAPE = new RegExp(`^${SVG_FRAGMENT_ENCODED_PREFIX}[0-9a-f]*$`);

/**
 * Deterministic, collision-resistant, URL-fragment-safe clip identifier.
 *
 * - Simple safe ids (`viewport-viewport-small-parcel`, UUID-suffixed
 *   runtime ids) are preserved byte-identically.
 * - Anything else (quotes, `<>&`, whitespace, parens, `#`, `:`, slashes,
 *   Unicode, CSS `url()` punctuation, XML-escaped fragments) is encoded as
 *   one fixed-width hex unit per UTF-16 code unit. Same input → same output;
 *   different input → different output; no random/timestamp component; no
 *   lossy stripping.
 */
export const toSafeSvgFragmentId = (id: string): string => {
  if (SAFE_FRAGMENT_ID.test(id) && !ENCODED_FRAGMENT_SHAPE.test(id)) return id;
  let encoded = '';
  for (let index = 0; index < id.length; index += 1) {
    encoded += id.charCodeAt(index).toString(16).padStart(4, '0');
  }
  return `${SVG_FRAGMENT_ENCODED_PREFIX}${encoded}`;
};

/** Neutral, non-executable paint used when a color fails the contract. */
export const SVG_PAINT_FALLBACK = '#000000';

const HEX_PAINT = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
// CSS named colors are letters only; `url`/`expression`/`javascript` are
// rejected explicitly even though they cannot fetch without `()`.
const NAMED_PAINT = /^[a-zA-Z]{3,30}$/;
const FUNCTIONAL_PAINT = /^(?:rgb|rgba|hsl|hsla)\([0-9.,%\s/+-]{1,60}\)$/i;
const REJECTED_PAINT_TOKENS = /url|expression|javascript|@import|<|>/i;

/**
 * Centralized narrow SVG paint contract. Accepts the paint forms the exporter
 * actually emits (hex, `none`, `transparent`, `currentColor`, named colors,
 * numeric `rgb()/hsl()`), rejects markup, whitespace-padded URL punctuation,
 * `url(...)` paint servers, and anything with external-reference potential.
 * Trims only for the validity check; valid values are returned unchanged so
 * byte output stays identical.
 */
export const isSafeSvgPaint = (value: string): boolean => {
  if (REJECTED_PAINT_TOKENS.test(value)) return false;
  const candidate = value.trim();
  if (candidate.length === 0 || candidate.length > 64) return false;
  const lower = candidate.toLowerCase();
  if (lower === 'none' || lower === 'transparent' || lower === 'currentcolor') return true;
  return HEX_PAINT.test(candidate) || NAMED_PAINT.test(candidate) || FUNCTIONAL_PAINT.test(candidate);
};

/** Return an acceptable paint, or the supplied inert fallback. */
export const safeSvgPaint = (value: string | undefined, fallback: string): string =>
  value != null && isSafeSvgPaint(value) ? value : fallback;

/**
 * `stroke-dasharray` is a numeric list, never a paint/URL slot. Anything
 * outside the numeric grammar is dropped (attribute omitted) so a hostile
 * dash cannot smuggle an external reference into the document.
 */
const SAFE_DASH_ARRAY = /^\d+(?:\.\d+)?(?:[\s,]+\d+(?:\.\d+)?)*$/;

export const isSafeSvgDashArray = (value: string): boolean =>
  value.length <= 200 && SAFE_DASH_ARRAY.test(value.trim());

export const safeSvgDashArray = (value: string | undefined): string | undefined =>
  value != null && isSafeSvgDashArray(value) ? value : undefined;
