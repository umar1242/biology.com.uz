// Deliberately not localStorage-backed: a Mini App gets fresh initData
// every time Telegram opens it, so re-authenticating on each mount (see
// auth.tsx) is simpler and more correct than trying to persist a session
// across launches. This just breaks the api.ts <-> auth.tsx import cycle.
let token: string | null = null;

export function getToken(): string | null {
  return token;
}

export function setToken(value: string | null) {
  token = value;
}
