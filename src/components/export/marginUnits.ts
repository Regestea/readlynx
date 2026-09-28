export const INCH_MIN = 0;
export const INCH_MAX = 2.4;
export const MM_PER_INCH = 25.4;

export const toInches = (mm: number): number => Math.round((mm / MM_PER_INCH) * 100) / 100;
export const toMm = (inch: number): number => Math.round(inch * MM_PER_INCH * 100) / 100;

export const clampInches = (value: number): number =>
  Math.min(INCH_MAX, Math.max(INCH_MIN, Number.isFinite(value) ? value : INCH_MIN));