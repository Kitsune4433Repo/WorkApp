import { describe, expect, it } from 'vitest';
import {
  getPayrollPeriodContaining,
  getPreviousPeriod,
  getFinalizeDeadline,
  ymdToDateString,
} from '../src/services/payrollPeriodService';

// Reference instants below are constructed as UTC noon on a given calendar day, which is always
// still the same calendar day in America/Chicago (UTC-5/-6) — safe for picking "a moment during
// this Chicago date" without needing to reason about the exact Chicago offset.
function utcNoonOn(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

describe('getPayrollPeriodContaining', () => {
  it('a Tuesday mid-week falls in the Thursday-Wednesday period that contains it', () => {
    // 2026-08-18 is a Tuesday; the containing period is Thu Aug 13 - Wed Aug 19, 2026 — matching
    // the exact example date range from the original request.
    const period = getPayrollPeriodContaining(utcNoonOn(2026, 8, 18));
    expect(period.startYMD).toEqual({ year: 2026, month: 8, day: 13 });
    expect(period.endYMD).toEqual({ year: 2026, month: 8, day: 19 });
    expect(period.label).toBe('August 13th-19th');
  });

  it('a Thursday itself starts a new period, not the one before it', () => {
    // 2026-08-20 is a Thursday.
    const period = getPayrollPeriodContaining(utcNoonOn(2026, 8, 20));
    expect(period.startYMD).toEqual({ year: 2026, month: 8, day: 20 });
    expect(period.endYMD).toEqual({ year: 2026, month: 8, day: 26 });
  });

  it('a Wednesday still belongs to the period that started the prior Thursday', () => {
    // 2026-08-19 is the Wednesday closing out the Aug 13 period.
    const period = getPayrollPeriodContaining(utcNoonOn(2026, 8, 19));
    expect(period.startYMD).toEqual({ year: 2026, month: 8, day: 13 });
  });

  it('formats a period spanning two months with the end month named explicitly', () => {
    // Thu Aug 27 - Wed Sep 2, 2026.
    const period = getPayrollPeriodContaining(utcNoonOn(2026, 8, 29));
    expect(period.startYMD).toEqual({ year: 2026, month: 8, day: 27 });
    expect(period.endYMD).toEqual({ year: 2026, month: 9, day: 2 });
    expect(period.label).toBe('August 27th-September 2nd');
  });

  it('produces correct UTC instants across a period that crosses the US fall DST transition', () => {
    // Thu Oct 29 - Wed Nov 4, 2026; DST ends (clocks fall back) on Sun Nov 1, 2026.
    const period = getPayrollPeriodContaining(utcNoonOn(2026, 11, 1));
    expect(period.startYMD).toEqual({ year: 2026, month: 10, day: 29 });
    expect(period.endYMD).toEqual({ year: 2026, month: 11, day: 4 });
    // Period boundaries must still be exactly midnight Chicago time on each side of the transition,
    // i.e. exactly 7*24h apart in UTC only if there were no DST shift — since there is one, the gap
    // should be 7 days + 1 extra hour (falling back adds an hour to that calendar week).
    const hoursBetween = (period.end.getTime() - period.start.getTime()) / (60 * 60 * 1000);
    expect(hoursBetween).toBe(7 * 24 + 1);
  });
});

describe('getPreviousPeriod', () => {
  it('steps back exactly one week', () => {
    const period = getPayrollPeriodContaining(utcNoonOn(2026, 8, 18));
    const prev = getPreviousPeriod(period);
    expect(prev.startYMD).toEqual({ year: 2026, month: 8, day: 6 });
    expect(prev.endYMD).toEqual({ year: 2026, month: 8, day: 12 });
  });
});

describe('getFinalizeDeadline', () => {
  it('is 11pm Chicago time on the period\'s closing Wednesday', () => {
    const period = getPayrollPeriodContaining(utcNoonOn(2026, 8, 18));
    const deadline = getFinalizeDeadline(period);
    // Aug 19 2026 is during CDT (UTC-5), so 23:00 Chicago = 04:00 UTC the next day.
    expect(deadline.toISOString()).toBe('2026-08-20T04:00:00.000Z');
  });

  it('a moment just before the deadline is not yet past it, and just after is', () => {
    const period = getPayrollPeriodContaining(utcNoonOn(2026, 8, 18));
    const deadline = getFinalizeDeadline(period);
    expect(new Date(deadline.getTime() - 1000) < deadline).toBe(true);
    expect(new Date(deadline.getTime() + 1000) > deadline).toBe(true);
  });
});

describe('ymdToDateString', () => {
  it('zero-pads month and day', () => {
    expect(ymdToDateString({ year: 2026, month: 9, day: 2 })).toBe('2026-09-02');
  });
});
