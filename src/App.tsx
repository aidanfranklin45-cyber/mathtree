import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { DealStudioPage } from './pages/DealStudioPage';
import { DashboardPage } from './pages/DashboardPage';
import { OperationsPage } from './pages/OperationsPage';
import { ReconcilePage } from './pages/ReconcilePage';
import { AuthGate } from './lib/auth/AuthGate';

/** Old per-tab URLs (project-debt.html?id=...) open the studio on that tab. */
const StudioTabRedirect: React.FC<{ tab: string }> = ({ tab }) => {
  const [params] = useSearchParams();
  const next = new URLSearchParams(params);
  next.set('tab', tab);
  return <Navigate to={`/project?${next.toString()}`} replace />;
};

const TABS = ['proforma', 'property', 'debt', 'diligence', 'sensitivity', 'tax'] as const;

const guard = (el: React.ReactElement) => <AuthGate>{el}</AuthGate>;

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        {['/', '/app', '/app.html', '/dashboard', '/dashboard.html'].map((p) => (
          <Route key={p} path={p} element={guard(<DashboardPage />)} />
        ))}
        {['/project', '/project.html'].map((p) => (
          <Route key={p} path={p} element={guard(<DealStudioPage />)} />
        ))}
        {TABS.flatMap((t) => [`/project-${t}`, `/project-${t}.html`].map((p) => (
          <Route key={p} path={p} element={<StudioTabRedirect tab={t} />} />
        )))}
        {['/operations', '/operations.html'].map((p) => (
          <Route key={p} path={p} element={guard(<OperationsPage />)} />
        ))}
        {/* Public zero-login page linked from rent-alert emails */}
        <Route path="/reconcile" element={<ReconcilePage />} />
        <Route path="/reconcile.html" element={<ReconcilePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};
