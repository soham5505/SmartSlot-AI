import { useState } from 'react';
import { ArrowRight, CalendarDays, LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { getErrorMessage } from '../lib/api';
import { Button, Input, Notice } from '../components/ui';

export function Login() {
  const { user, loading, login, register } = useAuth();
  const navigate = useNavigate();
  const [setup, setSetup] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Checking your session…</div>;
  if (user) return <Navigate to="/" replace />;
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { if (setup) await register(name, email, password); else await login(email, password); navigate('/', { replace: true }); }
    catch (reason) { setError(getErrorMessage(reason)); }
    finally { setBusy(false); }
  }
  return <div className="grid min-h-screen bg-white lg:grid-cols-[1fr_.9fr]">
    <div className="relative hidden overflow-hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-between"><div className="absolute -right-36 -top-36 h-[520px] w-[520px] rounded-full border border-white/10" /><div className="absolute -right-12 -top-12 h-[280px] w-[280px] rounded-full border border-white/10" /><div className="relative z-10 flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10"><CalendarDays size={22} /></span><span><b className="block text-lg">SmartSlot AI</b><span className="text-[10px] uppercase tracking-[.18em] text-slate-300">Academic planning</span></span></div><div className="relative z-10 max-w-xl"><PillLike /><h1 className="mt-6 text-4xl font-bold leading-[1.15] tracking-tight">A better week starts with a better plan.</h1><p className="mt-5 max-w-lg text-sm leading-7 text-slate-300">Build balanced, conflict-aware college timetables around the people, rooms, and learning needs that make your campus work.</p><div className="mt-8 space-y-4">{[['CP-SAT optimization', 'Explore millions of schedules while protecting hard rules.'], ['Reference-aware setup', 'Keep semester structures flexible and reviewable.'], ['Safe publishing', 'Validate every change before it reaches students.']].map(([title, description]) => <div key={title} className="flex items-start gap-3"><span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-400/15 text-emerald-300"><ShieldCheck size={14} /></span><span><b className="text-xs">{title}</b><span className="mt-1 block text-[11px] leading-5 text-slate-300">{description}</span></span></div>)}</div></div><p className="relative z-10 text-[10px] text-slate-400">SmartSlot · Constraint-first academic operations</p></div>
    <div className="flex items-center justify-center px-5 py-12"><div className="w-full max-w-[420px]"><div className="mb-8 flex items-center gap-3 lg:hidden"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-ink text-white"><CalendarDays size={19} /></span><b className="text-lg text-ink">SmartSlot AI</b></div><div className="mb-8"><div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><LockKeyhole size={21} /></div><p className="text-[10px] font-bold uppercase tracking-[.17em] text-brand-600">Secure workspace</p><h2 className="mt-2 text-2xl font-bold tracking-tight text-ink">{setup ? 'Set up your administrator' : 'Welcome back'}</h2><p className="mt-2 text-sm text-slate-500">{setup ? 'The first account is provisioned as the system administrator.' : 'Sign in to manage your college timetable workspace.'}</p></div>
      {error && <div className="mb-5"><Notice tone="danger">{error}</Notice></div>}
      <form onSubmit={submit} className="space-y-4">{setup && <Input label="Full name" autoComplete="name" required value={name} onChange={event => setName(event.target.value)} placeholder="Your name" />}<Input label="Email address" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="name@college.edu" /><Input label="Password" type="password" autoComplete={setup ? 'new-password' : 'current-password'} required minLength={setup ? 10 : 1} value={password} onChange={event => setPassword(event.target.value)} placeholder={setup ? 'At least 10 characters' : 'Enter your password'} hint={setup ? 'Use at least 10 characters.' : undefined} /><Button className="w-full" disabled={busy}>{busy ? 'Please wait…' : setup ? 'Create administrator account' : 'Sign in'}<ArrowRight size={15} /></Button></form>
      <div className="my-6 flex items-center gap-3"><span className="h-px flex-1 bg-line" /><span className="text-[10px] text-slate-400">{setup ? 'Already configured?' : 'First time here?'}</span><span className="h-px flex-1 bg-line" /></div><button onClick={() => { setSetup(!setup); setError(''); }} className="w-full rounded-xl border border-line px-4 py-3 text-xs font-bold text-slate-700 transition hover:bg-slate-50">{setup ? 'Go to sign in' : 'Set up first administrator'}</button><div className="mt-7 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-[10px] leading-4 text-slate-500"><Sparkles size={14} className="mt-0.5 shrink-0 text-brand-600" />Passwords are hashed and sign-in is protected by expiring JWT sessions. Ask an administrator for access if your account is not set up.</div>
    </div></div>
  </div>;
}
function PillLike() { return <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[10px] font-semibold text-slate-200"><Sparkles size={12} className="text-amber-300" />Timetable intelligence, made practical</div>; }
