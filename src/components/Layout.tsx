import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  BookOpen,
  Building2,
  CalendarDays,
  FileBarChart2,
  GitMerge,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  ScrollText,
  Settings,
  Settings2,
  ShieldCheck,
  Target,
  UserCircle2,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import type { Notification } from '../api/types';
import { formatDate, roleLabel } from '../hooks/useAsync';
import { Badge } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: Array<'ADMIN' | 'TUTOR' | 'STUDENT'>;
  end?: boolean;
}

const NAV_GROUPS: Array<{ heading: string; items: NavItem[] }> = [
  {
    heading: 'Overview',
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['ADMIN', 'TUTOR', 'STUDENT'], end: true }],
  },
  {
    heading: 'Academic structure',
    items: [
      { to: '/departments', label: 'Departments', icon: Building2, roles: ['ADMIN'] },
      { to: '/programs', label: 'Programmes', icon: GraduationCap, roles: ['ADMIN'] },
      { to: '/semesters', label: 'Academic sessions', icon: CalendarDays, roles: ['ADMIN'] },
      { to: '/courses', label: 'Courses', icon: BookOpen, roles: ['ADMIN', 'TUTOR'] },
      { to: '/offerings', label: 'Course offerings', icon: ListChecks, roles: ['ADMIN', 'TUTOR', 'STUDENT'] },
    ],
  },
  {
    heading: 'Outcomes & assessment',
    items: [
      { to: '/plos', label: 'PLO framework', icon: Target, roles: ['ADMIN', 'TUTOR'] },
      { to: '/clo-plo-mapping', label: 'CLO–PLO mapping', icon: GitMerge, roles: ['ADMIN', 'TUTOR'] },
      { to: '/reports', label: 'Attainment & gaps', icon: FileBarChart2, roles: ['ADMIN', 'TUTOR', 'STUDENT'] },
    ],
  },
  {
    heading: 'Account',
    items: [
      { to: '/notifications', label: 'Notifications', icon: Bell, roles: ['ADMIN', 'TUTOR', 'STUDENT'] },
      { to: '/profile', label: 'Profile', icon: UserCircle2, roles: ['ADMIN', 'TUTOR', 'STUDENT'] },
      { to: '/settings', label: 'Settings', icon: Settings, roles: ['ADMIN', 'TUTOR', 'STUDENT'] },
    ],
  },
  {
    heading: 'Administration',
    items: [
      { to: '/users', label: 'Users & students', icon: Users, roles: ['ADMIN'] },
      { to: '/policies', label: 'Attainment policy', icon: Settings2, roles: ['ADMIN'] },
      { to: '/audit', label: 'Audit log', icon: ScrollText, roles: ['ADMIN'] },
    ],
  },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const bellRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMobileOpen(false);
    setBellOpen(false);
    setUserOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await api.notifications({ limit: 8 });
        if (!active) return;
        setNotifications(response.data);
        setUnread(response.meta.unread);
      } catch {
        // Notification failure must not block the application shell.
      }
    };
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(event.target as Node)) setBellOpen(false);
      if (userRef.current && !userRef.current.contains(event.target as Node)) setUserOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!user) return null;

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.roles.includes(user.role)),
  })).filter((group) => group.items.length > 0);

  const currentLabel =
    groups.flatMap((group) => group.items).find((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)))?.label ??
    'Workspace';

  const openNotification = async (notification: Notification) => {
    if (!notification.readAt) {
      try {
        await api.markRead(notification.id);
        setUnread((value) => Math.max(0, value - 1));
        setNotifications((current) =>
          current.map((item) => (item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item))
        );
      } catch {
        // The unread state remains unchanged if the update fails.
      }
    }
    setBellOpen(false);
    if (notification.link) navigate(notification.link);
  };

  return (
    <div className="min-h-screen bg-[#f2f4f7]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-gray-900 focus:px-4 focus:py-2 focus:text-xs focus:font-semibold focus:text-white"
      >
        Skip to main content
      </a>

      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-gray-900/30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-gray-200 bg-white p-4 transition-transform lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Primary navigation"
      >
        <div className="mb-5 flex items-center justify-between px-1">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-900 text-white">
              <GraduationCap size={19} />
            </span>
            <span>
              <span className="block text-sm font-bold leading-none tracking-tight text-gray-900">OBE System</span>
              <span className="mt-1 block text-[10px] font-medium text-gray-400">UIIT Rawalpindi</span>
            </span>
          </Link>
          <button
            type="button"
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <X size={16} />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto pr-1">
          {groups.map((group) => (
            <div key={group.heading}>
              <p className="mb-1.5 px-2 text-[9px] font-bold uppercase tracking-[0.16em] text-gray-400">{group.heading}</p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[11px] font-semibold transition-colors ${
                        isActive ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                      }`
                    }
                  >
                    <item.icon size={15} />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-4 rounded-2xl border border-gray-100 bg-gray-50/70 p-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-900 text-[11px] font-bold text-white">
              {user.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-bold text-gray-900">{user.name}</p>
              <p className="truncate text-[9px] text-gray-500">{roleLabel(user.role)}</p>
            </div>
            <ShieldCheck size={14} className="text-gray-400" aria-hidden />
          </div>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-gray-200/80 bg-[#f2f4f7]/90 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-xl border border-gray-200 bg-white p-2 text-gray-600 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={16} />
            </button>
            <div>
              <p className="text-[10px] font-medium text-gray-400">Workspace</p>
              <p className="text-xs font-bold text-gray-900">{currentLabel}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative" ref={bellRef}>
              <button
                type="button"
                onClick={() => setBellOpen((value) => !value)}
                className="relative rounded-full border border-gray-200 bg-white p-2.5 text-gray-600 hover:bg-gray-50"
                aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
                aria-expanded={bellOpen}
              >
                <Bell size={15} />
                {unread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </button>
              {bellOpen && (
                <div className="absolute right-0 mt-2 w-80 rounded-2xl border border-gray-200 bg-white p-2 shadow-xl">
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <p className="text-[11px] font-bold text-gray-900">Notifications</p>
                    <Badge tone={unread ? 'red' : 'gray'}>{unread} unread</Badge>
                  </div>
                  {notifications.length === 0 ? (
                    <p className="px-2 py-6 text-center text-[11px] text-gray-400">Nothing here yet.</p>
                  ) : (
                    <ul className="max-h-80 overflow-y-auto">
                      {notifications.map((notification) => (
                        <li key={notification.id}>
                          <button
                            type="button"
                            onClick={() => void openNotification(notification)}
                            className={`w-full rounded-xl px-2 py-2.5 text-left hover:bg-gray-50 ${
                              notification.readAt ? '' : 'bg-blue-50/40'
                            }`}
                          >
                            <p className="text-[11px] font-semibold text-gray-800">{notification.title}</p>
                            <p className="mt-0.5 line-clamp-2 text-[10px] text-gray-500">{notification.body}</p>
                            <p className="mt-1 text-[9px] text-gray-400">{formatDate(notification.createdAt, true)}</p>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Link
                    to="/notifications"
                    className="mt-1 block rounded-xl px-2 py-2 text-center text-[10px] font-semibold text-gray-600 hover:bg-gray-50"
                  >
                    View all notifications
                  </Link>
                </div>
              )}
            </div>

            <div className="relative" ref={userRef}>
              <button
                type="button"
                onClick={() => setUserOpen((value) => !value)}
                className="flex items-center gap-2 rounded-full border border-gray-200 bg-white py-1.5 pl-1.5 pr-3 hover:bg-gray-50"
                aria-expanded={userOpen}
                aria-label="Account menu"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-900 text-[10px] font-bold text-white">
                  {user.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}
                </span>
                <span className="hidden text-left sm:block">
                  <span className="block max-w-32 truncate text-[10px] font-bold text-gray-900">{user.name}</span>
                  <span className="block text-[8px] text-gray-400">{roleLabel(user.role)}</span>
                </span>
              </button>
              {userOpen && (
                <div className="absolute right-0 mt-2 w-52 rounded-2xl border border-gray-200 bg-white p-2 shadow-xl">
                  <div className="px-2 py-2">
                    <p className="truncate text-[11px] font-semibold text-gray-800">{user.email}</p>
                  </div>
                  <Link
                    to="/profile"
                    className="flex items-center gap-2 rounded-xl px-2 py-2 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
                  >
                    <UserCircle2 size={14} /> Profile
                  </Link>
                  <Link
                    to="/settings"
                    className="flex items-center gap-2 rounded-xl px-2 py-2 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
                  >
                    <Settings size={14} /> Settings
                  </Link>
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-[11px] font-medium text-rose-600 hover:bg-rose-50"
                  >
                    <LogOut size={14} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main id="main-content" className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
