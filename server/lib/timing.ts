/**
 * Constant-time string equality. Length is leaked (unavoidable without padding), but the
 * per-character comparison does not short-circuit, so equal-length inputs take the same time.
 * A neutral primitive used by both password verification and login-code verification.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
