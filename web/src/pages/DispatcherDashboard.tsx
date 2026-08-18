import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

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
    lat: '',
    lng: '',
    geofenceRadiusM: '75',
    scheduledStart: '',
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/jobs', {
        jobNumber: form.jobNumber,
        title: form.title,
        siteLocation: { lat: Number(form.lat), lng: Number(form.lng) },
        geofenceRadiusM: Number(form.geofenceRadiusM),
        scheduledStart: form.scheduledStart ? new Date(form.scheduledStart).toISOString() : undefined,
        assigneeUserIds: [],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      setForm({ jobNumber: '', title: '', lat: '', lng: '', geofenceRadiusM: '75', scheduledStart: '' });
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    createMutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-6">
      <input required placeholder="Job #" value={form.jobNumber} onChange={(e) => setForm({ ...form, jobNumber: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm md:col-span-1" />
      <input required placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm md:col-span-2" />
      <input required placeholder="Lat" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
      <input required placeholder="Lng" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
      <input type="datetime-local" value={form.scheduledStart} onChange={(e) => setForm({ ...form, scheduledStart: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
      <button type="submit" disabled={createMutation.isPending} className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
        {createMutation.isPending ? 'Creating…' : 'Create job'}
      </button>
    </form>
  );
}
