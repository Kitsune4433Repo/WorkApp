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

interface TimecardEntry {
  id: string;
  full_name: string;
  clock_in_at: string;
  clock_out_at: string | null;
  total_minutes: number | null;
  earnings_cents: number | null;
  tamper_flag: boolean;
  clock_in_in_geofence: boolean | null;
  clock_out_in_geofence: boolean | null;
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

  const { data: history } = useQuery<TimecardEntry[]>({
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

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/timecards/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['timecards'] }),
  });

  function onDeleteEntry(tc: TimecardEntry) {
    if (window.confirm(`Delete this ${tc.full_name} shift (${new Date(tc.clock_in_at).toLocaleDateString()})? This cannot be undone.`)) {
      deleteMutation.mutate(tc.id);
    }
  }

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
              <div className="text-sm font-medium text-slate-700">{user?.fullName}</div>
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

      <div>
        <h2 className="mb-2 text-lg font-semibold text-slate-800">History</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {history?.map((tc) => (
            <div key={tc.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between">
                <div className="font-medium text-slate-900">{tc.full_name}</div>
                {tc.tamper_flag && <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">flagged</span>}
              </div>
              <div className="mt-2 space-y-1 text-sm text-slate-600">
                <div>In: {new Date(tc.clock_in_at).toLocaleString()}</div>
                <div>Out: {tc.clock_out_at ? new Date(tc.clock_out_at).toLocaleString() : 'still clocked in'}</div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm text-slate-500">{tc.total_minutes != null ? `${(tc.total_minutes / 60).toFixed(2)}h` : '—'}</span>
                <span className="text-lg font-semibold text-brand-700">
                  {tc.earnings_cents != null ? `$${(tc.earnings_cents / 100).toFixed(2)}` : '—'}
                </span>
              </div>
              {user?.role === 'admin' && (
                <button
                  onClick={() => onDeleteEntry(tc)}
                  disabled={deleteMutation.isPending}
                  className="mt-3 w-full rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              )}
            </div>
          ))}
          {!history?.length && <p className="text-slate-400">No shifts recorded yet.</p>}
        </div>
      </div>
    </div>
  );
}
