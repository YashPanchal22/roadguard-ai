import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { OverviewPage } from './pages/OverviewPage';
import { ReportDamagePage } from './pages/ReportDamagePage';
import { DetectionPage } from './pages/DetectionPage';
import { MapPage } from './pages/MapPage';
import { ReportsPage } from './pages/ReportsPage';
import { RepairsPage } from './pages/RepairsPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { ModelPage } from './pages/ModelPage';
import { ExportsPage } from './pages/ExportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { LoginPage } from './pages/LoginPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppLayout />}>
        <Route index element={<OverviewPage />} />
        <Route path="/report" element={<ReportDamagePage />} />
        <Route path="/detection" element={<DetectionPage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/reports/:reportId" element={<ReportsPage />} />
        <Route path="/repairs" element={<RepairsPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/model" element={<ModelPage />} />
        <Route path="/exports" element={<ExportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
