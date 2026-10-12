const padInteger = (value: number, width: number): string => value.toString().padStart(width, '0');

export const formatCadBearing = (azimuthDeg: number): string => {
  const normalized = ((azimuthDeg % 360) + 360) % 360;
  let prefix: 'N' | 'S' = 'N';
  let suffix: 'E' | 'W' = 'E';
  let angle = normalized;
  if (normalized <= 90) {
    prefix = 'N';
    suffix = 'E';
    angle = normalized;
  } else if (normalized <= 180) {
    prefix = 'S';
    suffix = 'E';
    angle = 180 - normalized;
  } else if (normalized <= 270) {
    prefix = 'S';
    suffix = 'W';
    angle = normalized - 180;
  } else {
    prefix = 'N';
    suffix = 'W';
    angle = 360 - normalized;
  }

  let degrees = Math.floor(angle);
  let minutesFloat = (angle - degrees) * 60;
  let minutes = Math.floor(minutesFloat);
  let seconds = (minutesFloat - minutes) * 60;

  // Keep formatted bearing stable when floating point lands on carry boundaries.
  if (seconds >= 59.995) {
    seconds = 0;
    minutes += 1;
  }
  if (minutes >= 60) {
    minutes = 0;
    degrees += 1;
  }
  if (degrees > 90) {
    degrees = 90;
    minutes = 0;
    seconds = 0;
  }

  return `${prefix}${padInteger(degrees, 2)}-${padInteger(minutes, 2)}-${seconds
    .toFixed(2)
    .padStart(5, '0')}${suffix}`;
};
