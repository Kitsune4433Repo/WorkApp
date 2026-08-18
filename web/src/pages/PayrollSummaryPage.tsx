import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

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

function PeopleTable({
  people,
  totalWageCents,
  onDeletePerson,
}: {
  people: PersonTotals[];
  totalWageCents: number;
  onDeletePerson?: (p: PersonTotals) => void;
}) {
  const columnCount = onDeletePerson ? 5 : 4;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
          <tr>
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Days worked</th>
            <th className="px-4 py-3">Hours</th>
            <th className="px-4 py-3">Earnings</th>
            {onDeletePerson && <th className="px-4 py-3" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {people.map((p) => (
            <tr key={p.user_id ?? p.user_full_name_snapshot}>
              <td className="px-4 py-3 font-medium">{p.full_name ?? p.user_full_name_snapshot}</td>
              <td className="px-4 py-3">{p.days_worked}</td>
              <td className="px-4 py-3">{formatHours(p.total_minutes)}</td>
              <td className="px-4 py-3">{formatMoney(p.earnings_cents)}</td>
              {onDeletePerson && (
                <td className="px-4 py-3 text-right">
                  {p.user_id && (
                    <button
                      onClick={() => onDeletePerson(p)}
                      className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
          {!people.length && (
            <tr>
              <td colSpan={columnCount} className="px-4 py-8 text-center text-slate-400">
                No completed shifts yet this period.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
            <td className="px-4 py-3" colSpan={columnCount - 1}>
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
  const { user } = useAuth();
  const queryClient = useQueryClient();
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

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/timecards/payroll-periods/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timecards', 'payroll-periods'] });
      setSelectedPeriodId(null);
    },
  });

  function onDeletePeriod(p: ArchivedPeriod) {
    if (window.confirm(`Delete the archived "${p.label}" payroll week? This cannot be undone.`)) {
      deleteMutation.mutate(p.id);
    }
  }

  // Clears a person's entry from the current in-progress week — it isn't archived yet, so this
  // deletes their underlying timecards for the week rather than a payroll_periods row.
  const deleteCurrentEntryMutation = useMutation({
    mutationFn: (userId: string) => api.delete(`/timecards/weekly-summary/${userId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['timecards', 'weekly-summary'] }),
  });

  function onDeleteCurrentEntry(p: PersonTotals) {
    if (!p.user_id) return;
    const name = p.full_name ?? p.user_full_name_snapshot;
    if (window.confirm(`Delete ${name}'s timecards for this week? This cannot be undone.`)) {
      deleteCurrentEntryMutation.mutate(p.user_id);
    }
  }

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
        {current && (
          <PeopleTable
            people={current.people}
            totalWageCents={current.totalWageCents}
            onDeletePerson={user?.role === 'admin' ? onDeleteCurrentEntry : undefined}
          />
        )}
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
          <div className="mt-4 space-y-2">
            <PeopleTable people={selectedPeriod.people} totalWageCents={selectedPeriod.total_wage_cents} />
            {user?.role === 'admin' && (
              <button
                onClick={() => onDeletePeriod(selectedPeriod)}
                disabled={deleteMutation.isPending}
                className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                Delete this archived week
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
