import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DispatcherDashboard } from './pages/DispatcherDashboard';
import { InventoryLedger } from './pages/InventoryLedger';
import { TimecardsPage } from './pages/TimecardsPage';
import { ChatPage } from './pages/ChatPage';
import { UploadCenter } from './pages/UploadCenter';
import { ConflictReviewPage } from './pages/ConflictReviewPage';
import { UserManagementPage } from './pages/UserManagementPage';
import { PayrollSummaryPage } from './pages/PayrollSummaryPage';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" replace />;
}

function RequireRole({ roles, children }: { roles: string[]; children: JSX.Element }) {
  const { user } = useAuth();
  return user && roles.includes(user.role) ? children : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <AppShell>
              <Routes>
                <Route path="/" element={<DispatcherDashboard />} />
                <Route path="/inventory" element={<InventoryLedger />} />
                <Route path="/timecards" element={<TimecardsPage />} />
                <Route path="/chat" element={<ChatPage />} />
                <Route path="/uploads" element={<UploadCenter />} />
                <Route
                  path="/payroll"
                  element={
                    <RequireRole roles={['admin', 'dispatcher', 'crew_lead']}>
                      <PayrollSummaryPage />
                    </RequireRole>
                  }
                />
                <Route
                  path="/conflicts"
                  element={
                    <RequireRole roles={['admin', 'dispatcher']}>
                      <ConflictReviewPage />
                    </RequireRole>
                  }
                />
                <Route
                  path="/users"
                  element={
                    <RequireRole roles={['admin']}>
                      <UserManagementPage />
                    </RequireRole>
                  }
                />
              </Routes>
            </AppShell>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
