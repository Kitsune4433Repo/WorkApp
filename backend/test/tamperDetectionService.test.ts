import { describe, expect, it } from 'vitest';
import { detectTamper, TAMPER_CLOCK_SKEW_MS } from '../src/services/tamperDetectionService';

describe('detectTamper', () => {
  const now = new Date('2026-01-01T12:00:00Z');

  it('does not flag a device clock that matches server time', () => {
    expect(detectTamper(now, now)).toEqual({ flagged: false });
  });

  it('does not flag a device clock within the skew tolerance', () => {
    const deviceTime = new Date(now.getTime() - (TAMPER_CLOCK_SKEW_MS - 1000));
    expect(detectTamper(deviceTime, now).flagged).toBe(false);
  });

  it('flags a device clock that is far behind server time', () => {
    const deviceTime = new Date(now.getTime() - (TAMPER_CLOCK_SKEW_MS + 60_000));
    const result = detectTamper(deviceTime, now);
    expect(result.flagged).toBe(true);
    expect(result.reason).toMatch(/^device_clock_skew_\d+s$/);
  });

  it('flags a device clock that is far ahead of server time', () => {
    const deviceTime = new Date(now.getTime() + (TAMPER_CLOCK_SKEW_MS + 60_000));
    expect(detectTamper(deviceTime, now).flagged).toBe(true);
  });

  it('flags exactly at the boundary as not-flagged (inclusive tolerance)', () => {
    const deviceTime = new Date(now.getTime() - TAMPER_CLOCK_SKEW_MS);
    expect(detectTamper(deviceTime, now).flagged).toBe(false);
  });
});
