import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage';
import { AuthGate } from './lib/auth/AuthGate';

const DealStudioPage = lazy(() => import('./pages/DealStudioPage').then((m) => ({ default: m.DealStudioPage })));
const OperationsPage = lazy(() => import('./pages/OperationsPage').then((m) => ({ default: m.OperationsPage })));
const ComparePage = lazy(() => import('./pages/ComparePage').then((m) => ({ default: m.ComparePage })));
const ReconcilePage = lazy(() => import('./pages/ReconcilePage').then((m) => ({ default: m.ReconcilePage })));
const DealBriefPage = lazy(() => import('./pages/DealBriefPage').then((m) => ({ default: m.DealBriefPage })));
const PortfolioBriefPage = lazy(() => import('./pages/PortfolioBriefPage').then((m) => ({ default: m.PortfolioBriefPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));

const PageSpinner: React.FC = () => (
  <div className="min-h-screen bg-slate-950 flex items-center justify-center">
    <div className="w-8 h-8 rounded-full border-2 border-emerald-400/30 border-t-emerald-400 animate-spin" />
  </div>
);

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
      <Suspense fallback={<PageSpinner />}>
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
          <Route path="/brief" element={guard(<DealBriefPage />)} />
          <Route path="/portfolio-brief" element={guard(<PortfolioBriefPage />)} />
          {['/operations', '/operations.html'].map((p) => (
            <Route key={p} path={p} element={guard(<OperationsPage />)} />
          ))}
          {/* Authentication flow with password manager support */}
          {['/login', '/login.html', '/signin'].map((p) => (
            <Route key={p} path={p} element={<LoginPage />} />
          ))}
          {/* Public zero-login page linked from rent-alert emails */}
          <Route path="/reconcile" element={<ReconcilePage />} />
          <Route path="/reconcile.html" element={<ReconcilePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
};
