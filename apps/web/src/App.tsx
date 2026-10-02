import { BrowserRouter, Navigate, Route, Routes, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Generate } from './pages/Generate';
import { Timetable } from './pages/Timetable';
import { Imports } from './pages/Imports';
import { Reports } from './pages/Reports';
import { Resources } from './pages/Resources';
import { Settings } from './pages/Settings';

function Protected() {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center bg-canvas text-sm text-slate-500">Loading SmartSlot…</div>;
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}
function AppRoutes() {
  return <Routes>
    <Route path="/login" element={<Login />} />
    <Route element={<Protected />}>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="generate" element={<Generate />} />
        <Route path="timetable" element={<Timetable />} />
        <Route path="published" element={<Timetable publishedOnly />} />
        <Route path="imports" element={<Imports />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
        <Route path="departments" element={<Resources page="departments" />} />
        <Route path="academic-years" element={<Resources page="academic-years" />} />
        <Route path="semesters" element={<Resources page="semesters" />} />
        <Route path="faculty" element={<Resources page="faculty" />} />
        <Route path="subjects" element={<Resources page="subjects" />} />
        <Route path="batches" element={<Resources page="batches" />} />
        <Route path="classrooms" element={<Resources page="classrooms" />} />
        <Route path="assignments" element={<Resources page="assignments" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Route>
  </Routes>;
}
export default function App() { return <BrowserRouter><AuthProvider><AppRoutes /></AuthProvider></BrowserRouter>; }
