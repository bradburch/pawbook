import { describe, expect, it } from 'vitest';
import app from '../index';
import { setServiceAcceptedPetTypes, setPetTypeEnabled } from '../db/repo';
import { adminToken, createTestEnv, endUserToken, TENANT_A } from './helpers';

const book = async (env: Env, token: string, petIds: string[], type = 'boarding') =>
  app.request(
    '/api/sunny-paws/bookings',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        optionKey: type === 'boarding' ? 'standard' : 'd30',
        startDate: '2026-10-01',
        ...(type === 'boarding' ? { endDate: '2026-10-03' } : {}),
        petIds,
      }),
    },
    env,
  );

describe('per-service pet-type acceptance (booking POST)', () => {
  it('rejects a pet whose type is off the service list, with the plain-language message', async () => {
    const { env } = createTestEnv();
    await setServiceAcceptedPetTypes(env.PAWBOOK_DB, TENANT_A, 'boarding', ['dog']);
    const token = await endUserToken(env, 'sunny-paws', 'jess@example.com');
    const res = await book(env, token, ['pet_sp_mochi']); // Mochi is a cat
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "Boarding doesn't accept cats — Mochi can't join this booking.",
    );
  });

  it('a mixed dog+cat selection is rejected too — any offending pet fails the booking', async () => {
    const { env } = createTestEnv();
    await setServiceAcceptedPetTypes(env.PAWBOOK_DB, TENANT_A, 'boarding', ['dog']);
    const token = await endUserToken(env, 'sunny-paws', 'jess@example.com');
    const res = await book(env, token, ['pet_sp_bella', 'pet_sp_mochi']);
    expect(res.status).toBe(400);
  });

  it('NULL acceptance accepts every enabled type, including a fresh custom one', async () => {
    const { env } = createTestEnv();
    const admin = await adminToken(TENANT_A);
    const addPet = await app.request(
      '/api/sunny-paws/admin/customers/eu_sp_jess/pets',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Peanut', petType: 'rabbit' }),
      },
      env,
    );
    expect(addPet.status).toBe(201);
    const petId = ((await addPet.json()) as { id: string }).id;
    const token = await endUserToken(env, 'sunny-paws', 'jess@example.com');
    const res = await book(env, token, [petId]); // boarding AcceptedPetTypes is NULL
    expect(res.status).toBe(201);
  });

  it('tenant-level disable still wins even when the service list names the type', async () => {
    const { env } = createTestEnv();
    await setServiceAcceptedPetTypes(env.PAWBOOK_DB, TENANT_A, 'boarding', ['dog', 'cat']);
    await setPetTypeEnabled(env.PAWBOOK_DB, TENANT_A, 'cat', false);
    const token = await endUserToken(env, 'sunny-paws', 'jess@example.com');
    const res = await book(env, token, ['pet_sp_mochi']);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('That pet type is not accepted.');
  });
});
