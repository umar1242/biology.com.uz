import { ApiError } from "./api";

/**
 * Turns a failed request into something to show the student.
 *
 * `access_frozen` is special-cased: the server's message is Russian-only, and
 * a frozen student is not looking at a bug but at a billing state, so it gets
 * the localised explanation instead of a raw error string.
 */
export function errorText(err: unknown, frozenText: string, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.code === "access_frozen") return frozenText;
    return err.message;
  }
  return fallback;
}
