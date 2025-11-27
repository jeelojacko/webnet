export const RAD_TO_DEG = 180 / Math.PI;
export const DEG_TO_RAD = Math.PI / 180;
export const SEC_TO_RAD = Math.PI / (180 * 3600);

export const dmsToRad = (dmsStr: string): number => {
  const val = parseFloat(dmsStr);
  if (Number.isNaN(val)) return 0;
  const sign = val < 0 ? -1 : 1;
  const absVal = Math.abs(val);
  const d = Math.floor(absVal);
  const m = Math.floor((absVal - d) * 100);
  const s = ((absVal - d) * 100 - m) * 100;
  const decimalDegrees = d + m / 60 + s / 3600;
  return decimalDegrees * DEG_TO_RAD * sign;
};

export const radToDmsStr = (rad?: number | null): string => {
  if (rad === undefined || rad === null || Number.isNaN(rad)) return '000-00-00.0';
  let deg = rad * RAD_TO_DEG;
  deg %= 360;
  if (deg < 0) deg += 360;
  const d = Math.floor(deg);
  const rem1 = (deg - d) * 60;
  const m = Math.floor(rem1);
  const s = (rem1 - m) * 60;
  return `${d.toString().padStart(3, '0')}-${m.toString().padStart(2, '0')}-${s
    .toFixed(1)
    .padStart(4, '0')}`;
};
