const API_BASE = (process.env.REACT_APP_API_URL ?? (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5001')).replace(/\/$/, '');
const KEY = 'orqivra.workspace.v2';
const LEGACY_KEY = 'agroscope.workspace.v2';
export const getToken = () => sessionStorage.getItem(KEY) || sessionStorage.getItem(LEGACY_KEY);
export const clearToken = () => { sessionStorage.removeItem(KEY); sessionStorage.removeItem(LEGACY_KEY); };
export async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}/api/${path}`, { ...options, headers: { ...(getToken() ? { 'X-Dataset-ID': getToken() } : {}), ...options.headers } });
  } catch {
    throw new Error('Cannot reach the analysis server. Start the backend and try again.');
  }
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'The request could not be completed.'); error.status = response.status; throw error; }
  if (data.dataset_id) sessionStorage.setItem(KEY, data.dataset_id);
  return data;
}
export function download(content, filename, type) {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function exportFile(kind) {
  const response = await fetch(`${API_BASE}/api/export/${kind}`, { headers: { 'X-Dataset-ID': getToken() || '' } });
  if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Export failed.'); }
  download(await response.blob(), `orqivra-${kind}.${kind === 'report' ? 'json' : 'csv'}`);
}
