import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken } from '../lib/token-crypto';

const SECRET = 'test-secret-0123456789';

describe('token-crypto', () => {
  it('round-trips a token through encrypt/decrypt', async () => {
    const blob = await encryptToken(SECRET, 'refresh-abc-123');
    expect(blob).not.toContain('refresh-abc-123');
    expect(await decryptToken(SECRET, blob)).toBe('refresh-abc-123');
  });

  it('produces a different ciphertext each time (random IV)', async () => {
    const a = await encryptToken(SECRET, 'same');
    const b = await encryptToken(SECRET, 'same');
    expect(a).not.toBe(b);
    expect(await decryptToken(SECRET, a)).toBe('same');
    expect(await decryptToken(SECRET, b)).toBe('same');
  });

  it('fails to decrypt under the wrong secret', async () => {
    const blob = await encryptToken(SECRET, 'secret-data');
    await expect(decryptToken('different-secret-xyz', blob)).rejects.toThrow();
  });
});
