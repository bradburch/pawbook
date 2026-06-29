import { constantTimeEqual } from './timing';

/**
 * CSRF defense for the OAuth callback, which cannot be session-authed (Google redirects with no
 * Authorization header). `state = base64url(payload).base64url(HMAC-SHA256(payload, TOKEN_SECRET))`.
 * The `nonce` is additionally stored single-use in KV by the routes, so replay is blocked even
 * within `exp`.
 */
const enc = new TextEncoder();
const dec = new TextDecoder();

export type StatePayload = { tenantId: string; nonce: string; exp: number };

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(s: string): Uint8Array {
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function signState(secret: string, payload: StatePayload): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = b64url(await hmac(secret, body));
  return `${body}.${sig}`;
}

export async function verifyState(
  secret: string, state: string, nowMs: number,
): Promise<StatePayload | null> {
  const dot = state.indexOf('.');
  if (dot <= 0) return null;
  const body = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = b64url(await hmac(secret, body));
  if (!constantTimeEqual(sig, expected)) return null;
  let payload: StatePayload;
  try {
    payload = JSON.parse(dec.decode(b64urlToBytes(body)));
  } catch {
    return null;
  }
  if (
    typeof payload.tenantId !== 'string' ||
    typeof payload.nonce !== 'string' ||
    typeof payload.exp !== 'number'
  )
    return null;
  if (payload.exp < nowMs) return null;
  return payload;
}
