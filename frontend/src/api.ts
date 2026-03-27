/**
 * Shared API configuration and helpers for connecting to the backend.
 */

const DEFAULT_API_BASE = 'http://localhost:4000';

export function getApiBase(): string {
  return (process.env.REACT_APP_API_URL || DEFAULT_API_BASE).replace(/\/$/, '');
}

export function apiUrl(path: string): string {
  const base = getApiBase();
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

/**
 * Parse error message from a failed Response (backend sends { error: string }).
 */
export async function parseErrorResponse(res: Response, fallback = 'Request failed'): Promise<string> {
  try {
    const data = await res.json();
    if (data && typeof data.error === 'string') return data.error;
  } catch {
    // ignore JSON parse errors
  }
  return fallback;
}
