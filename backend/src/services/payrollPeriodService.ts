import { pool } from '../config/database';

// Payroll weeks run Thursday 00:00 through the following Wednesday 23:59:59, evaluated in the
// crew's local timezone (Memphis, TN — same default used for the dispatch map). Node ships the IANA
// tz database, so Intl.DateTimeFormat handles DST transitions correctly without an extra dependency.
const TZ = 'America/Chicago';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

interface YMD {
  year: number;
  month: number; // 1-12
  day: number;
}

export interface PayrollPeriod {
  start: Date; // UTC instant of Thursday 00:00 in TZ
  end: Date; // UTC instant of the *next* Thursday 00:00 in TZ (exclusive upper bound)
  startYMD: YMD; // Thursday
  endYMD: YMD; // Wednesday (inclusive)
  label: string; // e.g. "August 13th-19th"
}

// How far a timezone's wall clock reads ahead of a given UTC instant, in ms — used to convert a
// local wall-clock date/time into the correct UTC instant, correctly across DST transitions.
function getOffsetMs(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(instant).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - instant.getTime();
}

function zonedWallTimeToUtc(y: number, m: number, d: number, h: number, min: number, s: number, timeZone: string): Date {
  let guess = Date.UTC(y, m - 1, d, h, min, s);
  // Two passes converge even right at a DST boundary, where the offset itself depends on the answer.
  for (let i = 0; i < 2; i++) {
    guess = Date.UTC(y, m - 1, d, h, min, s) - getOffsetMs(new Date(guess), timeZone);
  }
  return new Date(guess);
}

function getZonedDateParts(instant: Date, timeZone: string): YMD & { weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return { year: +parts.year, month: +parts.month, day: +parts.day, weekday: WEEKDAY_INDEX[parts.weekday] };
}

function addDays(ymd: YMD, delta: number): YMD {
  const dt = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + delta));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

function ordinal(n: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
}

function formatLabel(start: YMD, end: YMD): string {
  const startStr = `${MONTH_NAMES[start.month - 1]} ${ordinal(start.day)}`;
  const endStr = start.month === end.month ? ordinal(end.day) : `${MONTH_NAMES[end.month - 1]} ${ordinal(end.day)}`;
  return `${startStr}-${endStr}`;
}

export function ymdToDateString(ymd: YMD): string {
  return `${ymd.year}-${String(ymd.month).padStart(2, '0')}-${String(ymd.day).padStart(2, '0')}`;
}

/** The Thu-Wed payroll period that contains the given instant (defaults to now). */
export function getPayrollPeriodContaining(instant: Date = new Date()): PayrollPeriod {
  const { year, month, day, weekday } = getZonedDateParts(instant, TZ);
  const daysSinceThursday = (weekday - 4 + 7) % 7; // Thursday = 4
  const startYMD = addDays({ year, month, day }, -daysSinceThursday);
  const endYMD = addDays(startYMD, 6); // inclusive Wednesday
  const nextStartYMD = addDays(startYMD, 7);
  return {
    start: zonedWallTimeToUtc(startYMD.year, startYMD.month, startYMD.day, 0, 0, 0, TZ),
    end: zonedWallTimeToUtc(nextStartYMD.year, nextStartYMD.month, nextStartYMD.day, 0, 0, 0, TZ),
    startYMD,
    endYMD,
    label: formatLabel(startYMD, endYMD),
  };
}

export function getPreviousPeriod(period: PayrollPeriod): PayrollPeriod {
  return getPayrollPeriodContaining(new Date(period.start.getTime() - 1));
}

/** Wednesday 11:00pm of a period's own week — the close-out moment for that period. */
export function getFinalizeDeadline(period: PayrollPeriod): Date {
  return zonedWallTimeToUtc(period.endYMD.year, period.endYMD.month, period.endYMD.day, 23, 0, 0, TZ);
}

export interface PersonPeriodTotals {
  user_id: string | null;
  full_name: string;
  days_worked: number;
  total_minutes: number;
  earnings_cents: number;
}

/** Only counts completed (clocked-out) shifts — a still-open shift's minutes/earnings are NULL
 * (generated columns) until clock-out, so it can't contribute to a total yet either way. */
export async function computePeriodTotals(period: PayrollPeriod): Promise<{ people: PersonPeriodTotals[]; totalWageCents: number }> {
  const { rows } = await pool.query<PersonPeriodTotals>(
    `SELECT u.id AS user_id, u.full_name,
            COUNT(DISTINCT (t.clock_in_at AT TIME ZONE 'America/Chicago')::date)::int AS days_worked,
            COALESCE(SUM(t.total_minutes), 0)::int AS total_minutes,
            COALESCE(SUM(t.earnings_cents), 0)::bigint AS earnings_cents
       FROM timecards t
       JOIN users u ON u.id = t.user_id
      WHERE t.clock_out_at IS NOT NULL
        AND t.clock_in_at >= $1 AND t.clock_in_at < $2
      GROUP BY u.id, u.full_name
      ORDER BY u.full_name`,
    [period.start.toISOString(), period.end.toISOString()],
  );
  const totalWageCents = rows.reduce((sum, r) => sum + Number(r.earnings_cents), 0);
  return { people: rows, totalWageCents };
}

/** Archives a period's totals under its date-range label (e.g. "August 13th-19th"). Idempotent —
 * ON CONFLICT (period_start) DO NOTHING, so calling this again for an already-archived period is a
 * harmless no-op rather than a duplicate. */
export async function finalizePeriod(period: PayrollPeriod): Promise<void> {
  const { people, totalWageCents } = await computePeriodTotals(period);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO payroll_periods (period_start, period_end, label, total_wage_cents)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (period_start) DO NOTHING
       RETURNING id`,
      [ymdToDateString(period.startYMD), ymdToDateString(period.endYMD), period.label, totalWageCents],
    );
    if (rows.length) {
      const periodId = rows[0].id;
      for (const p of people) {
        await client.query(
          `INSERT INTO payroll_period_entries (period_id, user_id, user_full_name_snapshot, days_worked, total_minutes, earnings_cents)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [periodId, p.user_id, p.full_name, p.days_worked, p.total_minutes, p.earnings_cents],
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Render's free web plan can spin the dyno down when idle, so a wall-clock cron firing at exactly
// 11pm Wednesday isn't guaranteed. Instead this self-heals: called on boot, on an in-process
// interval while the dyno is awake, and opportunistically on incoming requests, it walks backward
// from the current period finalizing any period whose own Wed-11pm deadline has passed and that
// isn't archived yet — so the moment anything wakes the service after the deadline, it catches up.
export async function ensurePastPeriodsFinalized(): Promise<void> {
  const now = new Date();
  let period = getPayrollPeriodContaining(now);
  for (let i = 0; i < 12; i++) {
    if (now >= getFinalizeDeadline(period)) {
      const { rows } = await pool.query(`SELECT 1 FROM payroll_periods WHERE period_start = $1`, [ymdToDateString(period.startYMD)]);
      if (rows.length) break; // this and everything earlier is already archived
      await finalizePeriod(period);
    }
    period = getPreviousPeriod(period);
  }
}
