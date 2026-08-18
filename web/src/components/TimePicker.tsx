const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1-12
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5); // :00, :05, ... :55

interface Props {
  value: string; // "HH:MM" 24-hour, or "" for unset — same contract as <input type="time">
  onChange: (value: string) => void;
  className?: string;
}

function to24Hour(hour12: number, minute: number, period: 'AM' | 'PM'): string {
  const hour24 = period === 'AM' ? (hour12 === 12 ? 0 : hour12) : hour12 === 12 ? 12 : hour12 + 12;
  return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parse(value: string): { hour12: number; minute: number; period: 'AM' | 'PM' } {
  if (!value) return { hour12: 9, minute: 0, period: 'AM' };
  const [h, m] = value.split(':').map(Number);
  const period: 'AM' | 'PM' = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return { hour12, minute: m, period };
}

/** Drop-in for a native <input type="time"> that always shows 12-hour AM/PM controls — native time
 * inputs render in whatever clock format the device is set to (often 24-hour, even on devices set
 * to a 12-hour-speaking locale), which isn't something plain HTML/CSS can override. Still speaks
 * "HH:MM" 24-hour on the outside, so nothing downstream (forms, API payloads) needs to change. */
export function TimePicker({ value, onChange, className }: Props) {
  const { hour12, minute, period } = parse(value);
  const nearestMinute = MINUTES.reduce((best, m) => (Math.abs(m - minute) < Math.abs(best - minute) ? m : best), 0);

  return (
    <div className={`flex items-center gap-1 ${className ?? ''}`}>
      <select
        value={hour12}
        onChange={(e) => onChange(to24Hour(Number(e.target.value), nearestMinute, period))}
        className="rounded-md border border-slate-300 px-2 py-2 text-sm"
      >
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="text-slate-400">:</span>
      <select
        value={nearestMinute}
        onChange={(e) => onChange(to24Hour(hour12, Number(e.target.value), period))}
        className="rounded-md border border-slate-300 px-2 py-2 text-sm"
      >
        {MINUTES.map((m) => (
          <option key={m} value={m}>
            {String(m).padStart(2, '0')}
          </option>
        ))}
      </select>
      <select
        value={period}
        onChange={(e) => onChange(to24Hour(hour12, nearestMinute, e.target.value as 'AM' | 'PM'))}
        className="rounded-md border border-slate-300 px-2 py-2 text-sm"
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}
