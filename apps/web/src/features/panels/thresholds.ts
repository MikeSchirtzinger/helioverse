import type { MetricSeverity, ThresholdBand } from './types';

export const severityColors: Record<MetricSeverity, string> = {
  quiet: '#79e6a3',
  elevated: '#f6d365',
  storm: '#ff9f43',
  severe: '#ff5c7a',
  unknown: '#95a3b8',
};

export const metricThresholds = {
  bz: [
    { label: 'North/weak', min: 0, severity: 'quiet', color: severityColors.quiet },
    { label: 'Southward', min: -10, max: 0, severity: 'elevated', color: severityColors.elevated },
    { label: 'Strong southward', min: -20, max: -10, severity: 'storm', color: severityColors.storm },
    { label: 'Extreme southward', max: -20, severity: 'severe', color: severityColors.severe },
  ] satisfies ThresholdBand[],
  bt: [
    { label: 'Quiet field', max: 10, severity: 'quiet', color: severityColors.quiet },
    { label: 'Enhanced field', min: 10, max: 20, severity: 'elevated', color: severityColors.elevated },
    { label: 'Storm field', min: 20, max: 35, severity: 'storm', color: severityColors.storm },
    { label: 'Extreme field', min: 35, severity: 'severe', color: severityColors.severe },
  ] satisfies ThresholdBand[],
  speed: [
    { label: 'Slow wind', max: 500, severity: 'quiet', color: severityColors.quiet },
    { label: 'Fast wind', min: 500, max: 650, severity: 'elevated', color: severityColors.elevated },
    { label: 'Storm-speed wind', min: 650, max: 800, severity: 'storm', color: severityColors.storm },
    { label: 'Extreme speed', min: 800, severity: 'severe', color: severityColors.severe },
  ] satisfies ThresholdBand[],
  density: [
    { label: 'Low density', max: 8, severity: 'quiet', color: severityColors.quiet },
    { label: 'Compressed', min: 8, max: 15, severity: 'elevated', color: severityColors.elevated },
    { label: 'Dense sheath', min: 15, max: 30, severity: 'storm', color: severityColors.storm },
    { label: 'Extreme compression', min: 30, severity: 'severe', color: severityColors.severe },
  ] satisfies ThresholdBand[],
  kp: [
    { label: 'Quiet/unsettled', max: 5, severity: 'quiet', color: severityColors.quiet },
    { label: 'G1/G2 watch', min: 5, max: 7, severity: 'elevated', color: severityColors.elevated },
    { label: 'G3 storm', min: 7, max: 8, severity: 'storm', color: severityColors.storm },
    { label: 'G4/G5 storm', min: 8, severity: 'severe', color: severityColors.severe },
  ] satisfies ThresholdBand[],
  dst: [
    { label: 'Quiet ring current', min: -50, severity: 'quiet', color: severityColors.quiet },
    { label: 'Moderate storm', min: -100, max: -50, severity: 'elevated', color: severityColors.elevated },
    { label: 'Intense storm', min: -200, max: -100, severity: 'storm', color: severityColors.storm },
    { label: 'Superstorm', max: -200, severity: 'severe', color: severityColors.severe },
  ] satisfies ThresholdBand[],
  proton_flux: [
    { label: '< S1', max: 10, severity: 'quiet', color: severityColors.quiet },
    { label: 'S1/S2', min: 10, max: 1000, severity: 'elevated', color: severityColors.elevated },
    { label: 'S3', min: 1000, max: 10000, severity: 'storm', color: severityColors.storm },
    { label: 'S4/S5', min: 10000, severity: 'severe', color: severityColors.severe },
  ] satisfies ThresholdBand[],
} as const;

export function classifyByBands(value: number | null, bands: readonly ThresholdBand[]): MetricSeverity {
  if (value === null || Number.isNaN(value)) return 'unknown';
  const band = bands.find((candidate) => {
    const aboveMin = candidate.min === undefined || value >= candidate.min;
    const belowMax = candidate.max === undefined || value < candidate.max;
    return aboveMin && belowMax;
  });
  return band?.severity ?? 'unknown';
}

export function classifyNoaaScale(scale: string | null): MetricSeverity {
  const level = parseNoaaScaleLevel(scale);
  if (level === null) return 'quiet';
  if (level >= 4) return 'severe';
  if (level >= 3) return 'storm';
  if (level >= 1) return 'elevated';
  return 'quiet';
}

export function parseNoaaScaleLevel(scale: string | null): number | null {
  if (!scale) return null;
  const match = /^[RSG]([1-5])$/.exec(scale);
  return match?.[1] ? Number(match[1]) : null;
}

export function worstSeverity(values: MetricSeverity[]): MetricSeverity {
  const order: Record<MetricSeverity, number> = { unknown: 0, quiet: 1, elevated: 2, storm: 3, severe: 4 };
  return values.reduce<MetricSeverity>((worst, value) => (order[value] > order[worst] ? value : worst), 'unknown');
}
