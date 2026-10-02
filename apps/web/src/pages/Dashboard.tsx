import { useEffect, useState } from 'react';
import { ArrowUpRight, BookOpen, Building2, CalendarCheck2, CalendarDays, CircleAlert, Clock3, GraduationCap, RefreshCw, Sparkles, Users, Waypoints } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, getErrorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Semester, Timetable } from '../types';
import { Button, Card, CardHeader, Notice, PageHeading, Pill } from '../components/ui';

const metrics = [
  { key: 'departments', label: 'Departments', icon: Building2, tone: 'bg-brand-50 text-brand-700' },
  { key: 'semesters', label: 'Semesters', icon: CalendarDays, tone: 'bg-violet-50 text-violet-700' },
  { key: 'faculty', label: 'Faculty members', icon: Users, tone: 'bg-emerald-50 text-emerald-700' },
  { key: 'subjects', label: 'Active subjects', icon: BookOpen, tone: 'bg-amber-50 text-amber-700' },
  { key: 'batches', label: 'Student batches', icon: GraduationCap, tone: 'bg-sky-50 text-sky-700' },
  { key: 'classrooms', label: 'Rooms & labs', icon: Building2, tone: 'bg-rose-50 text-rose-700' },
  { key: 'timetables', label: 'Timetable versions', icon: CalendarCheck2, tone: 'bg-indigo-50 text-indigo-700' },
  { key: 'pendingApprovals', label: 'Pending review', icon: CircleAlert, tone: 'bg-orange-50 text-orange-700' }
];

export function Dashboard() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<any>(null);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [timetables, setTimetables] = useState<Timetable[]>([]);
  const [error, setError] = useState('');
  const [readiness, setReadiness] = useState<any>(null);
  const [readinessError, setReadinessError] = useState('');
  const [readinessLoading, setReadinessLoading] = useState(true);
  async function refreshReadiness() {
    setReadinessLoading(true);
    setReadinessError('');
    try {
      const response = await api.get('/health/readiness', { validateStatus: status => status < 500 || status === 503 });
      setReadiness(response.data.data);
    } catch (reason) {
      setReadiness(null);
      setReadinessError(getErrorMessage(reason));
    } finally {
      setReadinessLoading(false);
    }
  }
  useEffect(() => {
    Promise.all([api.get('/dashboard/summary'), api.get('/semesters?limit=20'), api.get('/timetables?limit=6')]).then(([summaryResponse, semesterResponse, timetableResponse]) => {
      setSummary(summaryResponse.data.data); setSemesters(semesterResponse.data.data); setTimetables(timetableResponse.data.data);
    }).catch(reason => setError(getErrorMessage(reason)));
    void refreshReadiness();
  }, []);
  return <>
    <PageHeading eyebrow="Monday · academic operations" title={`Good ${new Date().getHours() < 12 ? 'morning' : 'afternoon'}, ${user?.name?.split(' ')[0] || 'there'}`} description="A clear view of the people, learning spaces, and constraints shaping the week." action={<Link to="/generate"><Button><Sparkles size={16} />Generate timetable</Button></Link>} />
    {error && <Notice tone="warning" title="API connection needed">{error} Check MongoDB and the API environment, then refresh to load live totals.</Notice>}
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4">
      {metrics.map(({ key, label, icon: Icon, tone }) => <Card key={key} className="p-4 sm:p-5"><div className="flex items-start justify-between"><span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}><Icon size={17} /></span><span className="rounded-full bg-slate-50 px-2 py-1 text-[9px] font-bold text-slate-400">LIVE</span></div><div className="mt-4 text-2xl font-bold tracking-tight text-ink">{summary ? summary[key] ?? 0 : '—'}</div><div className="mt-1 text-xs font-medium text-slate-500">{label}</div></Card>)}
    </div>
    <div className="grid gap-5 xl:grid-cols-[1.35fr_.85fr]">
      <Card>
        <CardHeader title="Semester setup" description="Profiles currently available in the workspace" action={<Link to="/semesters" className="inline-flex items-center gap-1 text-xs font-bold text-brand-600 hover:text-brand-700">Manage <ArrowUpRight size={14} /></Link>} />
        <div className="divide-y divide-line">
          {semesters.length ? semesters.map(semester => <div key={semester._id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50 text-slate-600"><GraduationCap size={18} /></div><div><div className="text-sm font-semibold text-slate-800">{semester.semesterName}</div><div className="mt-1 text-[11px] text-slate-500">Semester {semester.semesterNumber} · {semester.workingDays?.length || 0} working days · {semester.timeSlots?.length || 0} periods / day</div></div></div>
            <div className="flex items-center gap-2">{!semester.configurationVerified && <Pill tone="amber">Verify setup</Pill>}<Pill tone={semester.status === 'active' ? 'green' : 'slate'}>{semester.status}</Pill></div>
          </div>) : <div className="px-5"><div className="py-10 text-center text-xs text-slate-400">No semester profiles yet. Seed the reference structures or add one to get started.</div></div>}
        </div>
      </Card>
      <div className="space-y-5">
        <Card>
          <CardHeader title="Scheduling health" description="Hard constraints always take priority" />
          <div className="space-y-4 p-5">
            <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-xs text-slate-600"><span className="h-2 w-2 rounded-full bg-emerald-500" />Faculty, batch & room checks</div><Pill tone="green">Enforced</Pill></div>
            <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-xs text-slate-600"><span className="h-2 w-2 rounded-full bg-emerald-500" />Break & availability windows</div><Pill tone="green">Enforced</Pill></div>
            <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-xs text-slate-600"><span className="h-2 w-2 rounded-full bg-amber-400" />Reference data verification</div><Pill tone="amber">{semesters.filter(item => !item.configurationVerified).length} to review</Pill></div>
            <div className="border-t border-line pt-4"><Link to="/generate" className="flex items-center justify-between rounded-xl bg-ink px-4 py-3 text-white transition hover:bg-slate-800"><span><span className="block text-xs font-bold">Run pre-generation checks</span><span className="mt-1 block text-[10px] text-slate-300">Find missing data before solving</span></span><Waypoints size={18} /></Link></div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Local service readiness" description="Live API dependency checks" action={<Button size="sm" variant="ghost" onClick={() => void refreshReadiness()} disabled={readinessLoading}><RefreshCw size={13} className={readinessLoading ? 'animate-spin' : ''} />Refresh</Button>} />
          <div className="space-y-3 p-5">
            {[
              { key: 'api', label: 'Application API' },
              { key: 'database', label: 'MongoDB database' },
              { key: 'scheduler', label: 'CP-SAT scheduler' }
            ].map(({ key, label }) => {
              const status = readinessLoading ? 'checking' : readiness?.checks?.[key]?.status || 'unknown';
              const tone = status === 'ok' ? 'green' : status === 'checking' ? 'slate' : 'amber';
              const labelText = status === 'ok' ? 'Connected' : status === 'checking' ? 'Checking' : status === 'unavailable' ? 'Unavailable' : 'Unknown';
              return <div key={key} className="flex items-center justify-between gap-3"><span className="text-xs text-slate-600">{label}</span><Pill tone={tone}>{labelText}</Pill></div>;
            })}
            {readinessError && <Notice tone="warning" title="Could not load service status">{readinessError}</Notice>}
            {readiness?.checkedAt && <div className="border-t border-line pt-3 text-[10px] text-slate-400">Checked {new Date(readiness.checkedAt).toLocaleTimeString()}</div>}
            {readiness?.status === 'degraded' && <p className="text-[10px] leading-4 text-amber-700">Timetable generation may be unavailable until MongoDB and the scheduler are connected.</p>}
          </div>
        </Card>
        <Card>
          <CardHeader title="Recent timetable versions" description="Most recent generation activity" action={<Clock3 size={16} className="text-slate-400" />} />
          <div className="divide-y divide-line">
            {timetables.length ? timetables.slice(0, 4).map(item => <div key={item._id} className="flex items-center justify-between px-5 py-3"><div><div className="text-xs font-semibold text-slate-700">Semester schedule · v{item.version}</div><div className="mt-1 text-[10px] text-slate-400">{new Date(item.generationDate).toLocaleDateString()}</div></div><Pill tone={item.generationStatus === 'OPTIMAL' ? 'green' : item.generationStatus === 'FEASIBLE' ? 'blue' : 'amber'}>{item.generationStatus}</Pill></div>) : <div className="px-5 py-8 text-center text-xs text-slate-400">No generated timetables yet.</div>}
          </div>
        </Card>
      </div>
    </div>
    <div className="mt-5 grid gap-3 md:grid-cols-2">
      <Link to="/imports" className="rounded-2xl border border-brand-100 bg-gradient-to-r from-brand-50 to-white p-5 transition hover:shadow-soft"><div className="flex items-start justify-between"><div><p className="text-xs font-bold text-ink">Bring in structured data</p><p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">Validate multi-sheet Excel workbooks before anything is written to MongoDB.</p></div><BookOpen size={18} className="text-brand-600" /></div><span className="mt-4 inline-flex text-[11px] font-bold text-brand-700">Open import center <ArrowUpRight size={13} className="ml-1" /></span></Link>
      <Link to="/reports" className="rounded-2xl border border-line bg-white p-5 transition hover:shadow-soft"><div className="flex items-start justify-between"><div><p className="text-xs font-bold text-ink">Understand utilization</p><p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">Explore faculty workloads, room usage, subject-hour completion, and conflicts.</p></div><ActivityIcon /></div><span className="mt-4 inline-flex text-[11px] font-bold text-brand-700">View analytics <ArrowUpRight size={13} className="ml-1" /></span></Link>
    </div>
  </>;
}
function ActivityIcon() { return <Clock3 size={18} className="text-slate-400" />; }
