import { SignJWT, jwtVerify } from "jose";
import { config } from "../config.js";

const secret = new TextEncoder().encode(config.JWT_SECRET);

// role is deliberately narrowed to teacher/assistant — the owner never gets
// a JWT (auth is via Telegram through the bot admin flow, not the website;
// see the CHECK constraint on staff_users and idea-platforma-kursy.md §3).
export type StaffSession = {
  staffId: number;
  role: "teacher" | "assistant";
  teacherId: number; // tenant id: own staffId for a teacher, their owning teacher for an assistant
  displayName: string;
};

export async function signStaffSession(session: StaffSession): Promise<string> {
  return new SignJWT({ ...session, kind: "staff" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret);
}

/**
 * Throws if the token isn't a staff session — in particular, a validly
 * signed student session (see studentJwt.ts) shares this same secret, so
 * the `kind` claim is what actually keeps the two apart, not the signature.
 */
export async function verifyStaffSession(token: string): Promise<StaffSession> {
  const { payload } = await jwtVerify(token, secret);
  if (payload.kind !== "staff") throw new Error("Not a staff session token");
  return {
    staffId: payload.staffId as number,
    role: payload.role as StaffSession["role"],
    teacherId: payload.teacherId as number,
    displayName: payload.displayName as string,
  };
}
