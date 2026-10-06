import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage';
import { AuthGate } from './lib/auth/AuthGate';
import { importOperationsPage } from './lib/prefetchRoutes';
import { lazyWithRetry } from './lib/lazyWithRetry';
import { AppErrorBoundary } from './components/layout/AppErrorBoundary';

const DealStudioPage = lazyWithRetry(() => import('./pages/DealStudioPage').then((m) => ({ default: m.DealStudioPage })));
const OperationsPage = lazyWithRetry(() => importOperationsPage().then((m) => ({ default: m.OperationsPage })));
const ComparePage = lazyWithRetry(() => import('./pages/ComparePage').then((m) => ({ default: m.ComparePage })));
const ReconcilePage = lazyWithRetry(() => import('./pages/ReconcilePage').then((m) => ({ default: m.ReconcilePage })));
const DealBriefPage = lazyWithRetry(() => import('./pages/DealBriefPage').then((m) => ({ default: m.DealBriefPage })));
const PortfolioBriefPage = lazyWithRetry(() => import('./pages/PortfolioBriefPage').then((m) => ({ default: m.PortfolioBriefPage })));
const BankPrepPage = lazyWithRetry(() => import('./pages/BankPrepPage').then((m) => ({ default: m.BankPrepPage })));
const LoginPage = lazyWithRetry(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));

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

const TABS = ['proforma', 'property', 'debt', 'diligence', 'sensitivity'] as const;

const guard = (el: React.ReactElement) => <AuthGate>{el}</AuthGate>;

export const App: React.FC = () => {
  return (
    <AppErrorBoundary>
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
            {['/compare', '/compare.html'].map((p) => (
              <Route key={p} path={p} element={guard(<ComparePage />)} />
            ))}
            <Route path="/bank-prep" element={guard(<BankPrepPage />)} />
            <Route path="/brief" element={guard(<DealBriefPage />)} />
            {/* Public sample memo linked from the landing page: no sign-in, demo deals only */}
            <Route path="/demo-brief" element={<DealBriefPage publicDemo />} />
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
    </AppErrorBoundary>
  );
};
