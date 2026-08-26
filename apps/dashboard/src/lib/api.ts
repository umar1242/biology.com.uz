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

function getToken(): string | null {
  return localStorage.getItem("access_token");
}

/**
 * Fetches a binary endpoint as an object URL. Homework photos are proxied
 * through the API and require the Bearer token, which a plain <img src>
 * cannot send — so the bytes are pulled here and handed to the <img> as a
 * blob: URL instead. Callers must URL.revokeObjectURL when done.
 */
export async function apiFetchObjectUrl(path: string): Promise<string> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(
      res.status,
      body?.error?.code ?? "unknown_error",
      body?.error?.message ?? "Не удалось загрузить файл",
    );
  }
  return URL.createObjectURL(await res.blob());
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // The staff JWT is only validated on app mount, so a token that expires
    // mid-session (12h TTL) used to leave the user sitting on a dashboard
    // where every widget silently failed, with nothing telling them to log
    // in again. `token &&` keeps a failed /auth/login — which legitimately
    // 401s with no token attached — from bouncing the login page.
    if (res.status === 401 && token) {
      localStorage.removeItem("access_token");
      if (window.location.pathname !== "/login") window.location.assign("/login");
    }
    const err = body?.error;
    throw new ApiError(res.status, err?.code ?? "unknown_error", err?.message ?? "Request failed");
  }
  return body as T;
}
