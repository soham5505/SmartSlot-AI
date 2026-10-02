import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Activity, BookOpen, Building2, CalendarDays, ChevronDown, ClipboardList, FileSpreadsheet, GraduationCap, LayoutDashboard, Menu, PanelLeftClose, School, Settings, Users, X, WandSparkles } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { initials } from '../lib/api';

type NavItem = { to: string; label: string; icon: any; roles?: string[] };
type NavGroup = { label: string; roles?: string[]; items: NavItem[] };
const navGroups: NavGroup[] = [
  { label: 'Workspace', items: [
    { to: '/', label: 'Overview', icon: LayoutDashboard },
    { to: '/timetable', label: 'Timetable', icon: CalendarDays },
    { to: '/generate', label: 'Generate schedule', icon: WandSparkles, roles: ['Admin', 'HOD'] },
    { to: '/published', label: 'Published archive', icon: ClipboardList }
  ] },
  { label: 'Academic setup', roles: ['Admin', 'HOD'], items: [
    { to: '/departments', label: 'Departments', icon: Building2 },
    { to: '/academic-years', label: 'Academic years', icon: CalendarDays },
    { to: '/semesters', label: 'Semesters', icon: School },
    { to: '/faculty', label: 'Faculty', icon: Users },
    { to: '/subjects', label: 'Subjects', icon: BookOpen },
    { to: '/batches', label: 'Batches', icon: Users },
    { to: '/classrooms', label: 'Classrooms', icon: Building2 },
    { to: '/assignments', label: 'Assignments', icon: ClipboardList }
  ] },
  { label: 'Insights', items: [
    { to: '/imports', label: 'Excel import', icon: FileSpreadsheet, roles: ['Admin', 'HOD'] },
    { to: '/reports', label: 'Analytics & reports', icon: Activity, roles: ['Admin', 'HOD'] },
    { to: '/settings', label: 'Settings', icon: Settings, roles: ['Admin', 'HOD'] }
  ] }
];

export function Layout() {
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const location = useLocation();
  const current = navGroups.flatMap(group => group.items).find(item => item.to === location.pathname);
  return <div className="min-h-screen bg-canvas text-slate-900">
    {mobileOpen && <button className="fixed inset-0 z-30 bg-slate-950/30 md:hidden" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[256px] flex-col border-r border-line bg-white transition-transform md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex h-[76px] items-center justify-between border-b border-line px-6">
        <NavLink to="/" className="flex items-center gap-3" onClick={() => setMobileOpen(false)}>
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ink text-white shadow-sm"><CalendarDays size={20} /></div>
          <div><div className="font-bold tracking-tight text-ink">SmartSlot<span className="text-brand-600"> AI</span></div><div className="text-[10px] font-semibold uppercase tracking-[.14em] text-slate-400">Academic planner</div></div>
        </NavLink>
        <button className="icon-button md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X size={18} /></button>
      </div>
      <nav className="scrollbar-thin flex-1 space-y-7 overflow-y-auto px-3 py-6">
        {navGroups.map(group => {
          if (group.roles && !group.roles.includes(user?.role || '')) return null;
          const items = group.items.filter(item => !item.roles || item.roles.includes(user?.role || ''));
          return <div key={group.label}>
            <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">{group.label}</p>
            <div className="space-y-1">{items.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}><Icon size={17} strokeWidth={1.9} /><span>{label}</span></NavLink>)}</div>
          </div>;
        })}
      </nav>
      <div className="border-t border-line p-4">
        <div className="rounded-2xl bg-slate-50 p-3"><div className="flex items-center gap-2 text-xs font-semibold text-ink"><span className="h-2 w-2 rounded-full bg-emerald-500" />Constraint engine</div><p className="mt-1 text-[11px] leading-4 text-slate-500">Hard rules protect every generated schedule.</p></div>
      </div>
    </aside>
    <div className="min-h-screen md:pl-[256px]">
      <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-line bg-white/90 px-4 backdrop-blur md:px-8">
        <div className="flex items-center gap-3"><button className="icon-button md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={19} /></button><div><p className="text-xs font-medium text-slate-400">SmartSlot AI <span className="px-1">/</span> {current?.label || 'Overview'}</p><p className="hidden text-sm font-semibold text-slate-800 sm:block">Academic scheduling workspace</p></div></div>
        <div className="relative">
          <button onClick={() => setProfileOpen(!profileOpen)} className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-slate-50">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-xs font-bold text-brand-700">{initials(user?.name)}</span>
            <span className="hidden sm:block"><span className="block text-xs font-semibold text-slate-800">{user?.name}</span><span className="block text-[10px] text-slate-500">{user?.role}</span></span>
            <ChevronDown size={15} className="hidden text-slate-400 sm:block" />
          </button>
          {profileOpen && <div className="absolute right-0 top-12 z-30 w-52 rounded-2xl border border-line bg-white p-2 shadow-soft"><div className="px-3 py-2"><div className="text-xs font-semibold">{user?.email}</div><div className="text-[11px] text-slate-500">{user?.role} access</div></div><button onClick={logout} className="w-full rounded-xl px-3 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50">Sign out</button></div>}
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] px-4 py-6 md:px-8 md:py-8"><Outlet /></main>
      <footer className="px-4 pb-6 text-center text-[10px] text-slate-400 md:px-8">SmartSlot AI · Constraints first, preferences second.</footer>
    </div>
  </div>;
}
