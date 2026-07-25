// Client-side fetch + JSON-parse + throw-on-error helper for browser components.

export class ApiError extends Error {
  status: number;
  /** The parsed error response body (e.g. 409 disambiguation payloads). */
  body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function parseOrThrow<T>(res: Response, fallbackMessage: string): Promise<T> {
  const data = await res.json();
  if (!res.ok) throw new ApiError((data as { error?: string })?.error ?? fallbackMessage, res.status, data);
  return data as T;
}

export async function getJson<T>(url: string, fallbackMessage = 'Request failed'): Promise<T> {
  const res = await fetch(url);
  return parseOrThrow<T>(res, fallbackMessage);
}

export async function postJson<T>(url: string, body: unknown, fallbackMessage = 'Request failed'): Promise<T> {
  const res = await fetch(url, jsonInit('POST', body));
  return parseOrThrow<T>(res, fallbackMessage);
}

export async function patchJson<T>(url: string, body: unknown, fallbackMessage = 'Request failed'): Promise<T> {
  const res = await fetch(url, jsonInit('PATCH', body));
  return parseOrThrow<T>(res, fallbackMessage);
}

export async function deleteJson<T>(url: string, body?: unknown, fallbackMessage = 'Request failed'): Promise<T> {
  const res = await fetch(url, body === undefined ? { method: 'DELETE' } : jsonInit('DELETE', body));
  return parseOrThrow<T>(res, fallbackMessage);
}

/**
 * Multipart POST (uploads). No Content-Type header — the browser sets the
 * multipart boundary itself; setting it manually breaks the request.
 */
export async function postForm<T>(
  url: string,
  form: FormData,
  fallbackMessage = 'Upload failed',
): Promise<T> {
  const res = await fetch(url, { method: 'POST', body: form });
  return parseOrThrow<T>(res, fallbackMessage);
}
