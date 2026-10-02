import { ArrowUpRight, ShieldCheck, SlidersHorizontal, Workflow } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardHeader, Notice, PageHeading, Pill } from '../components/ui';

const preferences = [
  ['Reduce faculty gaps', 'Encourage a compact teaching day while leaving hard availability untouched.', 'Soft preference'],
  ['Spread weekly teaching', 'Balance periods across configured working days.', 'Soft preference'],
  ['Respect requested slots', 'Reward faculty and assignment preferences when a feasible alternative exists.', 'Weighted'],
  ['Avoid first and last periods', 'Use edges less often where it does not reduce schedule feasibility.', 'Weighted'],
  ['Protect rooms, cohorts, and people', 'Never permit two sessions to overlap on a shared hard resource.', 'Hard constraint'],
  ['Protect continuous laboratories', 'Keep configured lab sessions in consecutive, uninterrupted periods.', 'Hard constraint']
];
export function Settings() {
  return <>
    <PageHeading eyebrow="System preferences" title="Scheduling settings" description="The optimization objective is configurable; the mandatory rules that prevent conflicts are not." />
    <div className="mb-5"><Notice tone="info" title="Semester-specific configuration">Working days, periods, breaks, lab duration, and batch structures are configured on each semester record. This avoids imposing one timetable shape on every year.</Notice></div>
    <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <Card><CardHeader title="Constraint catalogue" description="Preference weights can be passed with a generation request." action={<SlidersHorizontal size={16} className="text-slate-400" />} /><div className="divide-y divide-line">{preferences.map(([title, detail, kind]) => <div key={title} className="flex items-start justify-between gap-4 px-5 py-4"><div><div className="text-xs font-bold text-slate-700">{title}</div><div className="mt-1 max-w-xl text-[11px] leading-5 text-slate-500">{detail}</div></div><Pill tone={kind === 'Hard constraint' ? 'green' : 'blue'}>{kind}</Pill></div>)}</div></Card>
      <div className="space-y-5"><Card><CardHeader title="Security & access" description="Role-gated API access" action={<ShieldCheck size={16} className="text-emerald-600" />} /><div className="space-y-3 p-5">{['JWT access tokens with expiration', 'Hashed passwords; no plaintext secrets', 'Admin, HOD, Faculty, and Student roles', 'Timetable edit and import audit events', 'Soft deactivation preserves historical references'].map(item => <div key={item} className="flex items-center gap-2 text-[11px] text-slate-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{item}</div>)}</div></Card><Card><CardHeader title="Reference data" description="PDF details require review before generation" action={<Workflow size={16} className="text-brand-600" />} /><div className="p-5"><p className="text-xs leading-5 text-slate-500">The source timetable PDFs were not present in the checkout. Sample IT semester profiles are tagged unverified; missing courses, faculty, rooms, exact periods, and unclear group parentage are not fabricated.</p><Link to="/semesters" className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-brand-600">Review semester profiles <ArrowUpRight size={14} /></Link></div></Card></div>
    </div>
  </>;
}
