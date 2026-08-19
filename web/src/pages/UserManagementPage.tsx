import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

interface User {
  id: string;
  email: string;
  full_name: string;
  role: string;
  phone: string | null;
  hourly_rate_cents: number;
  is_active: boolean;
}

const ROLES = ['admin', 'crew_lead', 'crew'] as const;

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  crew_lead: 'Crew Lead',
  crew: 'Crew',
};

/** Admin-only account provisioning — this app deliberately has no public sign-up (it's an internal
 * crew tool, not a public product); an admin creates accounts for real people here instead. */
export function UserManagementPage() {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const { data: users } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async () => (await api.get('/users')).data,
  });

  const setActiveMutation = useMutation({
    mutationFn: (params: { id: string; isActive: boolean }) => api.patch(`/users/${params.id}`, { isActive: params.isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  function onDelete(u: User) {
    if (
      window.confirm(
        `Permanently delete ${u.full_name}'s account and login? This cannot be undone. (Jobs, messages, and documents they created stay, but reactivating this person is only possible by creating a new account.)`,
      )
    ) {
      deleteMutation.mutate(u.id);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Users</h1>
        <p className="text-sm text-slate-500">Create accounts for admins, crew leads, and crew.</p>
      </div>

      <CreateUserForm onCreated={() => queryClient.invalidateQueries({ queryKey: ['users'] })} />

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Hourly rate</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users?.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 font-medium">{u.full_name}</td>
                <td className="px-4 py-3 text-slate-600">{u.email}</td>
                <td className="px-4 py-3">{ROLE_LABELS[u.role] ?? u.role}</td>
                <td className="px-4 py-3">{u.hourly_rate_cents ? `$${(u.hourly_rate_cents / 100).toFixed(2)}/hr` : '—'}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                    {u.is_active ? 'active' : 'inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  {u.id === currentUser?.id ? (
                    <span className="text-xs text-slate-300">that's you</span>
                  ) : (
                    <>
                      <button
                        onClick={() => setActiveMutation.mutate({ id: u.id, isActive: !u.is_active })}
                        disabled={setActiveMutation.isPending}
                        className={`rounded-md px-3 py-1 text-xs font-medium ${
                          u.is_active ? 'border border-red-300 text-red-600 hover:bg-red-50' : 'border border-green-300 text-green-700 hover:bg-green-50'
                        }`}
                      >
                        {u.is_active ? 'Deactivate' : 'Reactivate'}
                      </button>
                      <button
                        onClick={() => onDelete(u)}
                        disabled={deleteMutation.isPending}
                        className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
                      >
                        Delete permanently
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!users?.length && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  No users yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreateUserForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({
    email: '',
    password: '',
    fullName: '',
    role: 'crew' as (typeof ROLES)[number],
    hourlyRateCents: '',
  });
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/users', {
        email: form.email,
        password: form.password,
        fullName: form.fullName,
        role: form.role,
        hourlyRateCents: form.hourlyRateCents ? Math.round(Number(form.hourlyRateCents) * 100) : 0,
      }),
    onSuccess: (res) => {
      setSuccessMessage(`Created ${res.data.email}.`);
      setForm({ email: '', password: '', fullName: '', role: 'crew', hourlyRateCents: '' });
      onCreated();
    },
    onError: () => setSuccessMessage(null),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    createMutation.mutate();
  }

  const errorMessage = (() => {
    if (!createMutation.isError) return null;
    const err = createMutation.error as { response?: { status?: number; data?: { error?: string } } };
    if (err.response?.data?.error === 'validation_error') return 'Check the fields — email must be valid and password at least 8 characters.';
    if (err.response?.status === 409 || err.response?.data?.error?.includes('unique')) return 'That email is already in use.';
    return 'Failed to create user.';
  })();

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-6">
      <h2 className="col-span-full text-sm font-semibold text-slate-700">Create account</h2>
      <input
        required
        type="text"
        placeholder="Full name"
        value={form.fullName}
        onChange={(e) => setForm({ ...form, fullName: e.target.value })}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm md:col-span-2"
      />
      <input
        required
        type="email"
        placeholder="Email"
        value={form.email}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm md:col-span-2"
      />
      <input
        required
        type="password"
        placeholder="Password (min 8 chars)"
        minLength={8}
        value={form.password}
        onChange={(e) => setForm({ ...form, password: e.target.value })}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm md:col-span-2"
      />
      <select
        value={form.role}
        onChange={(e) => setForm({ ...form, role: e.target.value as (typeof ROLES)[number] })}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
      >
        {ROLES.map((role) => (
          <option key={role} value={role}>
            {ROLE_LABELS[role]}
          </option>
        ))}
      </select>
      <input
        type="number"
        min={0}
        step="0.01"
        placeholder="Hourly rate ($)"
        value={form.hourlyRateCents}
        onChange={(e) => setForm({ ...form, hourlyRateCents: e.target.value })}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={createMutation.isPending}
        className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        {createMutation.isPending ? 'Creating…' : 'Create account'}
      </button>

      {successMessage && <p className="col-span-full text-sm text-green-600">{successMessage}</p>}
      {errorMessage && <p className="col-span-full text-sm text-red-600">{errorMessage}</p>}
    </form>
  );
}
