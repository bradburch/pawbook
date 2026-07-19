import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../index';
import { RATE_LIMIT_TTL_SECONDS } from '../routes/signup';
import { ALLOWED_EMAIL, createTestEnv, OWNER_EMAIL } from './helpers';

export const start = (env: Env, email: string) =>
  app.request(
    '/api/signup/start',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    },
    env,
  );

function configureEmail(env: Env) {
  env.RESEND_API_KEY = 'test-key';
  env.RESEND_FROM = 'Pawbook <bookings@example.com>';
}

describe('POST /api/signup/start — enumeration neutrality (email configured)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the identical 200 body for allowlisted, claimed, unknown, and owner emails', async () => {
    const { env, raw } = createTestEnv();
    configureEmail(env);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    raw
      .prepare(
        "INSERT INTO AllowedSitters (Email, ClaimedAt) VALUES ('claimed@x.test', '2026-01-01T00:00:00Z')",
      )
      .run();
    const bodies: string[] = [];
    for (const email of [ALLOWED_EMAIL, 'claimed@x.test', 'nobody@x.test', OWNER_EMAIL]) {
      const res = await start(env, email);
      expect(res.status).toBe(200);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1); // ONE body for every input
    expect(bodies[0]).toBe(JSON.stringify({ ok: true }));
  });

  it('sends a link only to eligible emails', async () => {
    const { env } = createTestEnv();
    configureEmail(env);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    await start(env, 'nobody@x.test'); // ineligible → no send
    expect(fetchSpy).not.toHaveBeenCalled();
    await start(env, ALLOWED_EMAIL); // unclaimed allowlist row → send
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('https://api.resend.com/emails', expect.anything());
    await start(env, OWNER_EMAIL); // owner without a password yet → send
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('swallows send failures — the neutral 200 already went out', async () => {
    const { env } = createTestEnv();
    configureEmail(env);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    const res = await start(env, ALLOWED_EMAIL);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('POST /api/signup/start — dev degrade + fail-closed', () => {
  it('dev + no email provider: prototypeLink ONLY for eligible emails', async () => {
    const { env } = createTestEnv(); // ENVIRONMENT=development, no RESEND_*
    const eligible = (await (await start(env, ALLOWED_EMAIL)).json()) as {
      ok: boolean;
      prototypeLink?: string;
    };
    expect(eligible.ok).toBe(true);
    expect(eligible.prototypeLink).toMatch(/\/setup\?t=/);
    const owner = (await (await start(env, OWNER_EMAIL)).json()) as { prototypeLink?: string };
    expect(owner.prototypeLink).toMatch(/\/setup\?t=/);
    const unknown = (await (await start(env, 'nobody@x.test')).json()) as object;
    expect(unknown).toEqual({ ok: true }); // no link — and no other divergence
  });

  it('unconfigured email OUTSIDE development fails closed: 503 for every input', async () => {
    const { env } = createTestEnv();
    env.ENVIRONMENT = 'production';
    const a = await start(env, ALLOWED_EMAIL);
    const b = await start(env, 'nobody@x.test');
    expect(a.status).toBe(503);
    expect(b.status).toBe(503);
    expect(await a.text()).toBe(await b.text()); // reveals nothing per-email
  });

  it('rejects an invalid email body with 400', async () => {
    const { env } = createTestEnv();
    expect((await start(env, 'not-an-email')).status).toBe(400);
  });
});

describe('POST /api/signup/start — rate limiting', () => {
  afterEach(() => vi.restoreAllMocks());

  it('caps at 5/hour per email+IP; over-cap returns the same neutral body and skips the send', async () => {
    const { env } = createTestEnv();
    configureEmail(env);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    for (let i = 0; i < 5; i++) expect((await start(env, ALLOWED_EMAIL)).status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    const sixth = await start(env, ALLOWED_EMAIL);
    expect(sixth.status).toBe(200);
    expect(await sixth.json()).toEqual({ ok: true }); // limiter is not an oracle
    expect(fetchSpy).toHaveBeenCalledTimes(5); // send skipped
  });

  it('is a true fixed window: a capped requester succeeds again once the window elapses', async () => {
    // Regression test for the TTL-refresh lockout bug: the old implementation refreshed the
    // KV key's expirationTtl on every write — including over-cap ones — so a capped user who
    // kept retrying pushed the expiry out indefinitely and never got unblocked. A fixed window
    // must track its own start time and reset once that start ages past the TTL, independent
    // of how many retries happened in between.
    const { env } = createTestEnv();
    configureEmail(env);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 5; i++) expect((await start(env, ALLOWED_EMAIL)).status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(5);

      // Over cap — same neutral body, send skipped — and (this is the bug) a retry here must
      // NOT push the window's expiry back out.
      const sixth = await start(env, ALLOWED_EMAIL);
      expect(await sixth.json()).toEqual({ ok: true });
      expect(fetchSpy).toHaveBeenCalledTimes(5);

      // Advance past the 1-hour window (past, not just up to, its boundary) and retry: this must
      // succeed and send again, proving the cap is "5 per rolling hour", not "5 total, ever".
      vi.advanceTimersByTime(RATE_LIMIT_TTL_SECONDS * 1000 + 1);
      const afterWindow = await start(env, ALLOWED_EMAIL);
      expect(afterWindow.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(6);
    } finally {
      vi.useRealTimers();
    }
  });
});
