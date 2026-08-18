import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

interface PersonTotals {
  user_id: string | null;
  full_name?: string;
  user_full_name_snapshot?: string;
  days_worked: number;
  total_minutes: number;
  earnings_cents: number;
}

interface WeeklySummary {
  periodStart: { year: number; month: number; day: number };
  periodEnd: { year: number; month: number; day: number };
  label: string;
  people: PersonTotals[];
  totalWageCents: number;
}

interface ArchivedPeriod {
  id: string;
  period_start: string;
  period_end: string;
  label: string;
  total_wage_cents: number;
  finalized_at: string;
}

interface ArchivedPeriodDetail extends ArchivedPeriod {
  people: PersonTotals[];
}

function formatHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function PeopleTable({ people, totalWageCents }: { people: PersonTotals[]; totalWageCents: number }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
          <tr>
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Days worked</th>
            <th className="px-4 py-3">Hours</th>
            <th className="px-4 py-3">Earnings</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {people.map((p) => (
            <tr key={p.user_id ?? p.user_full_name_snapshot}>
              <td className="px-4 py-3 font-medium">{p.full_name ?? p.user_full_name_snapshot}</td>
              <td className="px-4 py-3">{p.days_worked}</td>
              <td className="px-4 py-3">{formatHours(p.total_minutes)}</td>
              <td className="px-4 py-3">{formatMoney(p.earnings_cents)}</td>
            </tr>
          ))}
          {!people.length && (
            <tr>
              <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                No completed shifts yet this period.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
            <td className="px-4 py-3" colSpan={3}>
              Total wage cost
            </td>
            <td className="px-4 py-3">{formatMoney(totalWageCents)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Admin/dispatcher/crew_lead view of payroll: the current in-progress Thu-Wed week's totals per
 * person plus everyone's combined wage cost, and a browsable archive of prior weeks — each week is
 * automatically closed out and filed under its date-range label (e.g. "August 13th-19th") at
 * Wednesday 11pm, see backend/src/services/payrollPeriodService.ts. */
export function PayrollSummaryPage() {
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);

  const { data: current } = useQuery<WeeklySummary>({
    queryKey: ['timecards', 'weekly-summary'],
    queryFn: async () => (await api.get('/timecards/weekly-summary')).data,
    refetchInterval: 60_000,
  });

  const { data: periods } = useQuery<ArchivedPeriod[]>({
    queryKey: ['timecards', 'payroll-periods'],
    queryFn: async () => (await api.get('/timecards/payroll-periods')).data,
  });

  const { data: selectedPeriod } = useQuery<ArchivedPeriodDetail>({
    queryKey: ['timecards', 'payroll-periods', selectedPeriodId],
    queryFn: async () => (await api.get(`/timecards/payroll-periods/${selectedPeriodId}`)).data,
    enabled: !!selectedPeriodId,
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Payroll</h1>
        <p className="text-sm text-slate-500">
          Pay weeks run Thursday through Wednesday and close out automatically Wednesday night.
        </p>
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold text-slate-800">This week{current ? ` — ${current.label}` : ''}</h2>
        {current && <PeopleTable people={current.people} totalWageCents={current.totalWageCents} />}
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold text-slate-800">Past weeks</h2>
        <div className="flex flex-wrap gap-2">
          {periods?.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedPeriodId(p.id === selectedPeriodId ? null : p.id)}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                selectedPeriodId === p.id ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {p.label}
            </button>
          ))}
          {!periods?.length && <p className="text-sm text-slate-400">No weeks have closed out yet.</p>}
        </div>

        {selectedPeriod && (
          <div className="mt-4">
            <PeopleTable people={selectedPeriod.people} totalWageCents={selectedPeriod.total_wage_cents} />
          </div>
        )}
      </div>
    </div>
  );
}
