import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const KEY_BYTES = 32;
const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

const encode = (salt: Buffer, key: Buffer) => `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;

export async function hashPassword(password: string, salt: Buffer = randomBytes(16)): Promise<string> {
  return encode(salt, await scryptAsync(password, salt, KEY_BYTES));
}

export function hashPasswordSync(password: string, salt: Buffer): string {
  return encode(salt, scryptSync(password, salt, KEY_BYTES));
}

const UNMATCHABLE = hashPasswordSync("unmatchable", Buffer.alloc(16));

export async function passwordMatches(stored: string | undefined, password: string): Promise<boolean> {
  const [scheme, salt, hash] = (stored ?? UNMATCHABLE).split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const given = await scryptAsync(password, Buffer.from(salt, "base64url"), KEY_BYTES);
  return given.length === expected.length && timingSafeEqual(given, expected) && stored !== undefined;
}
