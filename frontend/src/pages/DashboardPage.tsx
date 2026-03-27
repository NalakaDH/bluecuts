import React from 'react';
import type { PageId } from '../components/layout/Layout';
import { DashboardTemplateUI } from './DashboardTemplateUI';

interface DashboardPageProps {
  token?: string;
  onNavigate?: (page: PageId) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ token, onNavigate }) => {
  if (!token) return <div className="reports-empty">Loading dashboard…</div>;
  return <DashboardTemplateUI token={token} onNavigate={onNavigate} />;
};

