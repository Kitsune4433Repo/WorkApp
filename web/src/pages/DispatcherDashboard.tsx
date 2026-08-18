import { Fragment, FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { GeofenceMapPicker, LatLng } from '../components/GeofenceMapPicker';
import { JobsMap } from '../components/JobsMap';

interface Job {
  id: string;
  job_number: string;
  title: string;
  status: string;
  priority: string;
  is_active: boolean;
  lat: number | null;
  lng: number | null;
  geofence_geojson: string | null;
  geofence_radius_m: number | null;
  scheduled_start: string | null;
  recurring_days_of_week: number[] | null;
  recurring_start_time: string | null;
  recurring_end_time: string | null;
  recurring_until: string | null;
}

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-slate-100 text-slate-600',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-amber-100 text-amber-700',
  urgent: 'bg-red-100 text-red-700',
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatRecurrence(job: Job): string | null {
  if (!job.recurring_days_of_week?.length) return null;
  const days = [...job.recurring_days_of_week].sort().map((d) => DAY_LABELS[d]).join(', ');
  const time = job.recurring_start_time ? ` at ${job.recurring_start_time}` : '';
  return `Recurs: ${days}${time}`;
}

/** Shared by the create form and the per-job schedule editor below. */
function DayPicker({ days, onToggle }: { days: number[]; onToggle: (day: number) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {DAY_LABELS.map((label, day) => (
        <button
          type="button"
          key={day}
          onClick={() => onToggle(day)}
          className={`rounded-md border px-3 py-1 text-xs font-medium ${
            days.includes(day) ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function DispatcherDashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: jobs } = useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: async () => (await api.get('/jobs')).data,
    refetchInterval: 30_000,
  });

  const [editingJobId, setEditingJobId] = useState<string | null>(null);

  // Lifted up from CreateJobForm so the same map used for the overview (existing jobs) also drives
  // the new-job picker — one map on the page instead of an overview map plus a separate picker map.
  const [siteAddress, setSiteAddress] = useState('');
  const [siteLocation, setSiteLocation] = useState<LatLng | null>(null);
  const [polygon, setPolygon] = useState<LatLng[]>([]);
  const [geofenceRadiusM, setGeofenceRadiusM] = useState('75');

  function resetSitePicker() {
    setSiteAddress('');
    setSiteLocation(null);
    setPolygon([]);
    setGeofenceRadiusM('75');
  }

  const startMutation = useMutation({
    mutationFn: (jobId: string) => api.post(`/jobs/${jobId}/start`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['jobs'] }),
  });

  const stopMutation = useMutation({
    mutationFn: (jobId: string) => api.post(`/jobs/${jobId}/stop`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['jobs'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (jobId: string) => api.delete(`/jobs/${jobId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['jobs'] }),
  });

  const canDispatch = user?.role === 'admin' || user?.role === 'dispatcher';

  function onRemove(job: Job) {
    if (window.confirm(`Remove job ${job.job_number} — ${job.title}? This cannot be undone.`)) {
      deleteMutation.mutate(job.id);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dispatch Board</h1>
        <p className="text-sm text-slate-500">Schedule, modify, and push work orders to field devices.</p>
      </div>

      <JobsMap
        jobs={jobs ?? []}
        picker={
          canDispatch
            ? {
                siteLocation,
                radiusM: Number(geofenceRadiusM) || 75,
                polygon,
                onSiteLocationChange: setSiteLocation,
                onPolygonChange: setPolygon,
              }
            : undefined
        }
      />

      {canDispatch && (
        <CreateJobForm
          siteAddress={siteAddress}
          onSiteAddressChange={setSiteAddress}
          siteLocation={siteLocation}
          onSiteLocationChange={setSiteLocation}
          polygon={polygon}
          onPolygonChange={setPolygon}
          geofenceRadiusM={geofenceRadiusM}
          onGeofenceRadiusMChange={setGeofenceRadiusM}
          onCreated={resetSitePicker}
        />
      )}

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
            {jobs?.map((job) => {
              const recurrence = formatRecurrence(job);
              const isEditing = editingJobId === job.id;
              return (
                <Fragment key={job.id}>
                  <tr>
                    <td className="px-4 py-3 font-medium">{job.job_number}</td>
                    <td className="px-4 py-3">{job.title}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium capitalize ${PRIORITY_COLORS[job.priority] ?? ''}`}>
                        {job.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${job.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                        {job.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {recurrence ?? (job.scheduled_start ? new Date(job.scheduled_start).toLocaleString() : '—')}
                    </td>
                    {canDispatch && (
                      <td className="px-4 py-3 text-right space-x-2">
                        {job.is_active ? (
                          <button
                            onClick={() => stopMutation.mutate(job.id)}
                            disabled={stopMutation.isPending}
                            className="rounded-md bg-slate-600 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700"
                          >
                            Stop
                          </button>
                        ) : (
                          <button
                            onClick={() => startMutation.mutate(job.id)}
                            disabled={startMutation.isPending}
                            className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700"
                          >
                            Start
                          </button>
                        )}
                        <button
                          onClick={() => setEditingJobId(isEditing ? null : job.id)}
                          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        >
                          {isEditing ? 'Close' : 'Edit schedule'}
                        </button>
                        <button
                          onClick={() => onRemove(job)}
                          disabled={deleteMutation.isPending}
                          className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                  {isEditing && (
                    <tr>
                      <td colSpan={canDispatch ? 6 : 5} className="bg-slate-50 px-4 py-4">
                        <JobScheduleEditor job={job} onDone={() => setEditingJobId(null)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
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

/** Lets a dispatcher change or drop an already-created job's recurring days without recreating the
 * job — e.g. "we're not working this one on Fridays anymore" or "add Tuesday too". */
function JobScheduleEditor({ job, onDone }: { job: Job; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [days, setDays] = useState<number[]>(job.recurring_days_of_week ?? []);
  const [startTime, setStartTime] = useState(job.recurring_start_time?.slice(0, 5) ?? '');
  const [endTime, setEndTime] = useState(job.recurring_end_time?.slice(0, 5) ?? '');
  const [until, setUntil] = useState(job.recurring_until?.slice(0, 10) ?? '');

  function toggleDay(day: number) {
    setDays((current) => (current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort()));
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      api.patch(`/jobs/${job.id}`, {
        recurringDaysOfWeek: days,
        recurringStartTime: days.length && startTime ? startTime : null,
        recurringEndTime: days.length && endTime ? endTime : null,
        recurringUntil: days.length && until ? until : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      onDone();
    },
  });

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-slate-700">
        Weekly schedule for {job.job_number} — remove a day to stop working it, or add one to pick up more days.
      </p>
      <DayPicker days={days} onToggle={toggleDay} />
      {days.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div>
            <label className="text-xs text-slate-500">Start time</label>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-500">End time</label>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-500">Repeat until (optional)</label>
            <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </div>
        </div>
      )}
      {!days.length && <p className="text-xs text-slate-500">No days selected — saving will remove weekly recurrence from this job.</p>}
      {saveMutation.isError && <p className="text-sm text-red-600">Failed to save schedule.</p>}
      <div className="flex gap-2">
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          {saveMutation.isPending ? 'Saving…' : 'Save schedule'}
        </button>
        <button type="button" onClick={onDone} className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
          Cancel
        </button>
      </div>
    </div>
  );
}

interface CreateJobFormProps {
  siteAddress: string;
  onSiteAddressChange: (address: string) => void;
  siteLocation: LatLng | null;
  onSiteLocationChange: (location: LatLng) => void;
  polygon: LatLng[];
  onPolygonChange: (polygon: LatLng[]) => void;
  geofenceRadiusM: string;
  onGeofenceRadiusMChange: (radius: string) => void;
  onCreated: () => void;
}

function CreateJobForm({
  siteAddress,
  onSiteAddressChange,
  siteLocation,
  onSiteLocationChange,
  polygon,
  onPolygonChange,
  geofenceRadiusM,
  onGeofenceRadiusMChange,
  onCreated,
}: CreateJobFormProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    jobNumber: '',
    title: '',
    description: '',
    priority: 'medium' as (typeof PRIORITIES)[number],
    scheduledStart: '',
    recurringStartTime: '',
    recurringEndTime: '',
    recurringUntil: '',
  });
  const [recurringDays, setRecurringDays] = useState<number[]>([]);

  function toggleDay(day: number) {
    setRecurringDays((days) => (days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort()));
  }

  const createMutation = useMutation({
    mutationFn: () => {
      if (!siteLocation) throw new Error('Look up an address (or click the map) to set a site location first.');
      return api.post('/jobs', {
        jobNumber: form.jobNumber,
        title: form.title,
        description: form.description || undefined,
        priority: form.priority,
        siteAddress: siteAddress || undefined,
        siteLocation,
        geofenceRadiusM: Number(geofenceRadiusM),
        geofencePolygon: polygon.length >= 3 ? polygon : undefined,
        scheduledStart: form.scheduledStart ? new Date(form.scheduledStart).toISOString() : undefined,
        recurringDaysOfWeek: recurringDays.length ? recurringDays : undefined,
        recurringStartTime: recurringDays.length && form.recurringStartTime ? form.recurringStartTime : undefined,
        recurringEndTime: recurringDays.length && form.recurringEndTime ? form.recurringEndTime : undefined,
        recurringUntil: recurringDays.length && form.recurringUntil ? form.recurringUntil : undefined,
        assigneeUserIds: [],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      setForm({
        jobNumber: '',
        title: '',
        description: '',
        priority: 'medium',
        scheduledStart: '',
        recurringStartTime: '',
        recurringEndTime: '',
        recurringUntil: '',
      });
      setRecurringDays([]);
      onCreated();
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
        <select
          value={form.priority}
          onChange={(e) => setForm({ ...form, priority: e.target.value as (typeof PRIORITIES)[number] })}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm capitalize"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p} className="capitalize">
              {p}
            </option>
          ))}
        </select>
        <textarea
          placeholder="Description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={2}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm md:col-span-4"
        />
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm text-slate-600">Fallback radius (m)</label>
        <input
          type="number"
          min={10}
          value={geofenceRadiusM}
          onChange={(e) => onGeofenceRadiusMChange(e.target.value)}
          className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        {siteLocation && (
          <span className="text-xs text-slate-400">
            Site: {siteLocation.lat.toFixed(5)}, {siteLocation.lng.toFixed(5)} — shown as an orange pin on the map above
          </span>
        )}
      </div>

      <GeofenceMapPicker
        address={siteAddress}
        onAddressChange={onSiteAddressChange}
        siteLocation={siteLocation}
        polygon={polygon}
        onSiteLocationChange={onSiteLocationChange}
        onPolygonChange={onPolygonChange}
      />

      <div className="space-y-2 rounded-md border border-slate-200 p-3">
        <p className="text-sm font-medium text-slate-700">Weekly schedule</p>
        <p className="text-xs text-slate-500">
          Leave the one-time date/time above and pick days here instead to have this job repeat every week. Leave both blank for an unscheduled job. You can edit or remove days later from the job row.
        </p>
        <DayPicker days={recurringDays} onToggle={toggleDay} />
        {recurringDays.length > 0 && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <div>
              <label className="text-xs text-slate-500">Start time</label>
              <input
                type="time"
                value={form.recurringStartTime}
                onChange={(e) => setForm({ ...form, recurringStartTime: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">End time</label>
              <input
                type="time"
                value={form.recurringEndTime}
                onChange={(e) => setForm({ ...form, recurringEndTime: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">Repeat until (optional)</label>
              <input
                type="date"
                value={form.recurringUntil}
                onChange={(e) => setForm({ ...form, recurringUntil: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
        )}
      </div>

      {createMutation.isError && (
        <p className="text-sm text-red-600">{(createMutation.error as Error)?.message ?? 'Failed to create job.'}</p>
      )}

      <button type="submit" disabled={createMutation.isPending} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
        {createMutation.isPending ? 'Creating…' : 'Create job'}
      </button>
    </form>
  );
}
