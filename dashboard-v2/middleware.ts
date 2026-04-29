import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SECRET = process.env.DASHBOARD_SECRET ?? '';
const LOGIN_PATH = '/login';

// Web Crypto HMAC verification — works in Edge Runtime without Node.js crypto.
async function verifySessionCookie(token: string | undefined): Promise<boolean> {
  if (!token || !SECRET) return false;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return false;
  const id     = token.slice(0, dot);
  const sigHex = token.slice(dot + 1);
  if (sigHex.length !== 64) return false; // HMAC-SHA256 = 32 bytes = 64 hex chars

  try {
    const key = await globalThis.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const sigBytes = Uint8Array.from({ length: 32 }, (_, i) =>
      parseInt(sigHex.slice(i * 2, i * 2 + 2), 16),
    );
    return await globalThis.crypto.subtle.verify(
      'HMAC', key, sigBytes, new TextEncoder().encode(id),
    );
  } catch {
    return false;
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === LOGIN_PATH || pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  if (!SECRET) {
    return pathname.startsWith('/api/')
      ? NextResponse.json({ error: 'server misconfigured' }, { status: 503 })
      : NextResponse.redirect(new URL(LOGIN_PATH, req.url));
  }

  const sessionToken = req.cookies.get('session_id')?.value;
  const headerSecret = req.headers.get('x-dashboard-secret') ?? '';
  const authenticated =
    (await verifySessionCookie(sessionToken)) ||
    constantTimeEqual(headerSecret, SECRET);

  if (authenticated) return NextResponse.next();

  return pathname.startsWith('/api/')
    ? NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    : NextResponse.redirect(new URL(LOGIN_PATH, req.url));
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons/|images/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js|woff2?|ttf)$).*)',
  ],
};
