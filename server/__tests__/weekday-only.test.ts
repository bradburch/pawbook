import { describe, expect, it } from 'vitest';
import app from '../index';
import { adminToken, createTestEnv, TENANT_A } from './helpers';

/** Admin Bearer headers for a tenant, optionally with a JSON content type. */
async function auth(tenantId: string, json = false): Promise<Record<string, string>> {
  const h: Record<string, string> = { Authorization: `Bearer ${await adminToken(tenantId)}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

/** PUT one walk option for Sunny Paws and return the response. */
async function putWalkOption(env: Env, option: Record<string, unknown>): Promise<Response> {
  return app.request(
    '/api/sunny-paws/admin/settings',
    {
      method: 'PUT',
      headers: await auth(TENANT_A, true),
      body: JSON.stringify({
        services: [{ type: 'walk', enabled: true, options: [option] }],
      }),
    },
    env,
  );
}

type OptionWire = { optionKey: string; weekdaysOnly: boolean };
type SettingsWire = { services: { type: string; options: OptionWire[] }[] };

describe('weekday-only — settings round-trip', () => {
  it('persists weekdaysOnly=true and returns it in admin settings AND public config', async () => {
    const { env } = createTestEnv();
    const put = await putWalkOption(env, {
      label: 'Pack walk',
      rate: 25,
      startTime: '10:00',
      endTime: '14:00',
      capacity: 8,
      weekdaysOnly: true,
    });
    expect(put.status).toBe(204);

    const settings = (await (
      await app.request('/api/sunny-paws/admin/settings', { headers: await auth(TENANT_A) }, env)
    ).json()) as SettingsWire;
    const adminWalk = settings.services.find((s) => s.type === 'walk')!;
    expect(adminWalk.options).toEqual([
      expect.objectContaining({ optionKey: 'pack-walk', weekdaysOnly: true }),
    ]);

    const cfg = (await (
      await app.request('/api/sunny-paws/config', {}, env)
    ).json()) as SettingsWire;
    const cfgWalk = cfg.services.find((s) => s.type === 'walk')!;
    expect(cfgWalk.options).toEqual([
      expect.objectContaining({ optionKey: 'pack-walk', weekdaysOnly: true }),
    ]);
  });

  it('defaults to false when the flag is omitted', async () => {
    const { env } = createTestEnv();
    const put = await putWalkOption(env, {
      label: 'Anyday walk',
      rate: 20,
      startTime: '09:00',
      endTime: '10:00',
      capacity: 3,
    });
    expect(put.status).toBe(204);

    const settings = (await (
      await app.request('/api/sunny-paws/admin/settings', { headers: await auth(TENANT_A) }, env)
    ).json()) as SettingsWire;
    const walk = settings.services.find((s) => s.type === 'walk')!;
    expect(walk.options[0]).toMatchObject({ weekdaysOnly: false });
  });

  it('rejects a non-boolean weekdaysOnly with 400 (atomic — nothing saved)', async () => {
    const { env } = createTestEnv();
    const put = await putWalkOption(env, {
      label: 'Bad walk',
      rate: 20,
      startTime: '10:00',
      endTime: '11:00',
      weekdaysOnly: 'yes',
    });
    expect(put.status).toBe(400);
    const body = (await put.json()) as { error: string };
    expect(body.error).toMatch(/weekdays/i);

    // The invalid save must not have replaced the seeded walk options.
    const settings = (await (
      await app.request('/api/sunny-paws/admin/settings', { headers: await auth(TENANT_A) }, env)
    ).json()) as SettingsWire;
    const walk = settings.services.find((s) => s.type === 'walk')!;
    expect(walk.options.map((o) => o.optionKey)).toContain('d30'); // seeded option intact
  });
});
