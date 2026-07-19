import { Hono } from 'hono';
import * as v from 'valibot';
import { getAllowedSitter, getOwnerUserByEmail } from '../db/repo';
import { isEmailConfigured, sendSignupLink } from '../lib/email';
import { isOwnerEmail } from '../lib/owners';
import { SIGNUP_LINK_TTL_SECONDS, SIGNUP_NONCE_KEY, signSignupLink } from '../lib/signup-link';
import { EMAIL_RE } from '../lib/validation';
import type { AppEnv } from '../types';

/**
 * Invite-only signup. Non-slug-scoped ('signup' is in RESERVED_SLUGS, so tenantMiddleware
 * passes /api/signup/* through). /start is enumeration-neutral: ONE body for every input,
 * with all allowlist-dependent work deferred behind the response.
 */

const StartBody = v.object({
  email: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.regex(EMAIL_RE)),
});

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_TTL_SECONDS = 3600;
const RATE_KEY = (email: string, ip: string) => `signup:rl:${email}:${ip}`;

/**
 * 'owner' for an OWNER_EMAILS member with no password yet, 'sitter' for an unclaimed
 * allowlist row, null for everyone else. Owner check first: an email in the secret is an
 * owner, full stop — it must never claim a sitter tenant.
 */
async function eligibleKind(env: Env, email: string): Promise<'sitter' | 'owner' | null> {
  if (isOwnerEmail(env, email)) {
    return (await getOwnerUserByEmail(env.PAWBOOK_DB, email)) ? null : 'owner';
  }
  const row = await getAllowedSitter(env.PAWBOOK_DB, email);
  return row && !row.ClaimedAt ? 'sitter' : null;
}

/** Mint a link and register its single-use nonce in KV (same expiry as the link). */
async function mintLink(
  env: Env,
  origin: string,
  email: string,
  kind: 'sitter' | 'owner',
): Promise<string> {
  const nonce = crypto.randomUUID();
  await env.PAWBOOK_CACHE.put(SIGNUP_NONCE_KEY(nonce), '1', {
    expirationTtl: SIGNUP_LINK_TTL_SECONDS,
  });
  const token = await signSignupLink(env.TOKEN_SECRET, {
    email,
    kind,
    nonce,
    exp: Date.now() + SIGNUP_LINK_TTL_SECONDS * 1000,
  });
  return `${origin}/setup?t=${token}`;
}

export const signupRoutes = new Hono<AppEnv>().post('/signup/start', async (c) => {
  const raw = await c.req.json<unknown>().catch(() => ({}));
  const parsed = v.safeParse(StartBody, raw);
  if (!parsed.success) return c.json({ error: 'Enter a valid email.' }, 400);
  const { email } = parsed.output;
  const origin = new URL(c.req.url).origin;

  // Soft per-email+IP limiter (KV counter; increments aren't atomic — fine for a soft cap).
  // Over the cap → the SAME neutral 200 with the send skipped, so the limiter isn't an oracle.
  const rateKey = RATE_KEY(email, c.req.header('CF-Connecting-IP') ?? 'unknown');
  const count = Number((await c.env.PAWBOOK_CACHE.get(rateKey)) ?? '0');
  await c.env.PAWBOOK_CACHE.put(rateKey, String(count + 1), {
    expirationTtl: RATE_LIMIT_TTL_SECONDS,
  });
  const overCap = count >= RATE_LIMIT_MAX;

  if (!isEmailConfigured(c.env)) {
    // No provider outside explicit local development fails CLOSED (same posture as /identify);
    // the 503 is identical for every input, so it reveals nothing per-email.
    if (c.env.ENVIRONMENT !== 'development') {
      return c.json({ error: 'Signup is temporarily unavailable.' }, 503);
    }
    // Local-dev degrade (mirrors routes/auth.ts prototypeCode): run the check inline and
    // render the link on screen so demos work with a blanked RESEND_API_KEY.
    if (overCap) return c.json({ ok: true });
    const kind = await eligibleKind(c.env, email);
    if (!kind) return c.json({ ok: true });
    return c.json({ ok: true, prototypeLink: await mintLink(c.env, origin, email, kind) });
  }

  // Enumeration neutrality is structural: the 200 goes out NOW; everything whose duration
  // could depend on allowlist state runs after the response (the calendar-sync waitUntil
  // precedent). Send failures are logged and swallowed — the invitee simply retries.
  const work = (async () => {
    if (overCap) return;
    const kind = await eligibleKind(c.env, email);
    if (!kind) return;
    await sendSignupLink(c.env, email, await mintLink(c.env, origin, email, kind));
  })().catch((err) => console.error('signup link send failed', err));
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    await work; // tests have no ExecutionContext — await for determinism (bookings.ts pattern)
  }
  return c.json({ ok: true });
});
