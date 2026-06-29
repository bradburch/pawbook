import { Hono } from 'hono';
import { consumeLoginCode, createLoginCode, getEndUserByEmail, promoteCustomerActive } from '../db/repo';
import { isEmailConfigured, sendLoginCode } from '../lib/email';
import { mintToken } from '../lib/token';
import type { AppEnv } from '../types';

const CODE_TTL_MS = 10 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return n.toString().padStart(6, '0');
}

export const authRoutes = new Hono<AppEnv>()
  .post('/:slug/identify', async (c) => {
    const tenant = c.get('tenant');
    const body = await c.req.json<{ email?: unknown }>().catch(() => ({}) as { email?: unknown });
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email)) return c.json({ error: 'Enter a valid email.' }, 400);

    // Invite-only: only customers the provider has added may receive a code. Do NOT auto-create.
    const user = await getEndUserByEmail(c.env.PAWBOOK_DB, tenant.Id, email);
    if (!user) return c.json({ error: 'This provider books by invitation only.' }, 403);
    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
    const codeId = await createLoginCode(c.env.PAWBOOK_DB, tenant.Id, user.Id, code, expiresAt);

    // When email is configured, send the code and NEVER return it — returning it would be an
    // unauthenticated account-takeover (anyone knowing the email could read the code).
    if (isEmailConfigured(c.env)) {
      try {
        await sendLoginCode(c.env, email, code);
      } catch {
        return c.json({ error: 'Could not send your code. Try again shortly.' }, 502);
      }
      return c.json({ codeId });
    }
    // No email provider configured. Only show the code on screen in explicit local development —
    // gating on an env signal (not merely on the secrets being absent) so a production deploy that
    // forgot to set RESEND_* fails CLOSED instead of silently leaking codes.
    if (c.env.ENVIRONMENT === 'development') {
      return c.json({ codeId, prototypeCode: code });
    }
    return c.json({ error: 'Login is temporarily unavailable.' }, 503);
  })

  .post('/:slug/verify', async (c) => {
    const tenant = c.get('tenant');
    const body = await c.req
      .json<{ codeId?: unknown; code?: unknown }>()
      .catch(() => ({}) as { codeId?: unknown; code?: unknown });
    if (typeof body.codeId !== 'string' || typeof body.code !== 'string')
      return c.json({ error: 'Code required.' }, 400);

    const endUserId = await consumeLoginCode(
      c.env.PAWBOOK_DB,
      tenant.Id,
      body.codeId,
      body.code.trim(),
      new Date().toISOString(),
    );
    if (!endUserId) return c.json({ error: 'That code is wrong or expired — try again.' }, 401);

    // First successful sign-in promotes an invited customer to active.
    await promoteCustomerActive(c.env.PAWBOOK_DB, tenant.Id, endUserId);

    const token = await mintToken(endUserId, tenant.Id, c.env.TOKEN_SECRET);
    return c.json({ token });
  });
