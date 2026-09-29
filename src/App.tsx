import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { DealStudioPage } from './pages/DealStudioPage';
import { DashboardPage } from './pages/DashboardPage';
import { OperationsPage } from './pages/OperationsPage';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/app" element={<DashboardPage />} />
        <Route path="/app.html" element={<DashboardPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/dashboard.html" element={<DashboardPage />} />
        <Route path="/project" element={<DealStudioPage />} />
        <Route path="/project.html" element={<DealStudioPage />} />
        <Route path="/operations" element={<OperationsPage />} />
        <Route path="/operations.html" element={<OperationsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};
