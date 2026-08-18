import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { v4 as uuid } from 'uuid';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

interface ActiveTimecard {
  id: string;
  clock_in_at: string;
  onBreak: boolean;
  liveActiveMinutes: number;
  liveEarningsCents: number;
}

function useGeolocation() {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    navigator.geolocation?.getCurrentPosition((pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }));
  }, []);
  return coords;
}

export function TimecardsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const coords = useGeolocation();

  const { data: active } = useQuery<ActiveTimecard | null>({
    queryKey: ['timecards', 'active'],
    queryFn: async () => (await api.get('/timecards/active')).data,
    refetchInterval: 15_000,
  });

  const { data: history } = useQuery({
    queryKey: ['timecards', 'history', user?.id],
    queryFn: async () => (await api.get(`/timecards/history/${user!.id}`)).data,
    enabled: !!user,
  });

  const clockIn = useMutation({
    mutationFn: () =>
      api.post('/timecards/clock-in', {
        location: coords ?? { lat: 0, lng: 0 },
        deviceTime: new Date().toISOString(),
        clientEventId: uuid(),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['timecards'] }),
  });

  const clockOut = useMutation({
    mutationFn: () => api.post('/timecards/clock-out', { location: coords ?? { lat: 0, lng: 0 }, deviceTime: new Date().toISOString() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['timecards'] }),
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Work Times</h1>
        <p className="text-sm text-slate-500">Clock in/out with geofence-verified location and live earnings.</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6">
        {active ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-sm text-slate-500">Clocked in at {new Date(active.clock_in_at).toLocaleTimeString()}</div>
              <div className="text-3xl font-bold text-brand-700">${(active.liveEarningsCents / 100).toFixed(2)}</div>
              <div className="text-sm text-slate-500">{Math.floor(active.liveActiveMinutes / 60)}h {active.liveActiveMinutes % 60}m active{active.onBreak ? ' (on break)' : ''}</div>
            </div>
            <button onClick={() => clockOut.mutate()} className="rounded-md bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700">
              Clock out
            </button>
          </div>
        ) : (
          <button onClick={() => clockIn.mutate()} className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700">
            Clock in
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Clock in</th>
              <th className="px-4 py-3">Clock out</th>
              <th className="px-4 py-3">Hours</th>
              <th className="px-4 py-3">Earnings</th>
              <th className="px-4 py-3">Geofence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {history?.map((tc: any) => (
              <tr key={tc.id}>
                <td className="px-4 py-3">{new Date(tc.clock_in_at).toLocaleString()}</td>
                <td className="px-4 py-3">{tc.clock_out_at ? new Date(tc.clock_out_at).toLocaleString() : '—'}</td>
                <td className="px-4 py-3">{tc.total_minutes ? (tc.total_minutes / 60).toFixed(2) : '—'}</td>
                <td className="px-4 py-3">{tc.earnings_cents != null ? `$${(tc.earnings_cents / 100).toFixed(2)}` : '—'}</td>
                <td className="px-4 py-3">
                  {tc.tamper_flag && <span className="mr-2 rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">flagged</span>}
                  {tc.clock_in_in_geofence === false ? 'outside' : tc.clock_in_in_geofence === true ? 'inside' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
