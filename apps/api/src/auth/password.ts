import { hash, verify } from "@node-rs/argon2";

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

export async function verifyPassword(hashValue: string, plain: string): Promise<boolean> {
  return verify(hashValue, plain);
}
