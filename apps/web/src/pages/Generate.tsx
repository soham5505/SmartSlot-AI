import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Clock3, Gauge, Play, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, getErrorMessage } from '../lib/api';
import type { Semester, Timetable } from '../types';
import { Button, Card, CardHeader, Notice, PageHeading, Pill, Select } from '../components/ui';

export function Generate() {
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [semesterId, setSemesterId] = useState('');
  const [diagnostics, setDiagnostics] = useState<any[]>([]);
  const [canGenerate, setCanGenerate] = useState(false);
  const [timeLimit, setTimeLimit] = useState(20);
  const [preserveLocks, setPreserveLocks] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const selected = semesters.find(item => item._id === semesterId);
  useEffect(() => {
    api.get('/semesters?limit=100').then(response => { const data = response.data.data as Semester[]; setSemesters(data); if (data.length) setSemesterId(data[0]._id); }).catch(reason => setMessage(getErrorMessage(reason))).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!semesterId) return;
    setCanGenerate(false); setResult(null);
    Promise.all([api.get(`/timetables/diagnostics/${semesterId}`), api.get(`/timetables/semester/${semesterId}/compare`)]).then(([diagnosticResponse, historyResponse]) => {
      setDiagnostics(diagnosticResponse.data.data.diagnostics); setCanGenerate(diagnosticResponse.data.data.canGenerate); setHistory(historyResponse.data.data);
    }).catch(reason => setMessage(getErrorMessage(reason)));
  }, [semesterId]);
  const blocking = diagnostics.filter(item => item.severity !== 'warning');
  const warnings = diagnostics.filter(item => item.severity === 'warning');
  const sortedSchedule = useMemo(() => [...(result?.data?.schedule || [])].sort((a: any, b: any) => a.day.localeCompare(b.day) || a.startTime.localeCompare(b.startTime)), [result]);
  async function generate() {
    if (!semesterId) return;
    setBusy(true); setMessage(''); setResult(null);
    try {
      const response = await api.post('/timetables/generate', { semesterId, options: { timeLimitSeconds: Number(timeLimit), preserveLockedSessions: preserveLocks } });
      setResult(response.data); setMessage('A verified schedule version was created. It remains a draft until an authorized reviewer publishes it.');
      const versions = await api.get(`/timetables/semester/${semesterId}/compare`); setHistory(versions.data.data);
    } catch (reason: any) {
      const data = reason?.response?.data;
      if (data?.status) setResult(data);
      setMessage(data?.error?.message || (data?.status ? `Solver status: ${data.status}. Review the diagnostics below.` : getErrorMessage(reason)));
      if (Array.isArray(data?.diagnostics)) setDiagnostics(data.diagnostics);
    } finally { setBusy(false); }
  }
  return <>
    <PageHeading eyebrow="Constraint optimization" title="Generate a timetable" description="First check the semester data, then let CP-SAT search for a conflict-free schedule. Mandatory constraints are never traded for a higher preference score." />
    <div className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]">
      <div className="space-y-5">
        <Card>
          <CardHeader title="Generation setup" description="Choose a configured semester and solver budget" />
          <div className="space-y-5 p-5">
            {loading ? <div className="text-sm text-slate-400">Loading semesters…</div> : <Select label="Semester" value={semesterId} onChange={event => setSemesterId(event.target.value)}><option value="">Choose semester</option>{semesters.map(item => <option key={item._id} value={item._id}>{item.semesterName} · Sem {item.semesterNumber}</option>)}</Select>}
            {selected && <div className="rounded-xl bg-slate-50 p-3"><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-bold text-ink">{selected.semesterName}</div><div className="mt-1 text-[10px] text-slate-500">{selected.workingDays?.length || 0} working days · {selected.timeSlots?.filter(slot => !slot.kind || slot.kind === 'class').length || 0} configured periods</div></div><Pill tone={selected.configurationVerified ? 'green' : 'amber'}>{selected.configurationVerified ? 'Verified' : 'Needs review'}</Pill></div></div>}
            <label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-700">Solver time limit</span><div className="relative"><input type="number" min={1} max={300} value={timeLimit} onChange={event => setTimeLimit(Number(event.target.value))} className="field-input pr-16" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">seconds</span></div><span className="text-[10px] text-slate-400">Higher limits may improve the soft-constraint score; a FEASIBLE result is still valid.</span></label>
            <label className="flex items-start gap-3 rounded-xl border border-line p-3"><input className="mt-0.5 h-4 w-4 accent-brand-600" type="checkbox" checked={preserveLocks} onChange={event => setPreserveLocks(event.target.checked)} /><span><span className="block text-xs font-semibold text-slate-700">Preserve locked sessions</span><span className="mt-1 block text-[10px] leading-4 text-slate-500">Existing locked periods and assigned resources stay fixed during regeneration.</span></span></label>
            <Button onClick={generate} disabled={busy || !semesterId || !canGenerate} className="w-full"><Play size={15} fill="currentColor" />{busy ? 'Solving constraints…' : 'Generate conflict-free timetable'}</Button>
            {!canGenerate && !loading && <p className="text-[10px] leading-4 text-slate-400">Generation unlocks when required data is complete and the reference configuration is verified.</p>}
          </div>
        </Card>
        <Card>
          <CardHeader title="Hard constraints" description="These rules cannot be violated" />
          <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-1">{['Faculty, batch and room collisions', 'Weekly periods and continuous labs', 'Availability, breaks and working days', 'Faculty daily and weekly workload'].map(item => <div key={item} className="flex items-center gap-2 text-[11px] text-slate-600"><ShieldCheck size={15} className="text-emerald-600" />{item}</div>)}</div>
        </Card>
        {history.length > 0 && <Card><CardHeader title="Previous versions" description="Compare solver outcomes for this semester" /><div className="divide-y divide-line">{history.slice(0, 5).map(item => <div key={item.id} className="flex items-center justify-between px-5 py-3"><div><span className="text-xs font-semibold text-slate-700">Version {item.version}</span><span className="ml-2 text-[10px] text-slate-400">{item.sessionCount} sessions</span></div><Pill tone={item.generationStatus === 'OPTIMAL' ? 'green' : item.generationStatus === 'FEASIBLE' ? 'blue' : 'amber'}>{item.generationStatus}</Pill></div>)}</div></Card>}
      </div>
      <div className="space-y-5">
        {message && <Notice tone={result?.status === 'OPTIMAL' || result?.status === 'FEASIBLE' ? 'success' : result ? 'warning' : 'info'} title={result?.status ? `Solver status: ${result.status}` : undefined}>{message}</Notice>}
        {warnings.length > 0 && <Notice tone="warning" title="Configuration warning">{warnings.map(item => item.explanation).join(' ')}</Notice>}
        <Card>
          <CardHeader title="Pre-generation diagnostics" description="Fix blockers before running the solver" action={<span className="flex items-center gap-1 text-[10px] text-slate-400"><Gauge size={14} />Independent checks</span>} />
          {diagnostics.length ? <div className="divide-y divide-line">{diagnostics.map((item, index) => <div key={`${item.type}-${index}`} className="flex gap-3 px-5 py-4"><span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${item.severity === 'warning' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>{item.severity === 'warning' ? <AlertTriangle size={15} /> : <AlertTriangle size={15} />}</span><div><div className="text-xs font-bold text-slate-800">{item.type.replaceAll('_', ' ')}</div><div className="mt-1 text-xs leading-5 text-slate-600">{item.explanation}</div><div className="mt-1 text-[10px] leading-4 text-slate-400">Action: {item.suggestion}</div></div></div>)}</div> : <div className="flex items-center gap-3 p-5 text-xs text-emerald-700"><Check size={17} />No blocking setup issues reported.</div>}
        </Card>
        {result?.data?.schedule?.length > 0 && <Card>
          <CardHeader title="Generated schedule preview" description={`${result.data.schedule.length} sessions · not published`} action={<Link to="/timetable" className="text-xs font-bold text-brand-600">Open editor →</Link>} />
          <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3">{result.optimizationScore != null && <Pill tone="green">Score {result.optimizationScore}/100</Pill>}<Pill tone="blue">{result.solver?.status || result.status}</Pill>{result.solver?.objectiveValue != null && <Pill tone="slate">Objective {Number(result.solver.objectiveValue).toFixed(1)}</Pill>}{result.solver?.wallTimeSeconds != null && <Pill tone="slate"><Clock3 size={11} className="mr-1" />{result.solver.wallTimeSeconds}s</Pill>}</div>
          {result.scoreBreakdown && <div className="grid grid-cols-2 gap-2 border-b border-line px-5 py-3 text-[10px] text-slate-500 sm:grid-cols-4"><span>Preference misses: <b className="text-slate-700">{result.scoreBreakdown.preferredSlotMisses ?? 0}</b></span><span>Gaps: <b className="text-slate-700">{result.scoreBreakdown.facultyGaps ?? 0}</b></span><span>First/last: <b className="text-slate-700">{result.scoreBreakdown.firstOrLastPeriodSessions ?? 0}</b></span><span>Long runs: <b className="text-slate-700">{result.scoreBreakdown.longConsecutiveRuns ?? 0}</b></span></div>}
          <div className="max-h-[540px] divide-y divide-line overflow-y-auto">{sortedSchedule.map((session: any, index: number) => <div key={`${session.assignmentId}-${session.day}-${session.startTime}-${index}`} className="grid grid-cols-[92px_1fr_auto] items-center gap-3 px-5 py-3"><div><div className="text-[11px] font-bold text-ink">{session.day}</div><div className="mt-1 text-[10px] text-slate-400">{session.startTime}–{session.endTime}</div></div><div><div className="text-xs font-semibold text-slate-700">{session.sessionType} <span className="font-normal text-slate-400">· {session.duration} periods</span></div><div className="mt-1 truncate text-[10px] text-slate-400">Subject {session.subjectId?.slice(-6)} · faculty {session.facultyId?.slice(-6)} · {session.batchId ? `batch ${session.batchId.slice(-4)}` : 'all batches'}</div></div>{session.locked && <Pill tone="amber">Locked</Pill>}</div>)}</div>
          <div className="border-t border-line p-4 text-[10px] leading-4 text-slate-400">Soft-constraint score is advisory. Hard constraints are independently validated before the version is stored and must be rechecked before publishing.</div>
        </Card>}
        {blocking.length === 0 && selected && !selected.configurationVerified && <Notice tone="warning" title="Reference review required">This semester has not been verified against its source PDF. Complete the setup and mark it verified before generation.</Notice>}
      </div>
    </div>
  </>;
}
