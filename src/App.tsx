import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import { Loading } from './components/ui';
import type { Role } from './api/types';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Departments from './pages/Departments';
import Programs from './pages/Programs';
import Semesters from './pages/Semesters';
import Courses from './pages/Courses';
import CourseDetail from './pages/CourseDetail';
import Offerings from './pages/Offerings';
import OfferingDetail from './pages/OfferingDetail';
import AssessmentDetail from './pages/AssessmentDetail';
import PLOs from './pages/PLOs';
import CloPloMapping from './pages/CloPloMapping';
import Reports from './pages/Reports';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import Notifications from './pages/Notifications';
import Users from './pages/Users';
import AuditLog from './pages/AuditLog';
import Policies from './pages/Policies';
import NotFound from './pages/NotFound';

function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f2f4f7]">
        <Loading label="Restoring your session…" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Layout />;
}

function RoleRoute({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const { user, loading } = useAuth();
  return (
    <Routes>
      <Route
        path="/login"
        element={
          loading ? (
            <div className="flex min-h-screen items-center justify-center">
              <Loading />
            </div>
          ) : user ? (
            <Navigate to="/" replace />
          ) : (
            <Login />
          )
        }
      />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/departments" element={<RoleRoute roles={['ADMIN']}><Departments /></RoleRoute>} />
        <Route path="/programs" element={<RoleRoute roles={['ADMIN']}><Programs /></RoleRoute>} />
        <Route path="/semesters" element={<RoleRoute roles={['ADMIN']}><Semesters /></RoleRoute>} />
        <Route path="/courses" element={<RoleRoute roles={['ADMIN', 'TUTOR']}><Courses /></RoleRoute>} />
        <Route path="/courses/:id" element={<RoleRoute roles={['ADMIN', 'TUTOR']}><CourseDetail /></RoleRoute>} />
        <Route path="/offerings" element={<Offerings />} />
        <Route path="/offerings/:id" element={<OfferingDetail />} />
        <Route path="/assessments/:id" element={<AssessmentDetail />} />
        <Route path="/plos" element={<RoleRoute roles={['ADMIN', 'TUTOR']}><PLOs /></RoleRoute>} />
        <Route path="/clo-plo-mapping" element={<RoleRoute roles={['ADMIN', 'TUTOR']}><CloPloMapping /></RoleRoute>} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/users" element={<RoleRoute roles={['ADMIN']}><Users /></RoleRoute>} />
        <Route path="/audit" element={<RoleRoute roles={['ADMIN']}><AuditLog /></RoleRoute>} />
        <Route path="/policies" element={<RoleRoute roles={['ADMIN']}><Policies /></RoleRoute>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
