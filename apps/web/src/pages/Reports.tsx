import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Download, RefreshCw } from 'lucide-react';
import { api, getErrorMessage, saveBlob } from '../lib/api';
import type { Semester } from '../types';
import { Button, Card, CardHeader, EmptyState, Notice, PageHeading, Select } from '../components/ui';

const reportTypes = [
  { id: 'workload', label: 'Faculty workload' }, { id: 'utilization', label: 'Room utilization' }, { id: 'hours', label: 'Subject-hour completion' },
  { id: 'free-periods', label: 'Faculty free periods' }, { id: 'conflicts', label: 'Conflict summary' }, { id: 'history', label: 'Generation history' }, { id: 'archive', label: 'Published archive' }, { id: 'batch-schedule', label: 'Batch schedules' }
];
export function Reports() {
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [semesterId, setSemesterId] = useState('');
  const [type, setType] = useState('workload');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/semesters?limit=100').then(response => setSemesters(response.data.data)).catch(reason => setError(getErrorMessage(reason))); }, []);
  async function load() {
    setLoading(true); setError('');
    try { const response = await api.get(`/reports/${type}`, { params: semesterId ? { semesterId } : {} }); setRows(response.data.data); }
    catch (reason) { setError(getErrorMessage(reason)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [type, semesterId]);
  const columns = useMemo(() => [...new Set(rows.flatMap(row => Object.keys(row).filter(key => key !== 'sessions')))], [rows]);
  async function download(format: string) {
    try { const response = await api.get(`/reports/export/${type}`, { params: { format, ...(semesterId ? { semesterId } : {}) }, responseType: 'blob' }); saveBlob(response.data, `smartslot-${type}-report.${format === 'pdf' ? 'pdf' : 'xlsx'}`); }
    catch (reason) { setError(getErrorMessage(reason)); }
  }
  return <>
    <PageHeading eyebrow="Operations intelligence" title="Analytics & reports" description="Review instructional workload, teaching space utilization, subject-hour coverage, free periods, and timetable history." action={<div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => download('xlsx')}><Download size={14} />Excel</Button><Button size="sm" variant="secondary" onClick={() => download('pdf')}><Download size={14} />PDF</Button></div>} />
    {error && <div className="mb-4"><Notice tone="danger">{error}</Notice></div>}
    <Card className="mb-5"><div className="grid gap-4 p-4 sm:grid-cols-[1fr_1fr_auto]"><Select label="Report" value={type} onChange={event => setType(event.target.value)}>{reportTypes.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select><Select label="Semester filter" value={semesterId} onChange={event => setSemesterId(event.target.value)}><option value="">All available semesters</option>{semesters.map(item => <option key={item._id} value={item._id}>{item.semesterName}</option>)}</Select><div className="flex items-end"><Button variant="secondary" onClick={load} disabled={loading}><RefreshCw size={14} />Refresh</Button></div></div></Card>
    <Card><CardHeader title={reportTypes.find(item => item.id === type)?.label || 'Report'} description={`${rows.length} report rows`} action={<BarChart3 size={16} className="text-slate-400" />} />
      {loading ? <div className="p-12 text-center text-xs text-slate-400">Preparing report…</div> : !rows.length ? <EmptyState title="No report data available" description="Once timetable data is generated and resource records are configured, report rows will appear here." /> : <div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr>{columns.map(column => <th key={column} className="px-4 py-3 font-bold">{column.replace(/([A-Z])/g, ' $1')}</th>)}</tr></thead><tbody className="divide-y divide-line">{rows.map((row, index) => <tr key={row.id || row.employeeId || row.subjectCode || row.batchCode || index} className="hover:bg-slate-50/70">{columns.map(column => <td key={column} className="max-w-[280px] px-4 py-3 text-slate-600"><span className="block truncate" title={typeof row[column] === 'object' ? JSON.stringify(row[column]) : String(row[column] ?? '')}>{typeof row[column] === 'object' && row[column] != null ? JSON.stringify(row[column]) : row[column] ?? '—'}</span></td>)}</tr>)}</tbody></table></div>}
    </Card>
  </>;
}
