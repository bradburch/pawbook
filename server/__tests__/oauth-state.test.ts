import { describe, expect, it } from 'vitest';
import { signState, verifyState } from '../lib/oauth-state';

const SECRET = 'test-secret-0123456789';
const NOW = 1_900_000_000_000;

describe('oauth-state', () => {
  const payload = { tenantId: 't1', nonce: 'n1', exp: NOW + 600_000 };

  it('round-trips a valid, unexpired state', async () => {
    const s = await signState(SECRET, payload);
    expect(await verifyState(SECRET, s, NOW)).toEqual(payload);
  });

  it('rejects a tampered payload', async () => {
    const s = await signState(SECRET, payload);
    const [body, sig] = s.split('.');
    const forged = btoa(JSON.stringify({ ...payload, tenantId: 'evil' }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(await verifyState(SECRET, `${forged}.${sig}`, NOW)).toBeNull();
    void body;
  });

  it('rejects a wrong signing secret', async () => {
    const s = await signState(SECRET, payload);
    expect(await verifyState('another-secret-xyz', s, NOW)).toBeNull();
  });

  it('rejects an expired state', async () => {
    const s = await signState(SECRET, { ...payload, exp: NOW - 1 });
    expect(await verifyState(SECRET, s, NOW)).toBeNull();
  });

  it('rejects malformed input', async () => {
    expect(await verifyState(SECRET, 'garbage', NOW)).toBeNull();
  });
});
