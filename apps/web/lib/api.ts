// The browser's API client. Calls go to /api/v1 on this origin (forwarded to the API), cookies included.
import type { ErrorCode, Problem } from '@halden/contracts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'network_error',
    message: string,
    readonly fields: Record<string, string> = {},
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      headers:
        body === undefined
          ? { accept: 'application/json' }
          : { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network_error', 'You seem to be offline. Check your connection and try again.');
  }
  if (res.ok) return (await res.json()) as T;
  let problem: Partial<Problem> = {};
  try {
    problem = (await res.json()) as Problem;
  } catch {
    /* not JSON */
  }
  const fields = Object.fromEntries((problem.errors ?? []).map((e) => [e.path, e.message]));
  throw new ApiError(
    res.status,
    (problem.code as ErrorCode) ?? 'internal_error',
    problem.detail ?? 'Something went wrong. Please try again.',
    fields,
    problem.retryAfterSeconds,
  );
}

export const get = <T>(path: string) => api<T>('GET', path);
export const post = <T>(path: string, body: unknown = {}) => api<T>('POST', path, body);
export const put = <T>(path: string, body: unknown) => api<T>('PUT', path, body);
export const patch = <T>(path: string, body: unknown) => api<T>('PATCH', path, body);
export const del = <T>(path: string) => api<T>('DELETE', path);
