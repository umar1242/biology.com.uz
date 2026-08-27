import { getToken } from "./tokenStore";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api/v1";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { skipAuth?: boolean } = {},
): Promise<T> {
  const { skipAuth, ...rest } = options;
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(!skipAuth && token ? { Authorization: `Bearer ${token}` } : {}),
      ...rest.headers,
    },
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error;
    throw new ApiError(res.status, err?.code ?? "unknown_error", err?.message ?? "Request failed");
  }
  return body as T;
}

/**
 * Binary GET (the variant PDF, homework photos) as an object URL. The raw
 * endpoints require the Bearer token, so a plain <a href> or <img src>
 * would come back 401 — the bytes have to be fetched, then wrapped.
 * Callers own the returned URL and must revokeObjectURL it.
 */
export async function apiFetchObjectUrl(path: string): Promise<string> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new ApiError(res.status, "fetch_failed", "Could not load file");
  }
  return URL.createObjectURL(await res.blob());
}
