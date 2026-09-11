import { NextResponse } from 'next/server';
import { ADMIN_COOKIE, adminToken, checkPassword } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 管理画面はインターネットから開けるので、パスワードの総当たりを防ぐ。
 * 同じ接続元からの失敗が 15分に10回を超えたら、しばらくログインを受け付けない。
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

type Attempt = { count: number; first: number };
const host = globalThis as typeof globalThis & { __imageIntakeLoginAttempts?: Map<string, Attempt> };
const attempts: Map<string, Attempt> = (host.__imageIntakeLoginAttempts ??= new Map());

/** 接続元。Cloudflare Tunnel 経由なら本当の接続元 IP がヘッダーに入る */
function clientKey(req: Request) {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'local'
  );
}

/** https で開かれているか（Cloudflare は x-forwarded-proto で教えてくれる） */
const isHttps = (req: Request) =>
  req.headers.get('x-forwarded-proto') === 'https' || new URL(req.url).protocol === 'https:';

export async function POST(req: Request) {
  const key = clientKey(req);
  const now = Date.now();
  const prev = attempts.get(key);
  if (prev && now - prev.first > WINDOW_MS) attempts.delete(key);
  const current = attempts.get(key);
  if (current && current.count >= MAX_FAILURES) {
    const retryAfter = Math.ceil((current.first + WINDOW_MS - now) / 1000);
    return NextResponse.json(
      { error: 'ログインの失敗が続いたため、しばらく時間をおいてからお試しください' },
      { status: 429, headers: { 'Retry-After': String(Math.max(1, retryAfter)) } },
    );
  }

  let password = '';
  try {
    password = String((await req.json()).password ?? '');
  } catch {
    /* 空のパスワードとして扱う */
  }

  const token = adminToken();
  if (!token) {
    return NextResponse.json(
      { error: 'ADMIN_PASSWORD が設定されていません（.env.local を確認してください）' },
      { status: 500 },
    );
  }
  if (!checkPassword(password)) {
    attempts.set(key, current ? { ...current, count: current.count + 1 } : { count: 1, first: now });
    return NextResponse.json({ error: 'パスワードが違います' }, { status: 401 });
  }

  attempts.delete(key);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps(req),
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
