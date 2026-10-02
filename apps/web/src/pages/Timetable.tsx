import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, GripVertical, LockKeyhole, RotateCcw, Save, UnlockKeyhole } from 'lucide-react';
import { api, getErrorMessage, saveBlob } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { ScheduleSession, Semester, Timetable } from '../types';
import { Button, Card, CardHeader, EmptyState, Notice, PageHeading, Pill, Select } from '../components/ui';

type DisplaySession = ScheduleSession & { subjectShortName?: string; subjectCode?: string; subjectName?: string; facultyName?: string; facultyInitials?: string; batchCode?: string; classroomCode?: string; classroomName?: string };
const sessionFields: (keyof ScheduleSession)[] = ['_id', 'day', 'startTime', 'endTime', 'subjectId', 'facultyId', 'batchId', 'classroomId', 'sessionType', 'duration', 'assignmentId', 'locked'];
const typeStyle: Record<string, string> = { Theory: 'border-blue-200 bg-blue-50 text-blue-900', Lab: 'border-violet-200 bg-violet-50 text-violet-900', Tutorial: 'border-amber-200 bg-amber-50 text-amber-900', Project: 'border-teal-200 bg-teal-50 text-teal-900' };
const timeToMinutes = (value: string) => { const [hours, minutes] = value.split(':').map(Number); return hours * 60 + minutes; };

export function Timetable({ publishedOnly = false }: { publishedOnly?: boolean }) {
  const { user } = useAuth();
  const canEdit = user?.role === 'Admin' || user?.role === 'HOD';
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [semesterId, setSemesterId] = useState('');
  const [timetables, setTimetables] = useState<Timetable[]>([]);
  const [timetableId, setTimetableId] = useState('');
  const [view, setView] = useState<any>(null);
  const [schedule, setSchedule] = useState<DisplaySession[]>([]);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [subjects, setSubjects] = useState<any[]>([]);
  const [faculty, setFaculty] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [scope, setScope] = useState('semester');
  const [scopeId, setScopeId] = useState('');
  const [editing, setEditing] = useState<DisplaySession | null>(null);
  const [editForm, setEditForm] = useState({ facultyId: '', classroomId: '', batchId: '' });
  const [dragged, setDragged] = useState<DisplaySession | null>(null);

  const loadSemesters = useCallback(async () => {
    try { const response = await api.get('/semesters?limit=100'); setSemesters(response.data.data); if (!semesterId && response.data.data.length) setSemesterId(response.data.data[0]._id); }
    catch (reason) {
      // Student accounts can see published versions only; the timetable endpoint provides their semester scope.
      if (user?.role !== 'Student') setError(getErrorMessage(reason));
    }
  }, [semesterId, user?.role]);
  useEffect(() => { void loadSemesters().finally(() => setLoading(false)); }, [loadSemesters]);
  useEffect(() => {
    if (!semesterId) return;
    setLoading(true); setError(''); setSuccess(''); setDirty(false); setView(null); setSchedule([]);
    api.get('/timetables', { params: { semesterId, limit: 50, ...(publishedOnly ? { published: true } : {}) } }).then(response => {
      const items = response.data.data as Timetable[]; setTimetables(items); const current = items[0]; setTimetableId(current?._id || '');
    }).catch(reason => setError(getErrorMessage(reason))).finally(() => setLoading(false));
  }, [semesterId, publishedOnly]);
  const loadView = useCallback(async () => {
    if (!timetableId) { setView(null); setSchedule([]); return; }
    try {
      const response = await api.get(`/timetables/${timetableId}/view`);
      setView(response.data.data); setSchedule(response.data.data.schedule || []); setDirty(false);
      if (!semesterId && response.data.data.semesterId) setSemesterId(response.data.data.semesterId);
    } catch (reason) { setError(getErrorMessage(reason)); }
  }, [timetableId, semesterId]);
  useEffect(() => { void loadView(); }, [loadView]);
  useEffect(() => {
    if (!semesterId || !canEdit) return;
    Promise.allSettled([
      api.get(`/subjects?semesterId=${semesterId}&limit=100`), api.get(`/faculty?limit=100`), api.get(`/batches?semesterId=${semesterId}&limit=100`), api.get('/classrooms?limit=100'), api.get(`/assignments?semesterId=${semesterId}&limit=100`)
    ]).then(results => {
      if (results[0].status === 'fulfilled') setSubjects(results[0].value.data.data);
      if (results[1].status === 'fulfilled') setFaculty(results[1].value.data.data);
      if (results[2].status === 'fulfilled') setBatches(results[2].value.data.data);
      if (results[3].status === 'fulfilled') setRooms(results[3].value.data.data);
      if (results[4].status === 'fulfilled') setAssignments(results[4].value.data.data);
    });
  }, [semesterId, canEdit]);

  const selectedSemester = semesters.find(item => item._id === semesterId);
  const slots = useMemo(() => {
    const raw = (view?.timeSlots || selectedSemester?.timeSlots || []) as Semester['timeSlots'];
    const map = new Map<number, any>();
    raw.filter(slot => !slot.kind || slot.kind === 'class').forEach(slot => {
      const existing = map.get(slot.periodIndex);
      if (!existing || !slot.day) map.set(slot.periodIndex, slot);
    });
    return [...map.values()].sort((a, b) => a.periodIndex - b.periodIndex);
  }, [view, selectedSemester]);
  const days = view?.workingDays || selectedSemester?.workingDays || [];
  const timeColumns = useMemo(() => {
    const breaks = view?.breakConfiguration || selectedSemester?.breakConfiguration || [];
    const breakColumns = breaks.map((item: any, index: number) => ({ ...item, axisKind: 'break' as const, key: `break-${item.name}-${item.startTime}-${index}` }));
    const classColumns = slots.map((slot: any) => ({ ...slot, axisKind: 'class' as const, key: `period-${slot.periodIndex}` }));
    return [...classColumns, ...breakColumns].sort((a, b) => {
      const byTime = timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
      if (byTime) return byTime;
      if (a.axisKind === b.axisKind) return 0;
      return a.axisKind === 'break' ? -1 : 1;
    });
  }, [slots, view, selectedSemester]);
  const choices = useMemo(() => {
    if (scope === 'batch') return batches;
    if (scope === 'faculty') return faculty;
    if (scope === 'classroom') return rooms;
    return [];
  }, [scope, batches, faculty, rooms]);
  const shown = useMemo(() => schedule.filter(session => {
    if (scope === 'semester' || !scopeId) return true;
    const field = scope === 'batch' ? session.batchId : scope === 'faculty' ? session.facultyId : 'classroomId' in session ? (session as any).classroomId : '';
    return String(field || '') === scopeId || (scope === 'batch' && !field);
  }), [schedule, scope, scopeId]);
  const sessionsAt = (day: string, startTime: string) => shown.filter(session => session.day === day && session.startTime === startTime);
  const latestTimetable = timetables.find(item => item._id === timetableId);
  const editAllowed = canEdit && latestTimetable && !latestTimetable.published && !latestTimetable.locked && !publishedOnly;

  function startEdit(session: DisplaySession) {
    if (!editAllowed || session.locked) return;
    setEditing(session); setEditForm({ facultyId: session.facultyId, classroomId: session.classroomId, batchId: session.batchId || '' }); setError('');
  }
  function dropOn(day: string, slot: any, event: React.DragEvent) {
    event.preventDefault();
    if (!editAllowed || !dragged || dragged.locked || !selectedSemester) return;
    const daySlots = selectedSemester.timeSlots.filter(item => (!item.day || item.day.toLowerCase() === day.toLowerCase()) && (!item.kind || item.kind === 'class')).sort((a, b) => a.periodIndex - b.periodIndex);
    const index = daySlots.findIndex(item => item.periodIndex === slot.periodIndex);
    const durationSlots = daySlots.slice(index, index + dragged.duration);
    const contiguous = durationSlots.length === dragged.duration && durationSlots.every((item, i) => i === 0 || item.periodIndex === durationSlots[i - 1].periodIndex + 1 && item.startTime === durationSlots[i - 1].endTime);
    if (!contiguous) { setError('That drop target does not have enough consecutive teaching periods for this session.'); return; }
    setSchedule(current => current.map(item => item._id === dragged._id ? { ...item, day, startTime: durationSlots[0].startTime, endTime: durationSlots[durationSlots.length - 1].endTime } : item));
    setDirty(true); setDragged(null); setError(''); setSuccess('Session moved in the draft. Save changes to run server-side conflict validation.');
  }
  async function saveSchedule(nextSchedule = schedule) {
    if (!timetableId) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      const payload = nextSchedule.map(session => Object.fromEntries(sessionFields.filter(field => (session as any)[field] !== undefined).map(field => [field, (session as any)[field]])));
      await api.put(`/timetables/${timetableId}`, { schedule: payload });
      await loadView();
      const listResponse = await api.get('/timetables', { params: { semesterId, limit: 50, ...(publishedOnly ? { published: true } : {}) } }); setTimetables(listResponse.data.data);
      setSuccess('Changes passed independent hard-constraint validation and were saved as a draft.');
    } catch (reason: any) {
      const details = reason?.response?.data?.error?.details;
      const message = Array.isArray(details) ? details.map((item: any) => `${item.type}: ${item.explanation}`).slice(0, 4).join(' · ') : getErrorMessage(reason);
      setError(message);
    } finally { setSaving(false); }
  }
  async function saveSessionEdit() {
    if (!editing || !latestTimetable) return;
    const originalAssignment: any = assignments.find(item => String(item._id) === String(editing.assignmentId));
    const assignmentChanges: any = {};
    if (originalAssignment && editForm.facultyId !== String(originalAssignment.facultyId)) assignmentChanges.facultyId = editForm.facultyId;
    if (originalAssignment?.batchId && editForm.batchId !== String(originalAssignment.batchId)) assignmentChanges.batchId = editForm.batchId || null;
    if (originalAssignment?.classroomId && editForm.classroomId !== String(originalAssignment.classroomId)) assignmentChanges.classroomId = editForm.classroomId || null;
    let changedAssignment = false;
    try {
      if (Object.keys(assignmentChanges).length && originalAssignment) {
        const patch = { semesterId: originalAssignment.semesterId, subjectId: originalAssignment.subjectId, facultyId: assignmentChanges.facultyId ?? originalAssignment.facultyId, batchId: assignmentChanges.batchId ?? originalAssignment.batchId, classroomId: assignmentChanges.classroomId ?? originalAssignment.classroomId, weeklyPeriods: originalAssignment.weeklyPeriods, sessionDuration: originalAssignment.sessionDuration, courseType: originalAssignment.courseType, preferredSlots: originalAssignment.preferredSlots || [], active: originalAssignment.active, needsVerification: originalAssignment.needsVerification };
        await api.put(`/assignments/${originalAssignment._id}`, patch); changedAssignment = true;
      }
      const updated = schedule.map(session => {
        if (session._id !== editing._id) {
          if (session.assignmentId === editing.assignmentId && changedAssignment) return { ...session, ...assignmentChanges, facultyId: assignmentChanges.facultyId || session.facultyId, batchId: assignmentChanges.batchId === undefined ? session.batchId : assignmentChanges.batchId, classroomId: assignmentChanges.classroomId || session.classroomId };
          return session;
        }
        return { ...session, facultyId: editForm.facultyId, classroomId: editForm.classroomId, batchId: editForm.batchId || null };
      });
      await saveSchedule(updated);
      setEditing(null);
    } catch (reason) {
      if (changedAssignment && originalAssignment) {
        try { await api.put(`/assignments/${originalAssignment._id}`, { semesterId: originalAssignment.semesterId, subjectId: originalAssignment.subjectId, facultyId: originalAssignment.facultyId, batchId: originalAssignment.batchId ?? null, classroomId: originalAssignment.classroomId ?? null, weeklyPeriods: originalAssignment.weeklyPeriods, sessionDuration: originalAssignment.sessionDuration, courseType: originalAssignment.courseType, preferredSlots: originalAssignment.preferredSlots || [] }); }
        catch { setError('The assignment was changed but automatic rollback failed. Review the assignment record before continuing.'); }
      }
      if (!error) setError(getErrorMessage(reason));
    }
  }
  async function publish() {
    if (!timetableId) return;
    setSaving(true); setError('');
    try { await api.post(`/timetables/${timetableId}/publish`, { locked: true }); await loadView(); const response = await api.get('/timetables', { params: { semesterId, limit: 50 } }); setTimetables(response.data.data); setSuccess('Timetable validated, published, and locked.'); }
    catch (reason: any) { setError(reason?.response?.data?.error?.details?.map?.((item: any) => item.explanation).join(' · ') || getErrorMessage(reason)); }
    finally { setSaving(false); }
  }
  async function unlock() {
    if (!timetableId) return;
    try { await api.post(`/timetables/${timetableId}/unlock`); await loadView(); const response = await api.get('/timetables', { params: { semesterId, limit: 50 } }); setTimetables(response.data.data); setSuccess('A new edit cycle is open. The published archive entry remains available.'); }
    catch (reason) { setError(getErrorMessage(reason)); }
  }
  async function exportFile(format: 'pdf' | 'excel') {
    if (!timetableId) return;
    try { const response = await api.get(`/timetables/${timetableId}/export/${format}`, { responseType: 'blob' }); saveBlob(response.data, `smartslot-timetable-v${latestTimetable?.version || ''}.${format === 'excel' ? 'xlsx' : 'pdf'}`); }
    catch (reason) { setError(getErrorMessage(reason)); }
  }

  return <>
    <PageHeading eyebrow={publishedOnly ? 'Student access · approved schedules' : 'Weekly planning'} title={publishedOnly ? 'Published timetables' : 'Timetable editor'} description={publishedOnly ? 'Browse and download approved department, semester, and batch schedules.' : 'Review generated versions, inspect timetable scope, and safely edit a draft before approval.'} action={<div className="flex gap-2"><Button variant="secondary" size="sm" disabled={!timetableId} onClick={() => exportFile('excel')}><Download size={14} />Excel</Button><Button variant="secondary" size="sm" disabled={!timetableId} onClick={() => exportFile('pdf')}><Download size={14} />PDF</Button></div>} />
    <Card className="mb-5"><div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <Select label="Semester" value={semesterId} onChange={event => setSemesterId(event.target.value)}><option value="">Select a semester</option>{semesters.map(item => <option key={item._id} value={item._id}>{item.semesterName}</option>)}{!semesters.length && timetables.map(item => <option key={item.semesterId} value={item.semesterId}>{(item as any).semesterName || `Semester ${item.semesterId.slice(-5)}`}</option>)}</Select>
      <Select label="Timetable version" value={timetableId} onChange={event => setTimetableId(event.target.value)}><option value="">No version selected</option>{timetables.map(item => <option key={item._id} value={item._id}>v{item.version} · {item.generationStatus}{item.published ? ' · Published' : ''}</option>)}</Select>
      <Select label="View scope" value={scope} onChange={event => { setScope(event.target.value); setScopeId(''); }}><option value="semester">Semester combined</option><option value="batch">Batch</option><option value="faculty">Faculty</option><option value="classroom">Classroom</option></Select>
      {scope !== 'semester' && <Select label={`Filter ${scope}`} value={scopeId} onChange={event => setScopeId(event.target.value)}><option value="">All {scope}s</option>{choices.map((item: any) => <option key={item._id} value={item._id}>{item.name || item.batchCode || item.employeeId || item.roomCode}</option>)}</Select>}
    </div></Card>
    {error && <div className="mb-4"><Notice tone="danger">{error}</Notice></div>}{success && <div className="mb-4"><Notice tone="success">{success}</Notice></div>}
    {view && <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white px-5 py-4"><div><div className="text-sm font-bold text-ink">{view.semesterName || selectedSemester?.semesterName || 'Semester schedule'}</div><div className="mt-1 text-[10px] text-slate-500">Version {view.version} · Generated {new Date(view.generationDate).toLocaleString()} · {schedule.length} sessions</div></div><div className="flex flex-wrap items-center gap-2"><Pill tone={view.generationStatus === 'OPTIMAL' ? 'green' : view.generationStatus === 'FEASIBLE' ? 'blue' : 'amber'}>{view.generationStatus}</Pill>{view.optimizationScore != null && <Pill tone="slate">Score {view.optimizationScore}/100</Pill>}{view.published && <Pill tone="green">Published</Pill>}{view.locked && <Pill tone="amber">Locked</Pill>}{editAllowed && dirty && <Button size="sm" disabled={saving} onClick={() => saveSchedule()}><Save size={14} />{saving ? 'Validating…' : 'Save draft changes'}</Button>}{editAllowed && view.generationStatus === 'FEASIBLE' || editAllowed && view.generationStatus === 'OPTIMAL' ? <Button size="sm" onClick={publish} disabled={saving}>Publish & lock</Button> : null}{canEdit && view.locked && <Button size="sm" variant="secondary" onClick={unlock}><UnlockKeyhole size={14} />Unlock version</Button>}{dirty && <Button size="sm" variant="ghost" onClick={() => { void loadView(); setSuccess(''); }}><RotateCcw size={14} />Discard</Button>}</div></div>}
    {view && view.configurationVerified === false && <div className="mb-4"><Notice tone="warning" title="Reference timetable configuration is unverified">{view.sourceNotes || 'Review the institution-provided period grid, breaks, and group mapping before generation or publication.'}</Notice></div>}
    {!loading && view && !slots.length && <div className="mb-4"><Notice tone="warning" title="No teaching periods configured">Add and verify the period grid for this semester before editing or exporting a weekly view.</Notice></div>}
    <Card>
      <CardHeader title="Weekly schedule" description={editAllowed ? 'Drag an unlocked class to another valid period or open a class to change its resources. Save runs full server-side validation.' : 'Theory, practical, tutorial and project sessions use separate accessible colors.'} action={schedule.length > 0 && <Pill tone={editAllowed ? 'blue' : 'slate'}>{editAllowed ? 'Draft editor' : view?.published ? 'Published view' : 'Read only'}</Pill>} />
      {loading ? <div className="p-10 text-center text-sm text-slate-400">Loading timetable…</div> : !view ? <EmptyState title="No timetable version available" description={publishedOnly ? 'Published timetables appear here after an administrator approves them.' : 'Generate a valid version first, or choose another semester.'} /> : !days.length || !slots.length ? <EmptyState title="Timetable layout needs configuration" description="Add the exact working days and class periods for this semester before generation or editing." />  : <div className="overflow-x-auto"><table className="w-full min-w-[980px] border-separate border-spacing-0"><thead><tr><th className="sticky left-0 z-10 min-w-[115px] border-b border-line bg-slate-50 p-3 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">Day</th>{timeColumns.map(column => column.axisKind === 'break' ? <th key={column.key} className="min-w-[84px] border-b border-line bg-amber-100 px-2 py-3 text-center"><span className="block text-[9px] font-bold text-amber-900">{column.name}</span><span className="mt-1 block text-[8px] text-amber-800">{column.startTime}–{column.endTime}</span></th> : <th key={column.key} className="min-w-[130px] border-b border-line bg-slate-50 px-3 py-3 text-center"><span className="block text-[10px] font-bold text-slate-600">P{column.periodIndex}</span><span className="mt-1 block text-[9px] text-slate-400">{column.startTime}–{column.endTime}</span></th>)}</tr></thead><tbody>{days.map((day: string, dayIndex: number) => <tr key={day}><th className="sticky left-0 z-10 border-b border-r border-line bg-white px-4 py-4 text-left text-xs font-bold text-ink">{day}</th>{timeColumns.map(column => {
        if (column.axisKind === 'break') {
          const breakDays: string[] = column.days || [];
          const sharedBreak = !breakDays.length || days.every((entry: string) => breakDays.some(value => value.toLowerCase() === entry.toLowerCase()));
          if (sharedBreak && dayIndex > 0) return null;
          const appliesToday = !breakDays.length || breakDays.some(value => value.toLowerCase() === day.toLowerCase());
          return <td key={`${day}-${column.key}`} rowSpan={sharedBreak ? days.length : undefined} className={`min-w-[84px] border-b border-r border-line p-1 text-center align-middle ${appliesToday ? 'bg-amber-50' : 'bg-white'}`}>{appliesToday && <div className="text-[9px] font-semibold leading-relaxed text-amber-900">{column.name}<br /><span className="text-[8px] font-normal text-amber-800">{column.startTime}–{column.endTime}</span></div>}</td>;
        }
        const slot = column;
        const cellSessions = sessionsAt(day, slot.startTime);
        return <td key={`${day}-${slot.periodIndex}`} onDragOver={event => editAllowed && event.preventDefault()} onDrop={event => dropOn(day, slot, event)} className="h-[126px] min-w-[130px] border-b border-r border-line bg-white p-1.5 align-top transition hover:bg-slate-50/80">
          <div className="flex h-full flex-col gap-1.5">{cellSessions.map(session => <div key={session._id || `${session.assignmentId}-${session.day}-${session.startTime}`} draggable={Boolean(editAllowed && !session.locked)} onDragStart={event => { setDragged(session); event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setDragged(null)} onDoubleClick={() => startEdit(session)} className={`group relative min-h-[86px] rounded-xl border p-2 text-left text-[10px] ${typeStyle[session.sessionType] || typeStyle.Theory} ${editAllowed && !session.locked ? 'cursor-grab active:cursor-grabbing' : ''}`}>
            <div className="flex items-start justify-between gap-1"><span className="font-extrabold">{session.subjectShortName || session.subjectCode || `SUB-${session.subjectId.slice(-4)}`}</span><span className="text-[8px] font-bold opacity-60">{session.duration}p</span></div>
            <div className="mt-1 truncate text-[9px] opacity-80">{session.facultyInitials || session.facultyName || `F-${session.facultyId.slice(-4)}`}{session.batchCode && session.batchCode !== 'All batches' ? ` · ${session.batchCode}` : ''}</div>
            <div className="mt-1 truncate text-[9px] font-semibold opacity-70">{session.classroomCode || `R-${session.classroomId.slice(-4)}`} · {session.sessionType}</div>
            {session.locked && <LockKeyhole size={11} className="absolute bottom-2 right-2 opacity-60" />}
            {editAllowed && !session.locked && <button className="absolute bottom-1 right-1 rounded-md bg-white/70 px-1.5 py-1 text-[8px] font-bold opacity-0 transition group-hover:opacity-100" onClick={() => startEdit(session)}>Edit</button>}
          </div>)}</div>
        </td>;
      })}</tr>)}</tbody></table></div>}
      {view && <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-line px-5 py-3">{Object.entries(typeStyle).map(([type, style]) => <span key={type} className={`rounded-full border px-2.5 py-1 text-[9px] font-semibold ${style}`}>{type}</span>)}{view.breakConfiguration?.map((item: any) => <span key={item.name} className="rounded-full bg-slate-100 px-2.5 py-1 text-[9px] text-slate-500">{item.name} · {item.startTime}–{item.endTime}</span>)}</div>}
    </Card>
    {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-lg rounded-2xl bg-white shadow-xl"><div className="border-b border-line px-5 py-4"><h2 className="text-sm font-bold text-ink">Edit session resources</h2><p className="mt-1 text-[11px] text-slate-500">Changes are validated against assignments and hard constraints before saving.</p></div><div className="space-y-4 p-5"><div className="rounded-xl bg-slate-50 p-3 text-xs"><b>{editing.subjectShortName || editing.subjectCode}</b> · {editing.day} {editing.startTime}–{editing.endTime} · {editing.sessionType}</div><Select label="Faculty" value={editForm.facultyId} onChange={event => setEditForm(value => ({ ...value, facultyId: event.target.value }))}>{faculty.map(person => <option key={person._id} value={person._id}>{person.name} · {person.employeeId}</option>)}</Select><Select label="Classroom" value={editForm.classroomId} onChange={event => setEditForm(value => ({ ...value, classroomId: event.target.value }))}>{rooms.map(room => <option key={room._id} value={room._id}>{room.roomCode} · {room.roomType} · cap {room.capacity}</option>)}</Select><Select label="Batch allocation" value={editForm.batchId} onChange={event => setEditForm(value => ({ ...value, batchId: event.target.value }))}><option value="">All batches / common</option>{batches.map(batch => <option key={batch._id} value={batch._id}>{batch.batchCode} · {batch.batchName}</option>)}</Select>{editing.locked && <Notice tone="warning">This session is locked and cannot be edited.</Notice>}</div><div className="flex justify-end gap-2 border-t border-line bg-slate-50 px-5 py-4"><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={saveSessionEdit} disabled={saving || Boolean(editing.locked)}>Validate & save</Button></div></div></div>}
  </>;
}
