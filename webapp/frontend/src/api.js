const API_BASE = (process.env.REACT_APP_API_URL ?? (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5001')).replace(/\/$/, '');
const KEY = 'orqivra.workspace.v2';
const LEGACY_KEY = 'agroscope.workspace.v2';
let memoryToken = null;
export const getToken = () => {
  try { return memoryToken || sessionStorage.getItem(KEY) || sessionStorage.getItem(LEGACY_KEY); }
  catch { return memoryToken; }
};
export const clearToken = () => {
  memoryToken = null;
  try { sessionStorage.removeItem(KEY); sessionStorage.removeItem(LEGACY_KEY); } catch { /* Storage can be blocked by the browser. */ }
};
const saveToken = token => {
  memoryToken = token;
  try { sessionStorage.setItem(KEY, token); } catch { /* Keep this tab usable without browser storage. */ }
};
async function exchange(path, options = {}, asBlob = false) {
  const { timeoutMs = path === 'analyze' ? 120000 : path === 'workspace' ? 15000 : 45000, ...fetchOptions } = options;
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('The server is taking too long. Free hosting may be waking up. Please try again shortly.'));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([timeout, (async () => {
      let response;
      try {
        const token = getToken();
        response = await fetch(`${API_BASE}/api/${path}`, { ...fetchOptions, signal: controller.signal, headers: { ...(token ? { 'X-Dataset-ID': token } : {}), ...fetchOptions.headers } });
      } catch {
        throw new Error('Cannot reach the server. Check your connection and retry; free hosting may take about a minute to wake.');
      }
      if (asBlob && response.ok) return response.blob();
      let data;
      try { data = await response.json(); }
      catch { throw new Error('The server returned an incomplete response. Please retry shortly.'); }
      if (!response.ok) {
        const error = new Error(data.error || 'The request could not be completed.');
        error.status = response.status;
        if (response.status === 404 && /Workspace expired/i.test(error.message)) {
          clearToken();
          window.dispatchEvent(new Event('orqivra-workspace-expired'));
        }
        throw error;
      }
      if (data.dataset_id) saveToken(data.dataset_id);
      return data;
    })()]);
  } finally { clearTimeout(timer); }
}
export const request = (path, options = {}) => exchange(path, options);
export function download(content, filename, type) {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function exportFile(kind) {
  download(await exchange(`export/${kind}`, {}, true), `orqivra-${kind}.${kind === 'report' ? 'json' : 'csv'}`);
}
