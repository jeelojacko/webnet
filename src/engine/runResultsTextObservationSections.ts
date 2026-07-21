import { RAD_TO_DEG, radToDmsStr } from './angles';
import type { RunResultsTextContext } from './runResultsTextContext';
import type { AdjustmentResult, Observation } from '../types';

type ObservationSectionContext = Pick<
  RunResultsTextContext,
  'linearUnit' | 'unitScale' | 'aliasRefsForLine' | 'outputObservations' | 'isPreanalysis'
>;

export const appendObservationResidualSections = ({
  lines,
  res,
  context,
}: {
  lines: string[];
  res: AdjustmentResult;
  context: ObservationSectionContext;
}): void => {
  const { linearUnit, unitScale, aliasRefsForLine, outputObservations, isPreanalysis } = context;
    if (!isPreanalysis) {
      lines.push('--- Observations & Residuals ---');
      lines.push(`MDB units: arcsec for angular types; ${linearUnit} for linear types`);
      const autoSideshotObsIds = new Set(
        res.autoSideshotDiagnostics?.candidates.flatMap((c) => [c.angleObsId, c.distObsId]) ?? [],
      );
      const rows: {
        type: string;
        stations: string;
        sourceLine: string;
        obs: string;
        calc: string;
        residual: string;
        stdRes: string;
        redundancy: string;
        localTest: string;
        mdb: string;
        prism: string;
        tag: string;
        stdResAbs: number;
      }[] = [];
      const isAngularType = (type: string) =>
        type === 'angle' ||
        type === 'direction' ||
        type === 'bearing' ||
        type === 'dir' ||
        type === 'zenith';
      const formatMdb = (value: number, angular: boolean): string => {
        if (!Number.isFinite(value)) return 'inf';
        return angular
          ? `${(value * RAD_TO_DEG * 3600).toFixed(2)}"`
          : (value * unitScale).toFixed(4);
      };
      const prismTagForObservation = (obs: Observation): string => {
        if (obs.type !== 'dist' && obs.type !== 'zenith') return '-';
        const correction = obs.prismCorrectionM ?? 0;
        if (!Number.isFinite(correction) || Math.abs(correction) <= 0) return '-';
        const scope = obs.prismScope ?? 'global';
        const sign = correction >= 0 ? '+' : '';
        return `${scope}:${sign}${(correction * unitScale).toFixed(4)}${linearUnit}`;
      };
      outputObservations.forEach((obs) => {
        let stations = '';
        let obsStr = '';
        let calcStr = '';
        let resStr = '';
        const angular = isAngularType(obs.type);
        if (obs.type === 'angle') {
          stations = `${obs.at}-${obs.from}-${obs.to}`;
          obsStr = radToDmsStr(obs.obs);
          calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-';
          resStr =
            obs.residual != null
              ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
              : '-';
        } else if (obs.type === 'direction') {
          const reductionLabel =
            obs.rawCount != null
              ? ` [raw ${obs.rawCount}->1, F1:${obs.rawFace1Count ?? '-'} F2:${obs.rawFace2Count ?? '-'}]`
              : '';
          stations = `${obs.at}-${obs.to} (${obs.setId})${reductionLabel}`;
          obsStr = radToDmsStr(obs.obs);
          calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-';
          resStr =
            obs.residual != null
              ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
              : '-';
        } else if (obs.type === 'dir') {
          stations = `${obs.from}-${obs.to}`;
          obsStr = radToDmsStr(obs.obs);
          calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-';
          resStr =
            obs.residual != null
              ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
              : '-';
        } else if (obs.type === 'dist') {
          stations = `${obs.from}-${obs.to}`;
          obsStr = (obs.obs * unitScale).toFixed(4);
          calcStr = obs.calc != null ? ((obs.calc as number) * unitScale).toFixed(4) : '-';
          resStr = obs.residual != null ? ((obs.residual as number) * unitScale).toFixed(4) : '-';
        } else if (obs.type === 'bearing') {
          stations = `${obs.from}-${obs.to}`;
          obsStr = radToDmsStr(obs.obs);
          calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-';
          resStr =
            obs.residual != null
              ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
              : '-';
        } else if (obs.type === 'zenith') {
          stations = `${obs.from}-${obs.to}`;
          obsStr = radToDmsStr(obs.obs);
          calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-';
          resStr =
            obs.residual != null
              ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
              : '-';
        } else if (obs.type === 'gps') {
          stations = `${obs.from}-${obs.to}`;
          obsStr = `dE=${(obs.obs.dE * unitScale).toFixed(3)}, dN=${(obs.obs.dN * unitScale).toFixed(3)}`;
          calcStr =
            obs.calc != null
              ? `dE=${((obs.calc as { dE: number }).dE * unitScale).toFixed(3)}, dN=${(
                  (obs.calc as { dN: number; dE: number }).dN * unitScale
                ).toFixed(3)}`
              : '-';
          resStr =
            obs.residual != null
              ? `vE=${((obs.residual as { vE: number }).vE * unitScale).toFixed(3)}, vN=${(
                  (obs.residual as { vN: number; vE: number }).vN * unitScale
                ).toFixed(3)}`
              : '-';
        } else if (obs.type === 'lev') {
          stations = `${obs.from}-${obs.to}`;
          obsStr = (obs.obs * unitScale).toFixed(4);
          calcStr = obs.calc != null ? ((obs.calc as number) * unitScale).toFixed(4) : '-';
          resStr = obs.residual != null ? ((obs.residual as number) * unitScale).toFixed(4) : '-';
        }
        stations = `${stations}${aliasRefsForLine(obs.sourceLine)}`;

        const localTest =
          obs.localTestComponents != null
            ? `E:${obs.localTestComponents.passE ? 'PASS' : 'FAIL'} N:${
                obs.localTestComponents.passN ? 'PASS' : 'FAIL'
              }`
            : obs.localTest != null
              ? obs.localTest.pass
                ? 'PASS'
                : 'FAIL'
              : '-';
        const mdb =
          obs.mdbComponents != null
            ? `E=${formatMdb(obs.mdbComponents.mE, angular)}, N=${formatMdb(obs.mdbComponents.mN, angular)}`
            : obs.mdb != null
              ? formatMdb(obs.mdb, angular)
              : '-';
        const stdResAbs = Math.abs(obs.stdRes ?? 0);

        rows.push({
          type: obs.type,
          stations,
          sourceLine: obs.sourceLine != null ? String(obs.sourceLine) : '-',
          obs: obsStr || '-',
          calc: calcStr || '-',
          residual: resStr || '-',
          stdRes:
            obs.stdResComponents != null
              ? `${obs.stdResComponents.tE.toFixed(3)}/${obs.stdResComponents.tN.toFixed(3)}`
              : obs.stdRes != null
                ? obs.stdRes.toFixed(3)
                : '-',
          redundancy:
            typeof obs.redundancy === 'object'
              ? `${obs.redundancy.rE.toFixed(3)}/${obs.redundancy.rN.toFixed(3)}`
              : obs.redundancy != null
                ? obs.redundancy.toFixed(3)
                : '-',
          localTest,
          mdb,
          prism: prismTagForObservation(obs),
          tag: autoSideshotObsIds.has(obs.id) ? 'AUTO-SS' : '-',
          stdResAbs,
        });
      });

      rows.sort((a, b) => b.stdResAbs - a.stdResAbs);
      const suspects = rows
        .filter((r) => r.localTest.includes('FAIL') || r.stdResAbs >= 2)
        .slice(0, 20);

      if (suspects.length > 0) {
        lines.push('--- Top Suspects ---');
        const suspectHeader = {
          rank: '#',
          type: 'Type',
          stations: 'Stations',
          line: 'Line',
          stdRes: 'StdRes',
          local: 'Local',
          mdb: 'MDB',
        };
        const suspectRows = suspects.map((r, idx) => ({
          rank: String(idx + 1),
          type: r.type,
          stations: r.stations,
          line: r.sourceLine,
          stdRes: r.stdRes,
          local: r.localTest,
          mdb: r.mdb,
        }));
        const suspectWidths = {
          rank: Math.max(suspectHeader.rank.length, ...suspectRows.map((r) => r.rank.length)),
          type: Math.max(suspectHeader.type.length, ...suspectRows.map((r) => r.type.length)),
          stations: Math.max(
            suspectHeader.stations.length,
            ...suspectRows.map((r) => r.stations.length),
          ),
          line: Math.max(suspectHeader.line.length, ...suspectRows.map((r) => r.line.length)),
          stdRes: Math.max(suspectHeader.stdRes.length, ...suspectRows.map((r) => r.stdRes.length)),
          local: Math.max(suspectHeader.local.length, ...suspectRows.map((r) => r.local.length)),
          mdb: Math.max(suspectHeader.mdb.length, ...suspectRows.map((r) => r.mdb.length)),
        };
        const pad = (value: string, size: number) => value.padEnd(size, ' ');
        lines.push(
          [
            pad(suspectHeader.rank, suspectWidths.rank),
            pad(suspectHeader.type, suspectWidths.type),
            pad(suspectHeader.stations, suspectWidths.stations),
            pad(suspectHeader.line, suspectWidths.line),
            pad(suspectHeader.stdRes, suspectWidths.stdRes),
            pad(suspectHeader.local, suspectWidths.local),
            pad(suspectHeader.mdb, suspectWidths.mdb),
          ].join('  '),
        );
        suspectRows.forEach((r) => {
          lines.push(
            [
              pad(r.rank, suspectWidths.rank),
              pad(r.type, suspectWidths.type),
              pad(r.stations, suspectWidths.stations),
              pad(r.line, suspectWidths.line),
              pad(r.stdRes, suspectWidths.stdRes),
              pad(r.local, suspectWidths.local),
              pad(r.mdb, suspectWidths.mdb),
            ].join('  '),
          );
        });
        lines.push('');
      }

      if (res.suspectImpactDiagnostics && res.suspectImpactDiagnostics.length > 0) {
        lines.push('--- Suspect Impact Analysis (what-if exclusion) ---');
        const impactRows = res.suspectImpactDiagnostics.map((d, idx) => ({
          rank: String(idx + 1),
          type: d.type,
          stations: d.stations,
          line: d.sourceLine != null ? String(d.sourceLine) : '-',
          baseStdRes: d.baseStdRes != null ? d.baseStdRes.toFixed(2) : '-',
          dSeuw: d.deltaSeuw != null ? d.deltaSeuw.toFixed(4) : '-',
          dMaxStd: d.deltaMaxStdRes != null ? d.deltaMaxStdRes.toFixed(2) : '-',
          chi: d.chiDelta,
          shift: d.maxCoordShift != null ? (d.maxCoordShift * unitScale).toFixed(4) : '-',
          score: d.score != null ? d.score.toFixed(1) : '-',
          status: d.status.toUpperCase(),
        }));
        const impactHeader = {
          rank: '#',
          type: 'Type',
          stations: 'Stations',
          line: 'Line',
          baseStdRes: 'Base|t|',
          dSeuw: 'dSEUW',
          dMaxStd: 'dMax|t|',
          chi: 'ChiDelta',
          shift: `MaxShift(${linearUnit})`,
          score: 'Score',
          status: 'Status',
        };
        const impactWidths = {
          rank: Math.max(impactHeader.rank.length, ...impactRows.map((r) => r.rank.length)),
          type: Math.max(impactHeader.type.length, ...impactRows.map((r) => r.type.length)),
          stations: Math.max(
            impactHeader.stations.length,
            ...impactRows.map((r) => r.stations.length),
          ),
          line: Math.max(impactHeader.line.length, ...impactRows.map((r) => r.line.length)),
          baseStdRes: Math.max(
            impactHeader.baseStdRes.length,
            ...impactRows.map((r) => r.baseStdRes.length),
          ),
          dSeuw: Math.max(impactHeader.dSeuw.length, ...impactRows.map((r) => r.dSeuw.length)),
          dMaxStd: Math.max(
            impactHeader.dMaxStd.length,
            ...impactRows.map((r) => r.dMaxStd.length),
          ),
          chi: Math.max(impactHeader.chi.length, ...impactRows.map((r) => r.chi.length)),
          shift: Math.max(impactHeader.shift.length, ...impactRows.map((r) => r.shift.length)),
          score: Math.max(impactHeader.score.length, ...impactRows.map((r) => r.score.length)),
          status: Math.max(impactHeader.status.length, ...impactRows.map((r) => r.status.length)),
        };
        const pad = (value: string, size: number) => value.padEnd(size, ' ');
        lines.push(
          [
            pad(impactHeader.rank, impactWidths.rank),
            pad(impactHeader.type, impactWidths.type),
            pad(impactHeader.stations, impactWidths.stations),
            pad(impactHeader.line, impactWidths.line),
            pad(impactHeader.baseStdRes, impactWidths.baseStdRes),
            pad(impactHeader.dSeuw, impactWidths.dSeuw),
            pad(impactHeader.dMaxStd, impactWidths.dMaxStd),
            pad(impactHeader.chi, impactWidths.chi),
            pad(impactHeader.shift, impactWidths.shift),
            pad(impactHeader.score, impactWidths.score),
            pad(impactHeader.status, impactWidths.status),
          ].join('  '),
        );
        impactRows.forEach((r) => {
          lines.push(
            [
              pad(r.rank, impactWidths.rank),
              pad(r.type, impactWidths.type),
              pad(r.stations, impactWidths.stations),
              pad(r.line, impactWidths.line),
              pad(r.baseStdRes, impactWidths.baseStdRes),
              pad(r.dSeuw, impactWidths.dSeuw),
              pad(r.dMaxStd, impactWidths.dMaxStd),
              pad(r.chi, impactWidths.chi),
              pad(r.shift, impactWidths.shift),
              pad(r.score, impactWidths.score),
              pad(r.status, impactWidths.status),
            ].join('  '),
          );
        });
        lines.push('');
      }

      const headers = {
        type: 'Type',
        stations: 'Stations',
        sourceLine: 'Line',
        obs: 'Obs',
        calc: 'Calc',
        residual: 'Residual',
        stdRes: 'StdRes',
        redundancy: 'Redund',
        localTest: 'Local',
        mdb: 'MDB',
        prism: 'Prism',
        tag: 'Tag',
      };
      const widths = {
        type: Math.max(headers.type.length, ...rows.map((r) => r.type.length)),
        stations: Math.max(headers.stations.length, ...rows.map((r) => r.stations.length)),
        sourceLine: Math.max(headers.sourceLine.length, ...rows.map((r) => r.sourceLine.length)),
        obs: Math.max(headers.obs.length, ...rows.map((r) => r.obs.length)),
        calc: Math.max(headers.calc.length, ...rows.map((r) => r.calc.length)),
        residual: Math.max(headers.residual.length, ...rows.map((r) => r.residual.length)),
        stdRes: Math.max(headers.stdRes.length, ...rows.map((r) => r.stdRes.length)),
        redundancy: Math.max(headers.redundancy.length, ...rows.map((r) => r.redundancy.length)),
        localTest: Math.max(headers.localTest.length, ...rows.map((r) => r.localTest.length)),
        mdb: Math.max(headers.mdb.length, ...rows.map((r) => r.mdb.length)),
        prism: Math.max(headers.prism.length, ...rows.map((r) => r.prism.length)),
        tag: Math.max(headers.tag.length, ...rows.map((r) => r.tag.length)),
      };
      const pad = (value: string, size: number) => value.padEnd(size, ' ');
      lines.push(
        [
          pad(headers.type, widths.type),
          pad(headers.stations, widths.stations),
          pad(headers.sourceLine, widths.sourceLine),
          pad(headers.obs, widths.obs),
          pad(headers.calc, widths.calc),
          pad(headers.residual, widths.residual),
          pad(headers.stdRes, widths.stdRes),
          pad(headers.redundancy, widths.redundancy),
          pad(headers.localTest, widths.localTest),
          pad(headers.mdb, widths.mdb),
          pad(headers.prism, widths.prism),
          pad(headers.tag, widths.tag),
        ].join('  '),
      );
      rows.forEach((r) => {
        lines.push(
          [
            pad(r.type, widths.type),
            pad(r.stations, widths.stations),
            pad(r.sourceLine, widths.sourceLine),
            pad(r.obs, widths.obs),
            pad(r.calc, widths.calc),
            pad(r.residual, widths.residual),
            pad(r.stdRes, widths.stdRes),
            pad(r.redundancy, widths.redundancy),
            pad(r.localTest, widths.localTest),
            pad(r.mdb, widths.mdb),
            pad(r.prism, widths.prism),
            pad(r.tag, widths.tag),
          ].join('  '),
        );
      });
      lines.push('');
    }
};
