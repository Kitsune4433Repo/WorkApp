// Tamper checks: a device-reported clock-in/out timestamp more than this far from server time is
// flagged for payroll review rather than silently trusted (a manipulated device clock) or silently
// rejected (a technician in a legitimately bad signal area shouldn't lose their punch).
export const TAMPER_CLOCK_SKEW_MS = 2 * 60 * 1000;

export interface TamperResult {
  flagged: boolean;
  reason?: string;
}

export function detectTamper(deviceTime: Date, now: Date = new Date()): TamperResult {
  const skew = Math.abs(now.getTime() - deviceTime.getTime());
  if (skew > TAMPER_CLOCK_SKEW_MS) {
    return { flagged: true, reason: `device_clock_skew_${Math.round(skew / 1000)}s` };
  }
  return { flagged: false };
}
