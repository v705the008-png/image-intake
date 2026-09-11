import crypto from 'node:crypto';
import { cookies } from 'next/headers';

export const ADMIN_COOKIE = 'ii_admin';

function adminPassword() {
  const p = process.env.ADMIN_PASSWORD;
  if (!p || p.trim() === '') return null;
  return p;
}

export function adminToken() {
  const p = adminPassword();
  if (!p) return null;
  return crypto.createHash('sha256').update(`image-intake:${p}`).digest('hex');
}

export function checkPassword(input: string) {
  const p = adminPassword();
  if (!p) return false;
  const a = Buffer.from(crypto.createHash('sha256').update(input).digest('hex'));
  const b = Buffer.from(crypto.createHash('sha256').update(p).digest('hex'));
  return crypto.timingSafeEqual(a, b);
}

export async function isAdmin() {
  const expected = adminToken();
  if (!expected) return false;
  const jar = await cookies();
  const got = jar.get(ADMIN_COOKIE)?.value;
  if (!got || got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}
