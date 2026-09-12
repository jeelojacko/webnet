/**
 * Phase 12E0 — GVX 1.0 import: covariance-order gate, orientation,
 * version/frame/error semantics, and official-sample determinism.
 *
 * The covariance-order gate uses distinct SD/P values per axis so any
 * implementation swap (XY<->XZ or XZ<->YZ) breaks exact assertions.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importGnssBaselineGvx, parseGvx } from '../../src/engine/gnssGvxImport';
import { parseXmlDocument } from '../../src/engine/gnssGvxXml';

const REF = 'SYNTHETIC-ECEF-TEST';

interface VectorSpec {
  id: string;
  from: string;
  to: string;
  dx: number;
  dy: number;
  dz: number;
  sdx: number;
  sdy: number;
  sdz: number;
  pxy: number;
  pxz: number;
  pyz: number;
}

interface MarkSpec {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
}

const markXml = (mark: MarkSpec, refId = '126', epoch = '2010.0000'): string => `
   <POINT>
      <ID>${mark.id}</ID>
      <NAME>${mark.name}</NAME>
      <EQUIPMENT_ID>00000001</EQUIPMENT_ID>
      <ARP_HEIGHT>0.0000</ARP_HEIGHT>
      <POINT_TYPE>Keyed-in</POINT_TYPE>
      <COORDINATES>
         <REFERENCE_SYSTEM_ID>${refId}</REFERENCE_SYSTEM_ID>
         <EPOCH>${epoch}</EPOCH>
         <GEODETIC_COORDINATES>
            <LATITUDE>39.0</LATITUDE>
            <LONGITUDE>-77.0</LONGITUDE>
            <ELLIPSOIDAL_HEIGHT>100.0</ELLIPSOIDAL_HEIGHT>
         </GEODETIC_COORDINATES>
         <GEOCENTRIC_COORDINATES>
            <X>${mark.x}</X>
            <Y>${mark.y}</Y>
            <Z>${mark.z}</Z>
         </GEOCENTRIC_COORDINATES>
      </COORDINATES>
   </POINT>`;

const vectorXml = (vector: VectorSpec): string => `
   <GNSS_VECTOR>
      <ID>${vector.id}</ID>
      <INITIAL_POINT_ID>${vector.from}</INITIAL_POINT_ID>
      <TERMINAL_POINT_ID>${vector.to}</TERMINAL_POINT_ID>
      <ECEF_DELTAS>
         <DX>${vector.dx}</DX>
         <DY>${vector.dy}</DY>
         <DZ>${vector.dz}</DZ>
      </ECEF_DELTAS>
      <CORRELATION_MATRIX>
         <SDX>${vector.sdx}</SDX>
         <SDY>${vector.sdy}</SDY>
         <SDZ>${vector.sdz}</SDZ>
         <PXY>${vector.pxy}</PXY>
         <PXZ>${vector.pxz}</PXZ>
         <PYZ>${vector.pyz}</PYZ>
      </CORRELATION_MATRIX>
   </GNSS_VECTOR>`;

export const buildGvx = (
  marks: MarkSpec[],
  vectors: VectorSpec[],
  options?: { version?: string; refId?: string; refName?: string; epoch?: string },
): string => {
  const version = options?.version ?? '1.0';
  const refId = options?.refId ?? '126';
  const refName = options?.refName ?? REF;
  const epoch = options?.epoch ?? '2010.0000';
  return `<?xml version="1.0" encoding="utf-8"?>\n<GVX VERSION="${version}">\n   <REFERENCE_SYSTEM>\n      <ID>${refId}</ID>\n      <NAME>${refName}</NAME>\n      <LINEAR_UNIT><NAME>meters</NAME></LINEAR_UNIT>\n      <ANGULAR_UNIT><NAME>decimal degrees</NAME></ANGULAR_UNIT>\n   </REFERENCE_SYSTEM>\n${marks.map((mark) => markXml(mark, refId, epoch)).join('')}${vectors.map(vectorXml).join('')}\n</GVX>\n`;
};

const A: MarkSpec = { id: 'A', name: 'STA-A', x: 3779000.0, y: 150000.0, z: 5121000.0 };
const B: MarkSpec = { id: 'B', name: 'STA-B', x: 3780234.577, y: 149765.855, z: 5121345.89 };

const V1: VectorSpec = {
  id: 'V1', from: 'A', to: 'B',
  dx: 1234.567, dy: -234.125, dz: 345.875,
  sdx: 0.002, sdy: 0.003, sdz: 0.004,
  pxy: 0.5, pxz: -0.25, pyz: 0.125,
};

const errorsOf = (text: string) =>
  parseGvx(text).diagnostics.filter((diagnostic) => diagnostic.severity === 'error');

describe('gvx covariance-order gate', () => {
  it('reconstructs Cxx=SDX^2, Cxy=PXY*SDX*SDY exactly (any XY/XZ/YZ swap breaks)', () => {
    const parsed = parseGvx(buildGvx([A, B], [V1]));
    expect(parsed.network).not.toBeNull();
    const baseline = parsed.network!.baselines[0]!;
    expect(baseline.covariance.xx).toBe(0.002 * 0.002);
    expect(baseline.covariance.yy).toBe(0.003 * 0.003);
    expect(baseline.covariance.zz).toBe(0.004 * 0.004);
    expect(baseline.covariance.xy).toBe(0.5 * 0.002 * 0.003);
    expect(baseline.covariance.xz).toBe(-0.25 * 0.002 * 0.004);
    expect(baseline.covariance.yz).toBe(0.125 * 0.003 * 0.004);
  });

  it('holds the gate on a second sign-flipped vector', () => {
    const v2: VectorSpec = {
      ...V1, id: 'V2', sdx: 0.005, sdy: 0.0025, sdz: 0.0035,
      pxy: -0.6, pxz: 0.35, pyz: -0.15,
    };
    const parsed = parseGvx(buildGvx([A, B], [V1, v2]));
    expect(parsed.network).not.toBeNull();
    const second = parsed.network!.baselines[1]!;
    expect(second.covariance.xy).toBe(-0.6 * 0.005 * 0.0025);
    expect(second.covariance.xz).toBe(0.35 * 0.005 * 0.0035);
    expect(second.covariance.yz).toBe(-0.15 * 0.0025 * 0.0035);
  });
});

describe('gvx orientation', () => {
  it('applies b_obs = X_TO - X_FROM directly (INITIAL -> TERMINAL)', () => {
    const parsed = parseGvx(buildGvx([A, B], [V1]));
    const baseline = parsed.network!.baselines[0]!;
    expect(baseline.from).toBe('A');
    expect(baseline.to).toBe('B');
    expect(baseline.vector).toEqual({ x: 1234.567, y: -234.125, z: 345.875 });
    // Reversed endpoints observe the negated vector, not a reordered one.
    const flipped: VectorSpec = { ...V1, id: 'V1R', from: 'B', to: 'A', dx: -1234.567, dy: 234.125, dz: -345.875 };
    const reparsed = parseGvx(buildGvx([A, B], [flipped]));
    expect(reparsed.network!.baselines[0]!.vector).toEqual({ x: -1234.567, y: 234.125, z: -345.875 });
  });
});

describe('gvx version gate', () => {
  it.each(['2.0', '1.1', ''])('rejects VERSION=%j fail-closed', (version) => {
    const parsed = parseGvx(buildGvx([A, B], [V1], { version }));
    expect(parsed.network).toBeNull();
    expect(parsed.diagnostics.some((d) => d.code === 'GNSS_GVX_UNSUPPORTED_VERSION')).toBe(true);
  });

  it('rejects a missing VERSION attribute', () => {
    const text = buildGvx([A, B], [V1]).replace(' VERSION="1.0"', '');
    const parsed = parseGvx(text);
    expect(parsed.network).toBeNull();
    expect(parsed.diagnostics.some((d) => d.code === 'GNSS_GVX_UNSUPPORTED_VERSION')).toBe(true);
  });
});

describe('gvx XML security', () => {
  it('rejects DOCTYPE/ENTITY declarations (no XXE)', () => {
    const text = buildGvx([A, B], [V1]).replace(
      '<GVX VERSION="1.0">',
      '<!DOCTYPE GVX [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>\n<GVX VERSION="1.0">',
    );
    const parsed = parseGvx(text);
    expect(parsed.network).toBeNull();
    expect(parsed.diagnostics.some((d) => d.code === 'GNSS_GVX_BAD_XML')).toBe(true);
  });

  it('decodes exactly the 5 predefined entities in text and attributes', () => {
    const doc = parseXmlDocument('<R NOTE="a&lt;b&gt;&quot;c&quot;&apos;d&apos;&amp;e">x&amp;y&lt;z&gt;</R>');
    expect(doc.attrs['NOTE']).toBe('a<b>"c"\'d\'&e');
    expect(doc.text).toBe('x&y<z>');
    const text = buildGvx([A, B], [V1])
      .replace('STA-A</NAME>', 'STA-&amp;-A</NAME>')
      .replace(' VERSION="1.0"', ' VERSION="1.0" NOTE="a&lt;b&gt;&amp;c"');
    const parsed = parseGvx(text);
    expect(parsed.network).not.toBeNull();
    expect(errorsOf(text)).toHaveLength(0);
  });

  it.each([
    { label: 'custom entity', token: '&foo;' },
    { label: 'decimal numeric entity', token: '&#65;' },
    { label: 'hex numeric entity', token: '&#x41;' },
    { label: 'unterminated entity', token: '&amp' },
    { label: 'bare ampersand', token: '& then' },
    { label: 'prototype entity __proto__', token: '&__proto__;' },
    { label: 'prototype entity constructor', token: '&constructor;' },
    { label: 'prototype entity toString', token: '&toString;' },
    { label: 'prototype entity hasOwnProperty', token: '&hasOwnProperty;' },
  ])('rejects $label with GNSS_GVX_BAD_XML', ({ token }) => {
    const text = buildGvx([A, B], [V1]).replace('STA-A</NAME>', `STA-${token}A</NAME>`);
    expect(errorsOf(text).length).toBeGreaterThan(0);
    expect(parseGvx(text).network).toBeNull();
  });

  it('rejects forbidden entities in attribute values', () => {
    const text = buildGvx([A, B], [V1]).replace(' VERSION="1.0"', ' VERSION="1.0" NOTE="&foo;"');
    expect(errorsOf(text).length).toBeGreaterThan(0);
  });

  it('leaves CDATA content literal (no entity decoding)', () => {
    const doc = parseXmlDocument('<R><![CDATA[STA-&amp;-A]]></R>');
    expect(doc.text).toBe('STA-&amp;-A');
    const text = buildGvx([A, B], [V1]).replace('STA-A</NAME>', '<![CDATA[STA-A]]></NAME>');
    const parsed = parseGvx(text);
    expect(parsed.network).not.toBeNull();
    expect(errorsOf(text)).toHaveLength(0);
  });

  it('accepts raw > inside quoted attribute values', () => {
    const doc = parseXmlDocument('<R NOTE="a>b">x</R>');
    expect(doc.attrs['NOTE']).toBe('a>b');
    const text = buildGvx([A, B], [V1]).replace(' VERSION="1.0"', ' VERSION="1.0" NOTE="a>b"');
    expect(parseGvx(text).network).not.toBeNull();
    expect(errorsOf(text)).toHaveLength(0);
  });

  it('still fails closed on truly unterminated tags/quotes', () => {
    const unterminatedAttr = buildGvx([A, B], [V1]).replace(' VERSION="1.0"', ' VERSION="1.0" NOTE="abc');
    expect(errorsOf(unterminatedAttr).length).toBeGreaterThan(0);
    expect(() => parseXmlDocument('<R NOTE="a>b>')).toThrow();
    expect(() => parseXmlDocument('<R NOTE="abc')).toThrow();
  });

  it('rejects mismatched tags deterministically', () => {
    const text = buildGvx([A, B], [V1]).replace('</DX>', '</DY>');
    const parsed = parseGvx(text);
    expect(parsed.network).toBeNull();
    expect(parsed.diagnostics[0]?.code).toBe('GNSS_GVX_BAD_XML');
  });
});

describe('gvx covariance validation', () => {
  it('passes realistic full covariance through (SPD, no repair)', () => {
    const parsed = parseGvx(buildGvx([A, B], [V1]));
    expect(parsed.network).not.toBeNull();
    expect(errorsOf(buildGvx([A, B], [V1]))).toHaveLength(0);
  });

  it.each([
    { label: 'zero variance', override: { sdx: 0 } },
    { label: 'correlation out of range', override: { pxy: 1.5 } },
    { label: 'non-PD correlations', override: { pxy: 0.99, pxz: -0.99, pyz: 0.99 } },
  ])('rejects $label with GNSS_GVX_BAD_COVARIANCE', ({ override }) => {
    const bad: VectorSpec = { ...V1, ...override };
    const parsed = parseGvx(buildGvx([A, B], [bad]));
    expect(parsed.network).toBeNull();
    expect(parsed.diagnostics.some((d) => d.code === 'GNSS_GVX_BAD_COVARIANCE')).toBe(true);
  });
});

describe('gvx required-field and frame errors', () => {
  it('reports unknown INITIAL mark with path context', () => {
    const bad: VectorSpec = { ...V1, from: 'GHOST' };
    const parsed = parseGvx(buildGvx([A, B], [bad]));
    expect(parsed.network).toBeNull();
    const diagnostic = parsed.diagnostics.find((d) => d.code === 'GNSS_GVX_UNKNOWN_MARK');
    expect(diagnostic?.stationId).toBe('GHOST');
    expect(diagnostic?.message).toContain('GVX/GNSS_VECTOR[1]');
  });

  it('reports unknown TERMINAL mark', () => {
    const bad: VectorSpec = { ...V1, to: 'GHOST' };
    const parsed = parseGvx(buildGvx([A, B], [bad]));
    expect(parsed.network).toBeNull();
    expect(parsed.diagnostics.some((d) => d.code === 'GNSS_GVX_UNKNOWN_MARK')).toBe(true);
  });

  it('rejects a vector without ECEF_DELTAS', () => {
    const text = buildGvx([A, B], [V1]).replace(/<ECEF_DELTAS>.*?<\/ECEF_DELTAS>/s, '');
    const parsed = parseGvx(text);
    expect(parsed.network).toBeNull();
    expect(parsed.diagnostics.some((d) => d.code === 'GNSS_GVX_MISSING_VECTOR_COMPONENT')).toBe(true);
  });

  it('rejects a vector without CORRELATION_MATRIX', () => {
    const text = buildGvx([A, B], [V1]).replace(/<CORRELATION_MATRIX>.*?<\/CORRELATION_MATRIX>/s, '');
    const parsed = parseGvx(text);
    expect(parsed.network).toBeNull();
    expect(parsed.diagnostics.some((d) => d.code === 'GNSS_GVX_MISSING_VECTOR_COMPONENT')).toBe(true);
  });

  it('rejects a mark without GEOCENTRIC coordinates (no geodetic fallback)', () => {
    const text = buildGvx([A, B], [V1]).replace(/<GEOCENTRIC_COORDINATES>.*?<\/GEOCENTRIC_COORDINATES>/s, '');
    const parsed = parseGvx(text);
    expect(parsed.network).toBeNull();
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
  });

  it('rejects mixed point reference frames (no transforms)', () => {
    const withSecondFrame = buildGvx([A, B], [V1]).replace(
      '</REFERENCE_SYSTEM>',
      '</REFERENCE_SYSTEM>\n   <REFERENCE_SYSTEM>\n      <ID>999</ID>\n      <NAME>OTHER</NAME>\n      <LINEAR_UNIT><NAME>meters</NAME></LINEAR_UNIT>\n   </REFERENCE_SYSTEM>',
    );
    const mixed = withSecondFrame.replace(
      '<REFERENCE_SYSTEM_ID>126</REFERENCE_SYSTEM_ID>',
      '<REFERENCE_SYSTEM_ID>999</REFERENCE_SYSTEM_ID>',
    );
    const parsed = parseGvx(mixed);
    expect(parsed.network).toBeNull();
    const diagnostic = parsed.diagnostics.find((d) => d.code === 'GNSS_GVX_FRAME_UNSUPPORTED');
    expect(diagnostic?.message).toContain('mixed point reference frames');
  });

  it('rejects a point frame with no REFERENCE_SYSTEM definition', () => {
    const mixed = buildGvx([A, B], [V1]).replace(
      '<REFERENCE_SYSTEM_ID>126</REFERENCE_SYSTEM_ID>',
      '<REFERENCE_SYSTEM_ID>999</REFERENCE_SYSTEM_ID>',
    );
    const parsed = parseGvx(mixed);
    expect(parsed.network).toBeNull();
    expect(parsed.diagnostics.some((d) => d.code === 'GNSS_GVX_FRAME_UNSUPPORTED')).toBe(true);
  });

  it('rejects mixed point epochs', () => {
    const text = buildGvx([A, B], [V1]).replace(
      '<EPOCH>2010.0000</EPOCH>',
      '<EPOCH>2020.0000</EPOCH>',
    );
    expect(parseGvx(text).diagnostics.some((d) => d.code === 'GNSS_GVX_FRAME_UNSUPPORTED')).toBe(true);
  });

  it('rejects non-metre linear units', () => {
    const text = buildGvx([A, B], [V1]).replace('<NAME>meters</NAME>', '<NAME>US survey feet</NAME>');
    expect(parseGvx(text).diagnostics.some((d) => d.code === 'GNSS_GVX_FRAME_UNSUPPORTED')).toBe(true);
  });
});

describe('gvx endpoint and frame policy', () => {
  it('keeps endpoints FREE with first-seen order and point frame metadata', () => {
    const parsed = parseGvx(buildGvx([B, A], [V1]));
    expect(parsed.network).not.toBeNull();
    expect(Object.keys(parsed.network!.stations)).toEqual(['B', 'A']);
    expect(parsed.network!.stations['A']).toMatchObject({ x: 3779000.0, fixed: false });
    expect(parsed.network!.stations['B']!.fixedX).toBe(false);
    expect(parsed.network!.frame).toMatchObject({ vectorFrame: 'ecef', referenceFrame: REF, epoch: '2010.0000' });
    expect(parsed.network!.inputUnits).toBe('m');
    expect(parsed.source?.orbitFrame).toBeUndefined();
  });

  it('records the orbit frame as provenance without mismatching it', () => {
    const text = buildGvx([A, B], [V1])
      .replace('</REFERENCE_SYSTEM>', '</REFERENCE_SYSTEM>\n   <REFERENCE_SYSTEM>\n      <ID>153</ID>\n      <NAME>IGS14</NAME>\n      <LINEAR_UNIT><NAME>meters</NAME></LINEAR_UNIT>\n   </REFERENCE_SYSTEM>');
    const parsed = parseGvx(text);
    expect(parsed.network).not.toBeNull();
    expect(parsed.source?.orbitFrame).toEqual({ id: '153', name: 'IGS14' });
    expect(parsed.network!.frame.referenceFrame).toBe(REF);
  });

  it('warns on unknown extension metadata, keeps the network', () => {
    const text = buildGvx([A, B], [V1]).replace('</GVX>', '   <VENDOR_BLOB><X>1</X></VENDOR_BLOB>\n</GVX>');
    const parsed = parseGvx(text);
    expect(parsed.network).not.toBeNull();
    const warning = parsed.diagnostics.find((d) => d.code === 'GNSS_GVX_IGNORED_METADATA');
    expect(warning?.severity).toBe('warning');
    expect(warning?.message).toContain('VENDOR_BLOB');
  });

  it('rejects duplicate vector IDs, warns on repeated endpoints, errors on self-baselines', () => {
    const dup: VectorSpec = { ...V1, dx: 1, dy: 2, dz: 3 };
    const dupParsed = importGnssBaselineGvx(buildGvx([A, B], [V1, dup]));
    expect(dupParsed.network).toBeNull();
    expect(dupParsed.diagnostics.some((d) => d.code === 'GNSS_GVX_BAD_XML')).toBe(true);

    const rep: VectorSpec = { ...V1, id: 'V2' };
    const repParsed = importGnssBaselineGvx(buildGvx([A, B], [V1, rep]));
    expect(repParsed.network).not.toBeNull();
    expect(repParsed.network!.baselines).toHaveLength(2);
    expect(repParsed.diagnostics.some((d) => d.code === 'GNSS_GVX_REPEATED_BASELINE')).toBe(true);

    const self: VectorSpec = { ...V1, id: 'V9', to: 'A' };
    const selfParsed = importGnssBaselineGvx(buildGvx([A, B], [self]));
    expect(selfParsed.network).toBeNull();
  });
});

const NOAA_DIR = '/home/jacko/Downloads/webnet-gnss-12e/noaa';

describe.runIf(existsSync(NOAA_DIR))('gvx official-sample determinism', () => {
  const files = ['sample_gvx.xml', '052.jxl_1p0.gvx', '053.jxl_1p0.gvx', '054.jxl_1p0.gvx'];
  it.each(files)('parses %s deterministically vs computed counts', (file) => {
    const text = readFileSync(join(NOAA_DIR, file), 'utf8');
    const expectedVectors = text.split('<GNSS_VECTOR').length - 1;
    const expectedMarks = text.split('<POINT>').length - 1 + text.split('<POINT ').length - 1;
    const first = parseGvx(text, file);
    const second = parseGvx(text, file);
    expect(first.network).not.toBeNull();
    expect(first.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    expect(first.source?.vectorCount).toBe(expectedVectors);
    expect(first.source?.markCount).toBe(expectedMarks);
    // Deterministic: identical canonical output across runs.
    expect(JSON.stringify(second.network)).toBe(JSON.stringify(first.network));
    expect(JSON.stringify(second.source)).toBe(JSON.stringify(first.source));
  });
});
