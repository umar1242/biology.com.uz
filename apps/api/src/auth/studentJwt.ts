import { SignJWT, jwtVerify } from "jose";
import { config } from "../config.js";

const secret = new TextEncoder().encode(config.JWT_SECRET);

export type StudentSession = {
  studentId: number;
  telegramId: number;
};

export async function signStudentSession(session: StudentSession): Promise<string> {
  return new SignJWT({ ...session, kind: "student" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    // Matches the initData freshness window the Mini App re-sends on every
    // open anyway (see telegram/initData.ts) — no need for a longer-lived
    // session than that.
    .setExpirationTime("24h")
    .sign(secret);
}

export async function verifyStudentSession(token: string): Promise<StudentSession> {
  const { payload } = await jwtVerify(token, secret);
  if (payload.kind !== "student") throw new Error("Not a student session token");
  return {
    studentId: payload.studentId as number,
    telegramId: payload.telegramId as number,
  };
}
