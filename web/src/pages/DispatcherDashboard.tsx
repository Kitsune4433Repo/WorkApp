import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { GeofenceMapPicker, LatLng } from '../components/GeofenceMapPicker';

interface Job {
  id: string;
  job_number: string;
  title: string;
  status: string;
  priority: string;
  lat: number;
  lng: number;
  scheduled_start: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  scheduled: 'bg-blue-100 text-blue-700',
  dispatched: 'bg-amber-100 text-amber-700',
  in_progress: 'bg-purple-100 text-purple-700',
  blocked: 'bg-red-100 text-red-700',
  completed: 'bg-green-100 text-green-700',
  closed: 'bg-slate-200 text-slate-600',
  cancelled: 'bg-red-50 text-red-500',
};

export function DispatcherDashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: jobs } = useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: async () => (await api.get('/jobs')).data,
    refetchInterval: 30_000,
  });

  const dispatchMutation = useMutation({
    mutationFn: (jobId: string) => api.post(`/jobs/${jobId}/dispatch`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['jobs'] }),
  });

  const canDispatch = user?.role === 'admin' || user?.role === 'dispatcher';

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dispatch Board</h1>
        <p className="text-sm text-slate-500">Schedule, modify, and push work orders to field devices.</p>
      </div>

      {canDispatch && <CreateJobForm />}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Job #</th>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Scheduled</th>
              {canDispatch && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {jobs?.map((job) => (
              <tr key={job.id}>
                <td className="px-4 py-3 font-medium">{job.job_number}</td>
                <td className="px-4 py-3">{job.title}</td>
                <td className="px-4 py-3 capitalize">{job.priority}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_COLORS[job.status] ?? ''}`}>
                    {job.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-3">{job.scheduled_start ? new Date(job.scheduled_start).toLocaleString() : '—'}</td>
                {canDispatch && (
                  <td className="px-4 py-3 text-right">
                    {job.status === 'scheduled' && (
                      <button
                        onClick={() => dispatchMutation.mutate(job.id)}
                        className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700"
                      >
                        Dispatch
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {!jobs?.length && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  No jobs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreateJobForm() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    jobNumber: '',
    title: '',
    geofenceRadiusM: '75',
    scheduledStart: '',
  });
  const [siteLocation, setSiteLocation] = useState<LatLng | null>(null);
  const [polygon, setPolygon] = useState<LatLng[]>([]);

  const createMutation = useMutation({
    mutationFn: () => {
      if (!siteLocation) throw new Error('Click the map to set a site location first.');
      return api.post('/jobs', {
        jobNumber: form.jobNumber,
        title: form.title,
        siteLocation,
        geofenceRadiusM: Number(form.geofenceRadiusM),
        geofencePolygon: polygon.length >= 3 ? polygon : undefined,
        scheduledStart: form.scheduledStart ? new Date(form.scheduledStart).toISOString() : undefined,
        assigneeUserIds: [],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      setForm({ jobNumber: '', title: '', geofenceRadiusM: '75', scheduledStart: '' });
      setSiteLocation(null);
      setPolygon([]);
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    createMutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <input required placeholder="Job #" value={form.jobNumber} onChange={(e) => setForm({ ...form, jobNumber: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm md:col-span-1" />
        <input required placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm md:col-span-2" />
        <input type="datetime-local" value={form.scheduledStart} onChange={(e) => setForm({ ...form, scheduledStart: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm text-slate-600">Fallback radius (m)</label>
        <input
          type="number"
          min={10}
          value={form.geofenceRadiusM}
          onChange={(e) => setForm({ ...form, geofenceRadiusM: e.target.value })}
          className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        {siteLocation && (
          <span className="text-xs text-slate-400">
            Site: {siteLocation.lat.toFixed(5)}, {siteLocation.lng.toFixed(5)}
          </span>
        )}
      </div>

      <GeofenceMapPicker
        siteLocation={siteLocation}
        radiusM={Number(form.geofenceRadiusM) || 75}
        polygon={polygon}
        onSiteLocationChange={setSiteLocation}
        onPolygonChange={setPolygon}
      />

      {createMutation.isError && (
        <p className="text-sm text-red-600">{(createMutation.error as Error)?.message ?? 'Failed to create job.'}</p>
      )}

      <button type="submit" disabled={createMutation.isPending} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
        {createMutation.isPending ? 'Creating…' : 'Create job'}
      </button>
    </form>
  );
}
