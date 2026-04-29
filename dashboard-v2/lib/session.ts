// HMAC-signed stateless session tokens.
// Cookie stores: <32-byte-random-hex>.<HMAC-SHA256-hex>
// No shared state needed — works across Edge Runtime and Node.js contexts.
import crypto from 'crypto';

export function createSession(): string {
  const id  = crypto.randomBytes(32).toString('hex');
  const sig = hmacHex(id);
  return `${id}.${sig}`;
}

export function verifySession(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return false;
  const id       = token.slice(0, dot);
  const sig      = token.slice(dot + 1);
  const expected = hmacHex(id);
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function hmacHex(id: string): string {
  const secret = process.env.DASHBOARD_SECRET ?? '';
  return crypto.createHmac('sha256', secret).update(id).digest('hex');
}
