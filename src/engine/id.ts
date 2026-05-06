const FALLBACK_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

const fallbackRandomSegment = (length: number): string => {
  let output = '';
  for (let index = 0; index < length; index += 1) {
    output += FALLBACK_ALPHABET[Math.floor(Math.random() * FALLBACK_ALPHABET.length)];
  }
  return output;
};

export const createStableRuntimeId = (prefix: string): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${fallbackRandomSegment(10)}`;
};
