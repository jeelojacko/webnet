/**
 * @vitest-environment jsdom
 *
 * SEC-182 — SVG export output hardening (stored DOM XSS).
 *
 * Root cause: `serializeExportSceneToSvg` interpolated untrusted scene
 * strings (clip `id`, `clip-path` refs, `fill`) raw into SVG. A malicious
 * `.wncad` viewport id or entity/layer color could therefore inject markup
 * or event handlers into the preview's `dangerouslySetInnerHTML` sink and
 * into downloaded/exported SVG.
 *
 * These tests use REAL DOM parsing (`DOMParser`, `image/svg+xml`), never
 * naive regex, and only harmless marker payloads (`onload-marker`,
 * `window.__xss_probe`). No network, no real exfiltration.
 */
import { describe, expect, it } from 'vitest';
import type { ExportItem, ExportSheetScene } from '../src/engine/cad/cadExportScene';
import {
  serializeExportSceneToSvg,
  serializeExportSceneToSvgWithResult,
} from '../src/engine/cad/cadSvgSerializer';
import {
  escapeXml,
  isSafeSvgDashArray,
  isSafeSvgPaint,
  safeSvgPaint,
  SVG_FRAGMENT_ENCODED_PREFIX,
  SVG_PAINT_FALLBACK,
  toSafeSvgFragmentId,
} from '../src/engine/cad/cadSvgSafety';

const SAFE_FRAGMENT = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

// Adversarial fragments: quotes, angle brackets, ampersand, whitespace,
// parens, `#`, CSS `url`, SVG-escaped fragments, Unicode, controls. Two
// similar-but-distinct ids guard against lossy strip collisions.
const HOSTILE_IDS = [
  'viewport-"onload-marker="x',
  'viewport-"><script>window.__xss_probe=1</script>',
  'viewport-a&b',
  'viewport-a b',
  'viewport-a  b',
  'viewport-(a)',
  'viewport-#frag',
  'viewport-url(http://evil.example/leak.svg#a)',
  'viewport-&lt;script&gt;',
  'viewport-😀-习题',
  'viewport-\u0000\u0007',
];

const HOSTILE_PAINT = 'url(http://evil.example/leak.svg#p)">';

const ALLOWED_ELEMENTS = new Set([
  'svg', 'defs', 'clipPath', 'rect', 'g', 'line', 'polyline', 'polygon',
  'circle', 'ellipse', 'path', 'text',
]);
const ALLOWED_ATTRIBUTES = new Set([
  'xmlns', 'width', 'height', 'viewBox', 'id', 'x', 'y', 'r', 'cx', 'cy',
  'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'points', 'fill', 'stroke',
  'stroke-width', 'stroke-dasharray', 'opacity', 'clip-path', 'font-size',
  'text-anchor', 'transform', 'd',
]);

const buildScene = (ids: string[], paint: string): ExportSheetScene => {
  const clip = (index: number): string => ids[index % ids.length] as string;
  const base = { clipId: clip(0), stroke: paint };
  const items: ExportItem[] = [
    { kind: 'line', layer: 'layer-"<>&', ...base, x1: 0, y1: 0, x2: 10, y2: 10, widthMm: 0.5 },
    { kind: 'polyline', layer: 'poly', clipId: clip(1), points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], close: true, fill: paint, stroke: paint, dash: paint },
    { kind: 'rect', layer: 'rect', clipId: clip(2), x: 0, y: 0, width: 1, height: 1, fill: paint, stroke: paint },
    { kind: 'circle', layer: 'circle', clipId: clip(3), cx: 1, cy: 1, r: 1, fill: paint, stroke: paint, widthMm: 0.5 },
    { kind: 'ellipse', layer: 'ellipse', clipId: clip(4), cx: 1, cy: 1, rx: 1, ry: 2, rotationDeg: 15, stroke: paint, widthMm: 0.5 },
    { kind: 'arc', layer: 'arc', clipId: clip(5), cx: 1, cy: 1, r: 1, startDeg: 0, endDeg: 90, stroke: paint, widthMm: 0.5 },
    { kind: 'text', layer: 'text', clipId: clip(6), x: 1, y: 1, text: '<script>alert(1)</script> & "quote"', heightMm: 3, stroke: paint },
  ];
  return {
    sheetId: 'sec-182',
    sheetName: 'SEC 182',
    widthMm: 100,
    heightMm: 50,
    clips: ids.map((id, index) => ({ id, xMm: index, yMm: index, widthMm: 10, heightMm: 10 })),
    items,
  };
};

const parseSvg = (svg: string): Document => {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return doc;
};

const allElements = (doc: Document): Element[] => Array.from(doc.querySelectorAll('*'));

const clipRefs = (doc: Document): string[] =>
  Array.from(doc.querySelectorAll('[clip-path]')).map((element) => {
    const value = element.getAttribute('clip-path') ?? '';
    const match = /^url\(#([^)]*)\)$/.exec(value);
    expect(match, `unexpected clip-path grammar: ${value}`).not.toBeNull();
    return (match as RegExpExecArray)[1] as string;
  });

const clipIds = (doc: Document): string[] =>
  Array.from(doc.querySelectorAll('clipPath')).map((element) => element.getAttribute('id') ?? '');

describe('SEC-182 SVG serializer hardening', () => {
  it('produces well-formed SVG with only expected element/attribute grammar for hostile input', () => {
    const svg = serializeExportSceneToSvg(buildScene(HOSTILE_IDS, HOSTILE_PAINT));
    const doc = parseSvg(svg);

    for (const element of allElements(doc)) {
      expect(ALLOWED_ELEMENTS.has(element.tagName), `unexpected element <${element.tagName}>`).toBe(true);
      for (const attribute of Array.from(element.attributes)) {
        expect(ALLOWED_ATTRIBUTES.has(attribute.name), `unexpected attribute ${attribute.name}`).toBe(true);
        expect(/^on/i.test(attribute.name), `event handler attribute ${attribute.name}`).toBe(false);
      }
    }

    // No injected nodes / external references.
    expect(doc.querySelectorAll('script, foreignObject, iframe, object, embed, image, img, use, a').length).toBe(0);
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('url(http');
    expect(svg).not.toContain('javascript:');
  });

  it('resolves every clip reference to exactly one unique matching clipPath (similar adversarial ids included)', () => {
    const ids = HOSTILE_IDS.slice(0, 7);
    const svg = serializeExportSceneToSvg(buildScene(ids, HOSTILE_PAINT));
    const doc = parseSvg(svg);
    const declared = clipIds(doc);
    const refs = clipRefs(doc);

    expect(declared).toHaveLength(ids.length);
    expect(new Set(declared).size).toBe(declared.length);
    for (const id of declared) expect(SAFE_FRAGMENT.test(id), `unsafe clip id ${id}`).toBe(true);
    for (const ref of refs) {
      expect(SAFE_FRAGMENT.test(ref), `unsafe clip ref ${ref}`).toBe(true);
      expect(declared).toContain(ref);
    }
    // Every declared clip is referenced by the scene items.
    for (const id of declared) expect(refs).toContain(id);
    // Similar ids never collapse: distinct outputs for close inputs.
    expect(toSafeSvgFragmentId('viewport-a b')).not.toBe(toSafeSvgFragmentId('viewport-a  b'));
  });

  it('rejects hostile paints at the boundary (no url()/markup reaches fill, stroke, or text)', () => {
    const svg = serializeExportSceneToSvg(buildScene(HOSTILE_IDS, HOSTILE_PAINT));
    const doc = parseSvg(svg);
    for (const element of allElements(doc)) {
      for (const name of ['fill', 'stroke']) {
        const value = element.getAttribute(name);
        if (value == null) continue;
        expect(isSafeSvgPaint(value), `unsafe ${name}=${value}`).toBe(true);
        expect(value).not.toContain('url(');
      }
    }
    // Hostile fills degrade to inert `none`; hostile strokes to the safe fallback.
    expect(svg).toContain('fill="none"');
    expect(svg).toContain(`stroke="${SVG_PAINT_FALLBACK}"`);
  });

  it('keeps hostile text as text content, never markup', () => {
    const svg = serializeExportSceneToSvg(buildScene(HOSTILE_IDS, HOSTILE_PAINT));
    const doc = parseSvg(svg);
    const text = doc.querySelector('text');
    expect(text?.textContent).toBe('<script>alert(1)</script> & "quote"');
  });

  it('serializes identically through the warning-aware wrapper', () => {
    const scene = buildScene(HOSTILE_IDS, HOSTILE_PAINT);
    const result = serializeExportSceneToSvgWithResult(scene);
    expect(result.output).toBe(serializeExportSceneToSvg(scene));
    const doc = parseSvg(result.output);
    expect(doc.querySelectorAll('script, foreignObject, image, img').length).toBe(0);
  });
});

describe('SEC-182 fragment id codec', () => {
  it('preserves simple safe ids byte-identically (fixture parity)', () => {
    expect(toSafeSvgFragmentId('viewport-viewport-small-parcel')).toBe('viewport-viewport-small-parcel');
    expect(toSafeSvgFragmentId('viewport-123e4567-e89b-12d3-a456-426614174000')).toBe(
      'viewport-123e4567-e89b-12d3-a456-426614174000',
    );
  });

  it('encodes hostile ids into safe, deterministic, injective fragments', () => {
    const encoded = HOSTILE_IDS.map(toSafeSvgFragmentId);
    expect(new Set(encoded).size).toBe(encoded.length);
    for (const id of encoded) expect(SAFE_FRAGMENT.test(id)).toBe(true);
    // Deterministic: same input twice, same output.
    expect(toSafeSvgFragmentId(HOSTILE_IDS[0] as string)).toBe(encoded[0]);
    // Encoded images are disjoint from the pass-through set.
    const looksEncoded = /^cad-[0-9a-f]*$/;
    for (let index = 0; index < HOSTILE_IDS.length; index += 1) {
      const original = HOSTILE_IDS[index] as string;
      const output = encoded[index] as string;
      if (output === original) continue;
      expect(output.startsWith(SVG_FRAGMENT_ENCODED_PREFIX)).toBe(true);
      expect(looksEncoded.test(original)).toBe(false);
    }
  });

  it('re-encodes safe-but-encoded-shaped ids so no two inputs can collide', () => {
    const shaped = 'cad-fade';
    const encoded = toSafeSvgFragmentId(shaped);
    expect(encoded).not.toBe(shaped);
    expect(SAFE_FRAGMENT.test(encoded)).toBe(true);
    expect(toSafeSvgFragmentId('cad-fade')).not.toBe(toSafeSvgFragmentId('cad-fadf'));
  });
});

describe('SEC-182 paint contract', () => {
  it('accepts every paint form actually emitted by the exporter', () => {
    for (const paint of ['#ffffff', '#fff', '#ffff', '#11223344', 'none', 'transparent', 'currentColor', 'red', 'darkslategray', 'rgb(1,2,3)', 'rgba(1, 2, 3, 0.5)', 'hsl(200, 50%, 50%)']) {
      expect(isSafeSvgPaint(paint), paint).toBe(true);
      expect(safeSvgPaint(paint, SVG_PAINT_FALLBACK)).toBe(paint);
    }
  });

  it('rejects markup, url() paint servers, and malformed colors', () => {
    for (const paint of ['url(http://evil.example/x.svg#a)', 'url(javascript:alert(1))', '#fff" onload-marker="x', '#12345', 'expression(alert(1))', 'red;background:url(x)', '<script>', 'rgb(calc(1))', '']) {
      expect(isSafeSvgPaint(paint), paint).toBe(false);
      expect(safeSvgPaint(paint, 'none')).toBe('none');
    }
  });

  it('accepts numeric dash arrays and drops anything else', () => {
    for (const dash of ['12 3 2 3', '4 2', '1.5, 2.5', '0']) expect(isSafeSvgDashArray(dash), dash).toBe(true);
    for (const dash of ['url(http://evil.example/x)', '12 3 2 3" onload-marker="x', '4px', 'none', '']) {
      expect(isSafeSvgDashArray(dash), dash).toBe(false);
    }
    const svg = serializeExportSceneToSvg(buildScene(HOSTILE_IDS.slice(0, 1), HOSTILE_PAINT));
    expect(svg).not.toContain('stroke-dasharray');
  });
});

describe('SEC-182 XML escaping', () => {
  it('escapes XML metacharacters exactly once and drops invalid XML characters', () => {
    expect(escapeXml('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;');
    expect(escapeXml('already &amp; escaped')).toBe('already &amp;amp; escaped');
    expect(escapeXml('a\u0000b\u0007c')).toBe('abc');
    expect(escapeXml('\ud800 lone')).toBe('\uFFFD lone');
    expect(escapeXml('pair \ud83d\ude00 ok')).toBe('pair \ud83d\ude00 ok');
  });
});
