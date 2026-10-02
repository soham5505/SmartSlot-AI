import axios from 'axios';

export const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api', timeout: 30000 });
api.interceptors.request.use(config => {
  const token = localStorage.getItem('smartslot_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export function getErrorMessage(error: any): string {
  return error?.response?.data?.error?.message || error?.response?.data?.detail || error?.message || 'Something went wrong. Please try again.';
}
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}
export function initials(name?: string) { return (name || 'User').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join(''); }
