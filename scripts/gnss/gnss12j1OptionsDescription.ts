/**
 * Phase 12J.1 Batch A §5 — EVIDENCE ONLY.
 *
 * Frozen record of EVERY RTKLIB option in effect for the S32 broadcast run.
 * Values were read from the pinned source (/tmp/rtklib-evidence 62d4677):
 * struct defaults in src/rtkcmn.c `prcopt_default` + solopt_default, field
 * order from the `prcopt_t` typedef in src/rtklib.h, CLI overrides in
 * app/consapp/rnx2rtkp/rnx2rtkp.c main(). No reliance on undocumented
 * defaults — each entry states its value and where it came from.
 *
 * Usage: npx tsx scripts/gnss/gnss12j1OptionsDescription.ts [--json]
 */
export interface OptionEntry {
  value: string;
  source: string;
}

export const S32_COMMAND =
  'rnx2rtkp -p 3 -f 2 -m 15 -sys G -v 3.0 -ti 30 ' +
  '-ts 2006/06/14 17:24:30 -te 2006/06/14 18:10:30 -e -t -o OUT ' +
  '-r -1283634.1259 -4726427.8882 4074798.0251 ' +
  '01241653.06o p0411650_2.06o 01241653.06n p0411650_2.06n';

export const S32_OPTIONS: Record<string, OptionEntry> = {
  'mode (PMODE_STATIC=3)': { value: 'static', source: 'CLI -p 3 (rnx2rtkp.c; default would be KINEMA)' },
  'soltype': { value: 'forward (0)', source: 'prcopt_default (no -b/-c given)' },
  'nf (freqs)': { value: '2 (L1+L2)', source: 'CLI -f 2 (default is also 2)' },
  'navsys': { value: 'GPS-only', source: 'CLI -sys G (default GPS+GLO+GAL+BDS)' },
  'elmin (mask)': { value: '15 deg', source: 'CLI -m 15 (default is also 15 deg)' },
  'snrmask': { value: 'off (all 0)', source: 'prcopt_default' },
  'sateph (ephemeris)': { value: 'broadcast (EPHOPT_BRDC=0)', source: 'prcopt_default (SP3 leg not used here)' },
  'modear (AR mode)': { value: 'continuous (1)', source: 'prcopt_default (no -i/-h given)' },
  'glomodear': { value: 'on (1)', source: 'rnx2rtkp.c init (irrelevant: GPS-only)' },
  'arfilter': { value: 'on (1)', source: 'prcopt_default' },
  'thresar[0] (AR ratio)': { value: '3.0', source: 'CLI -v 3.0 (equals default 3.0)' },
  'thresar[1..7]': { value: '0.25,0,1E-9,1E-5,3.0,3.0,0', source: 'prcopt_default' },
  'maxout/minlock/minfixsats/minholdsats/mindropsats/minfix': { value: '20/0/4/5/10/20', source: 'prcopt_default' },
  'armaxiter': { value: '1', source: 'prcopt_default' },
  'ionoopt': { value: 'broadcast (IONOOPT_BRDC=1)', source: 'prcopt_default' },
  'tropopt': { value: 'Saastamoinen (TROPOPT_SAAS=1)', source: 'prcopt_default' },
  'dynamics': { value: 'on (1)', source: 'prcopt_default (static mode holds position regardless)' },
  'tidecorr (earth tide)': { value: 'off (0)', source: 'prcopt_default' },
  'niter/codesmooth/intpref/sbascorr': { value: '1/0/0/0', source: 'prcopt_default' },
  'eratio (code/phase)': { value: '300 x4', source: 'prcopt_default' },
  'err[] (obs error)': { value: '[100, 0.003, 0.003, 0, 1.0, 52.0, 0, 0]', source: 'prcopt_default' },
  'std[] (init)': { value: '[30.0, 0.03, 0.3]', source: 'prcopt_default' },
  'prn[] (proc noise)': { value: '[1E-4, 1E-3, 1E-4, 1E-1, 1E-2, 0]', source: 'prcopt_default' },
  'sclkstab': { value: '5E-12', source: 'prcopt_default' },
  'elmaskar/elmaskhold/thresslip/thresdop': { value: '0/0/0.05/0', source: 'prcopt_default' },
  'varholdamb/gainholdamb/maxtdif': { value: '0.1/0.01/30.0', source: 'prcopt_default' },
  'maxinno (phase/code)': { value: '5.0/30.0 m', source: 'prcopt_default' },
  'refpos/rovpos (base pos mode)': { value: 'XYZ (1)', source: 'CLI -r sets POSOPT_POS_XYZ (default SINGLE avg)' },
  'rb (base XYZ)': { value: '-1283634.1259 -4726427.8882 4074798.0251', source: 'CLI -r (P041 RINEX header approx)' },
  'anttype/antdel/pcv': { value: 'empty/zero/none — NO PCV, NO height reduction', source: 'prcopt_default (no -k config, no ANTEX)' },
  'exsats': { value: 'none excluded', source: 'prcopt_default' },
  'maxaveep/initrst': { value: '1/1', source: 'prcopt_default' },
  'posf (output frame)': { value: 'ECEF XYZ', source: 'CLI -e (default LLH)' },
  'timef/times': { value: 'GPST calendar + week/sec', source: 'CLI -t sets timef=1; times default GPST' },
  'tint (interval)': { value: '30 s', source: 'CLI -ti 30' },
  'ts/te (window)': { value: '2006/06/14 17:24:30–18:10:30 GPS', source: 'CLI -ts/-te' },
};

const asMain = process.argv[1]?.endsWith('gnss12j1OptionsDescription.ts') ?? false;
if (asMain) {
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ command: S32_COMMAND, options: S32_OPTIONS }, null, 2));
  } else {
    console.log(`command: ${S32_COMMAND}\n`);
    for (const [k, e] of Object.entries(S32_OPTIONS)) {
      console.log(`${k} = ${e.value}   [${e.source}]`);
    }
  }
}
