/**
 * Phase 12E.2 tooling tests — synthetic fixtures only. No vendor files, no
 * intake paths. Fast unit scope (NOT a repeated numerical campaign).
 */
import { describe, expect, it } from 'vitest';
import { parseTbcReport } from '../../scripts/gnss/tbcAdjustmentReport';
import { decodeXlsxSheet } from '../../scripts/gnss/tbcXlsxReader';
import { groupMarksByName, setupCovarianceEcef } from '../../scripts/gnss/tbcParityModel';
import { deflateRawSync } from 'node:zlib';

const MINI_HTML = `<html><head><title>Network Adjustment Report</title></head><body>
<table><tr><td>Name:</td><td>C:\\proj\\Demo.vce</td></tr></table>
<table><tr><th><B>Coordinate System</B></th></tr>
<tr><td>Name:</td><td>US State Plane 1983</td></tr>
<tr><td>Zone:</td><td>Colorado North 0501</td></tr>
<tr><td>Datum:</td><td>NAD 1983 (Conus)</td></tr>
<tr><td>Global reference datum:</td><td>WGS 1984</td></tr>
<tr><td>Geoid:</td><td>GEOID09 (Conus)</td></tr></table>
<table>
<tr><TD><B>Error in Height of Antenna:</B></TD><TD align="right">0.002 m</TD></tr>
<tr><TD><B>Centering Error:</B></TD><TD align="right">0.005 m</TD></tr></table>
<h2>Adjustment Statistics</h2>
<table>
<tr><TD><B>Number of Iterations for Successful Adjustment:</B></TD><TD align="right">2</TD></tr>
<tr><td><b>Network Reference Factor:</b></td><TD align="right">1.10</TD></tr>
<tr><TD><B>Chi Square Test (95%):</B></TD><TD align="right">Failed</TD></tr>
<tr><TD><B>Precision Confidence Level:</B></TD><TD align="right">DRMS</TD></tr>
<tr><TD><B>Degrees of Freedom:</B></TD><TD align="right">228</TD></tr></table>
<table><tr><th>Post Processed Vectors:</th>
<td STYLE="font-weight: bold">Redundancy Number:</td><TD align="right">228.00</TD>
<td STYLE="font-weight: bold">A Priori Scalar:</td><TD align="right">1.00</TD></tr></table>
<h2>Control Point Constraints</h2>
<table><tr><th>Point ID</th></tr>
<tr><td align="left"><a href="#">P041</a></td><td align="center">Local</td>
<td align="right">Fixed</td><td align="right">Fixed</td><td align="right">Fixed</td></tr></table>
<h2>Adjusted ECEF Coordinates</h2>
<table><tr><th>Point ID</th></tr>
<tr><td align="left"><a href="#">P041</a></td>
<td align="right">-1283633.4779</td><td align="right">?</td>
<td align="right">-4726429.1942</td><td align="right">?</td>
<td align="right">4074798.0851</td><td align="right">?</td>
<td align="right">?</td></tr>
<tr><td align="left"><a href="#">PLTC</a></td>
<td align="right">-1240696.0833</td><td align="right">0.003</td>
<td align="right">-4720548.7941</td><td align="right">0.002</td>
<td align="right">4094380.7630</td><td align="right">0.002</td>
<td align="right">0.004</td></tr></table>
<h2>Adjusted GNSS Observations</h2>
<TABLE><TR><TH>Observation ID</TH></TR>
<TR><TD ALIGN="LEFT"><a href="#">TMGO --&gt; PLTC (PV135)</a></TD></TR>
<TR><TD ALIGN="LEFT"><a href="#">P041 --&gt; PLTC (PV165)</a></TD></TR></TABLE>
</body></html>`;

describe('tbcAdjustmentReport (synthetic fixture)', () => {
  it('extracts statistics, constraints, ECEF rows, and obs IDs', () => {
    const report = parseTbcReport(MINI_HTML);
    expect(report.iterations).toBe(2);
    expect(report.refFactor).toBeCloseTo(1.1, 10);
    expect(report.chiSquareText).toBe('Failed');
    expect(report.dof).toBe(228);
    expect(report.gnssRedundancy).toBeCloseTo(228, 10);
    expect(report.aprioriScalar).toBeCloseTo(1, 10);
    expect(report.confidenceMode).toBe('DRMS');
    expect(report.centeringErr).toBeCloseTo(0.005, 10);
    expect(report.antennaErr).toBeCloseTo(0.002, 10);
    expect(report.coordSystem).toBe('US State Plane 1983');
    expect(report.datum).toBe('NAD 1983 (Conus)');
    expect(report.constrainedStation).toBe('P041');
    expect(report.activeObsIds).toEqual(['PV135', 'PV165']);
    expect(report.ecefRows).toHaveLength(2);
    expect(report.p041Ecef?.x).toBeCloseTo(-1283633.4779, 4);
    expect(report.p041Ecef?.y).toBeCloseTo(-4726429.1942, 4);
    expect(report.p041Ecef?.z).toBeCloseTo(4074798.0851, 4);
  });

  it('is tolerant: missing sections decode as null/empty, never throw', () => {
    const report = parseTbcReport('<html><body>empty</body></html>');
    expect(report.dof).toBeNull();
    expect(report.ecefRows).toEqual([]);
    expect(report.activeObsIds).toEqual([]);
    expect(report.constrainedStation).toBeNull();
  });
});

describe('groupMarksByName (synthetic marks)', () => {
  const mark = (id: string, name: string, x: number, y = 0, z = 0) => ({
    id, name, referenceSystemId: '126', x, y, z, line: 1,
  });
  it('merges identical same-NAME coordinates exactly', () => {
    const grouping = groupMarksByName([
      mark('PV1.1', 'AAA', 1, 2, 3),
      mark('PV1.2', 'BBB', 4, 5, 6),
      mark('PV2.1', 'AAA', 1, 2, 3),
    ]);
    expect(grouping.mismatch).toBeNull();
    expect(grouping.groups.size).toBe(2);
    expect(grouping.groups.get('AAA')?.pointIds).toEqual(['PV1.1', 'PV2.1']);
  });

  it('fails closed on same-NAME coordinate mismatch', () => {
    const grouping = groupMarksByName([mark('PV1.1', 'AAA', 1), mark('PV2.1', 'AAA', 1.5)]);
    expect(grouping.mismatch).toContain('AAA');
  });
});

describe('tbcXlsxReader (synthetic zip)', () => {
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    return table;
  })();
  const crc = (data: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of data) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  /** Minimal stored-entry zip builder (test-only). */
  const buildZip = (files: [string, string][]): Buffer => {
    const chunks: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const [name, text] of files) {
      const data = Buffer.from(text, 'utf8');
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(0, 8);
      header.writeUInt32LE(crc(data), 14);
      header.writeUInt32LE(data.length, 18);
      header.writeUInt32LE(data.length, 22);
      header.writeUInt16LE(Buffer.byteLength(name), 26);
      chunks.push(header, Buffer.from(name, 'utf8'), data);
      const entry = Buffer.alloc(46);
      entry.writeUInt32LE(0x02014b50, 0);
      entry.writeUInt32LE(crc(data), 16);
      entry.writeUInt32LE(data.length, 20);
      entry.writeUInt32LE(data.length, 24);
      entry.writeUInt16LE(Buffer.byteLength(name), 28);
      entry.writeUInt32LE(offset, 42);
      central.push(entry, Buffer.from(name, 'utf8'));
      offset += 30 + Buffer.byteLength(name) + data.length;
    }
    const centralStart = offset;
    const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(centralStart, 16);
    return Buffer.concat([...chunks, ...central, end]);
  };

  it('decodes shared-string column A through a stored zip', () => {
    const sheet =
      `<worksheet><sheetData>` +
      `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>3</v></c></row>` +
      `<row r="2"><c r="A2" t="s"><v>1</v></c></row></sheetData></worksheet>`;
    const shared = `<sst><si><t>PV1</t></si><si><t>PV5</t></si></sst>`;
    const zip = buildZip([
      ['xl/worksheets/sheet1.xml', sheet],
      ['xl/sharedStrings.xml', shared],
    ]);
    const grid = decodeXlsxSheet(zip, 'xl/worksheets/sheet1.xml');
    expect(grid[0]?.[0]).toBe('PV1');
    expect(grid[0]?.[1]).toBe('3');
    expect(grid[1]?.[0]).toBe('PV5');
  });

  it('decodes a deflated sheet entry via node:zlib', () => {
    const sheet = `<worksheet><sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData></worksheet>`;
    const raw = deflateRawSync(Buffer.from(sheet, 'utf8'));
    // Build a deflate-entry zip manually around the compressed payload.
    const name = 'xl/worksheets/sheet1.xml';
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(raw.length, 18);
    header.writeUInt32LE(Buffer.byteLength(sheet), 22);
    header.writeUInt16LE(Buffer.byteLength(name), 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(raw.length, 20);
    entry.writeUInt32LE(Buffer.byteLength(sheet), 24);
    entry.writeUInt16LE(Buffer.byteLength(name), 28);
    const centralStart = 30 + Buffer.byteLength(name) + raw.length;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(46 + Buffer.byteLength(name), 12);
    end.writeUInt32LE(centralStart, 16);
    const zip = Buffer.concat([header, Buffer.from(name, 'utf8'), raw, entry, Buffer.from(name, 'utf8'), end]);
    expect(decodeXlsxSheet(zip, name)[0]?.[0]).toBe('7');
  });
});

describe('setupCovarianceEcef (hypothesis sanity)', () => {
  it('is positive-definite-diagonal and symmetric at the equator', () => {
    const cov = setupCovarianceEcef([6378137, 0, 0], [6378137, 0, 0]);
    expect(cov.xx).toBeGreaterThan(0);
    expect(cov.yy).toBeGreaterThan(0);
    expect(cov.zz).toBeGreaterThan(0);
    // Two endpoints summed: horizontal variance 2*0.005^2 at the equator maps to Y/Z.
    expect(cov.yy).toBeCloseTo(2 * 0.005 * 0.005, 12);
    expect(cov.xy).toBeCloseTo(0, 12);
  });
});
