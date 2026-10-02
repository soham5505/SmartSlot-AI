import { useEffect, useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, History, UploadCloud } from 'lucide-react';
import { api, getErrorMessage, saveBlob } from '../lib/api';
import { Button, Card, CardHeader, Notice, PageHeading, Pill, Select } from '../components/ui';

const templates = ['all', 'departments', 'academicYears', 'semesters', 'faculty', 'subjects', 'batches', 'classrooms', 'assignments', 'facultyAvailability'];
export function Imports() {
  const [file, setFile] = useState<File | null>(null);
  const [template, setTemplate] = useState('all');
  const [updateExisting, setUpdateExisting] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [validating, setValidating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const loadHistory = async () => { try { const response = await api.get('/import/history?limit=15'); setHistory(response.data.data); } catch (reason) { setError(getErrorMessage(reason)); } };
  useEffect(() => { void loadHistory(); }, []);
  async function downloadTemplate() {
    try { const response = await api.get(`/import/template/${template}`, { responseType: 'blob' }); saveBlob(response.data, `smartslot-${template}-template.xlsx`); }
    catch (reason) { setError(getErrorMessage(reason)); }
  }
  async function validate() {
    if (!file) { setError('Choose an .xlsx workbook first.'); return; }
    const form = new FormData(); form.append('file', file); form.append('updateExisting', String(updateExisting)); form.append('dryRun', String(dryRun));
    setValidating(true); setError(''); setSuccess(''); setResult(null);
    try { const response = await api.post('/import/validate', form, { headers: { 'Content-Type': 'multipart/form-data' } }); setResult(response.data.data); }
    catch (reason: any) { if (reason?.response?.data?.data?.importId) setResult(reason.response.data.data); else setError(getErrorMessage(reason)); }
    finally { setValidating(false); await loadHistory(); }
  }
  async function confirm() {
    if (!result?.importId) return;
    setConfirming(true); setError('');
    try { const response = await api.post('/import/confirm', { importId: result.importId }); setSuccess(`${response.data.data.summary.successful} records imported. The import summary is saved to history.`); setResult({ ...result, confirmAllowed: false, status: 'committed' }); await loadHistory(); }
    catch (reason) { setError(getErrorMessage(reason)); }
    finally { setConfirming(false); }
  }
  async function downloadErrors(id: string) {
    try { const response = await api.get(`/import/history/${id}/errors`, { responseType: 'blob' }); saveBlob(response.data, `smartslot-import-${id}-errors.xlsx`); }
    catch (reason) { setError(getErrorMessage(reason)); }
  }
  return <>
    <PageHeading eyebrow="Safe data onboarding" title="Excel import center" description="Validate headers, cell content, duplicate keys, and cross-sheet references before confirming any MongoDB writes." />
    {error && <div className="mb-4"><Notice tone="danger">{error}</Notice></div>}{success && <div className="mb-4"><Notice tone="success">{success}</Notice></div>}
    <div className="grid gap-5 xl:grid-cols-[.9fr_1.1fr]">
      <div className="space-y-5">
        <Card><CardHeader title="1. Download a template" description="Use the known sheet names and snake_case headers." /><div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-end"><div className="flex-1"><Select label="Template workbook" value={template} onChange={event => setTemplate(event.target.value)}>{templates.map(item => <option key={item} value={item}>{item === 'all' ? 'All supported sheets' : item}</option>)}</Select></div><Button variant="secondary" onClick={downloadTemplate}><Download size={15} />Download .xlsx</Button></div><div className="px-5 pb-5"><Notice tone="info" title="Reference IDs in spreadsheet">Foreign keys use readable department codes, academic-year names, employee IDs, subject codes, batch codes, and room codes. Required parent records can be included on other sheets in the same workbook.</Notice></div></Card>
        <Card><CardHeader title="2. Upload and validate" description="Rows with errors are not eligible for confirmation." /><div className="space-y-4 p-5"><label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center transition hover:border-brand-400 hover:bg-brand-50/40"><UploadCloud size={25} className="text-brand-600" /><span className="mt-2 text-xs font-bold text-ink">{file?.name || 'Choose an Excel workbook'}</span><span className="mt-1 text-[10px] text-slate-400">.xlsx · 5 MB maximum · formulas are rejected</span><input type="file" className="sr-only" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => { setFile(event.target.files?.[0] || null); setResult(null); }} /></label>
            <label className="flex items-start gap-3"><input type="checkbox" checked={updateExisting} onChange={event => setUpdateExisting(event.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" /><span><span className="block text-xs font-semibold text-slate-700">Update matching records</span><span className="mt-1 block text-[10px] leading-4 text-slate-500">Off by default. Matching records are only updated when this is explicitly selected.</span></span></label>
            <label className="flex items-start gap-3"><input type="checkbox" checked={dryRun} onChange={event => setDryRun(event.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" /><span><span className="block text-xs font-semibold text-slate-700">Dry run only</span><span className="mt-1 block text-[10px] leading-4 text-slate-500">Validate and preview; this import cannot be confirmed.</span></span></label>
            <Button onClick={validate} disabled={!file || validating} className="w-full"><FileSpreadsheet size={15} />{validating ? 'Validating workbook…' : 'Validate workbook'}</Button>
          </div></Card>
        <Card><CardHeader title="Import workflow" description="No silent partial imports" /><div className="grid gap-3 p-5 sm:grid-cols-2">{[['1', 'Validate', 'Headers, types, references, and duplicates'], ['2', 'Preview', 'Review each row and the error report'], ['3', 'Confirm', 'Only a clean workbook can be committed'], ['4', 'Recover', 'Import history and compensating rollback']].map(([number, title, description]) => <div key={number} className="flex gap-3 rounded-xl bg-slate-50 p-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-[11px] font-bold text-brand-700">{number}</span><span><span className="block text-xs font-bold text-slate-700">{title}</span><span className="mt-1 block text-[10px] leading-4 text-slate-500">{description}</span></span></div>)}</div></Card>
      </div>
      <div className="space-y-5">
        {result && <Card><CardHeader title="3. Validation preview" description={`${result.summary?.totalRows || 0} parsed rows · ${result.errors?.length || 0} issues`} action={<Pill tone={result.errors?.length ? 'rose' : result.status === 'committed' ? 'green' : 'blue'}>{result.status}</Pill>} />
          {result.errors?.length > 0 && <div className="p-5 pb-0"><Notice tone="danger" title="Correct the workbook and upload again">Every error below identifies a sheet and row. Invalid workbooks cannot be partially confirmed.</Notice></div>}
          {result.errors?.length > 0 && <div className="max-h-[280px] overflow-auto p-5"><table className="w-full text-left text-[10px]"><thead className="sticky top-0 bg-white text-slate-400"><tr><th className="py-2">Sheet / row</th><th className="py-2">Field</th><th className="py-2">Error</th></tr></thead><tbody className="divide-y divide-line">{result.errors.map((item: any, index: number) => <tr key={`${item.sheet}-${item.row}-${index}`}><td className="py-2 pr-3 font-semibold text-slate-600">{item.sheet} · {item.row}</td><td className="py-2 pr-3 text-slate-500">{item.field || item.code}</td><td className="py-2 text-rose-700">{item.message}</td></tr>)}</tbody></table></div>}
          {result.preview?.length > 0 && <div className="max-h-[260px] overflow-auto border-t border-line"><table className="w-full text-left text-[10px]"><thead className="sticky top-0 bg-slate-50 text-slate-400"><tr><th className="px-5 py-2">Sheet / row</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Key</th><th className="px-3 py-2">Status</th></tr></thead><tbody className="divide-y divide-line">{result.preview.map((item: any, index: number) => <tr key={`${item.sheet}-${item.row}-${index}`}><td className="px-5 py-2.5 text-slate-500">{item.sheet} · {item.row}</td><td className="px-3 py-2.5 font-semibold text-slate-700">{item.entity}</td><td className="max-w-[160px] truncate px-3 py-2.5 text-slate-500">{item.key}</td><td className="px-3 py-2.5"><Pill tone={result.errors?.some((issue: any) => issue.sheet === item.sheet && issue.row === item.row) ? 'rose' : 'green'}>{result.errors?.some((issue: any) => issue.sheet === item.sheet && issue.row === item.row) ? 'needs fix' : 'ready'}</Pill></td></tr>)}</tbody></table></div>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4"><span className="text-[10px] text-slate-400">Import ID: {result.importId}</span><div className="flex gap-2">{result.importId && result.errors?.length > 0 && <Button size="sm" variant="secondary" onClick={() => downloadErrors(result.importId)}><Download size={13} />Error report</Button>}<Button size="sm" onClick={confirm} disabled={!result.confirmAllowed || confirming}><CheckCircle2 size={14} />{confirming ? 'Importing…' : 'Confirm import'}</Button></div></div>
        </Card>}
        <Card><CardHeader title="Import history" description="Validation and commit records for your account" action={<History size={16} className="text-slate-400" />} /><div className="divide-y divide-line">{history.length ? history.map(item => <div key={item._id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"><div className="min-w-0"><div className="truncate text-xs font-semibold text-slate-700">{item.filename}</div><div className="mt-1 text-[10px] text-slate-400">{new Date(item.createdAt).toLocaleString()} · {item.summary?.totalRows || 0} rows</div></div><div className="flex items-center gap-2"><Pill tone={item.status === 'committed' ? 'green' : item.status === 'validated' ? 'blue' : 'rose'}>{item.status}</Pill>{item.errors?.length > 0 && <button onClick={() => downloadErrors(item._id)} className="text-[10px] font-bold text-brand-600">Download errors</button>}</div></div>) : <div className="p-8 text-center text-xs text-slate-400">No import activity yet.</div>}</div></Card>
      </div>
    </div>
  </>;
}
