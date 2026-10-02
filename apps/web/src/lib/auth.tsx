import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import type { User } from '../types';

type AuthValue = { user: User | null; loading: boolean; login: (email: string, password: string) => Promise<void>; register: (name: string, email: string, password: string) => Promise<void>; logout: () => void };
const AuthContext = createContext<AuthValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try { return JSON.parse(localStorage.getItem('smartslot_user') || 'null'); } catch { return null; }
  });
  const [loading, setLoading] = useState(Boolean(localStorage.getItem('smartslot_token')));
  useEffect(() => {
    const token = localStorage.getItem('smartslot_token');
    if (!token) { setLoading(false); return; }
    api.get('/auth/me').then(response => {
      setUser(response.data.data); localStorage.setItem('smartslot_user', JSON.stringify(response.data.data));
    }).catch(() => {
      localStorage.removeItem('smartslot_token'); localStorage.removeItem('smartslot_user'); setUser(null);
    }).finally(() => setLoading(false));
  }, []);

  const establish = (payload: any) => {
    localStorage.setItem('smartslot_token', payload.token);
    localStorage.setItem('smartslot_user', JSON.stringify(payload.user));
    setUser(payload.user);
  };
  const login = async (email: string, password: string) => { const response = await api.post('/auth/login', { email, password }); establish(response.data.data); };
  const register = async (name: string, email: string, password: string) => { const response = await api.post('/auth/register', { name, email, password }); establish(response.data.data); };
  const logout = () => { localStorage.removeItem('smartslot_token'); localStorage.removeItem('smartslot_user'); setUser(null); };
  const value = useMemo(() => ({ user, loading, login, register, logout }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() { const context = useContext(AuthContext); if (!context) throw new Error('useAuth must be used inside AuthProvider'); return context; }
