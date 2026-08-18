import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { DispatcherDashboard } from './pages/DispatcherDashboard';
import { InventoryLedger } from './pages/InventoryLedger';
import { TimecardsPage } from './pages/TimecardsPage';
import { ChatPage } from './pages/ChatPage';
import { UploadCenter } from './pages/UploadCenter';
import { KnowledgeBasePage } from './pages/KnowledgeBasePage';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" replace />;
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
                <Route path="/knowledge-base" element={<KnowledgeBasePage />} />
              </Routes>
            </AppShell>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
