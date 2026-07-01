import { describe, expect, it } from 'vitest';
import app from '../index';
import { adminToken, createTestEnv, endUserToken } from './helpers';

describe('admin customer pets', () => {
  it('lists customers with their pets', async () => {
    const { env } = createTestEnv();
    const token = await adminToken('tnt_sunnypaws');
    const res = await app.request(
      '/api/sunny-paws/admin/customers',
      { headers: { Authorization: `Bearer ${token}` } },
      env,
    );
    const body = (await res.json()) as { customers: { email: string; pets: { name: string }[] }[] };
    const jess = body.customers.find((c) => c.email === 'jess@example.com');
    expect(jess?.pets.map((p) => p.name).sort()).toEqual(['Bella', 'Mochi']);
  });

  it('cannot delete a pet that is referenced in a booking', async () => {
    const { env } = createTestEnv();
    const token = await adminToken('tnt_sunnypaws');
    // Book Bella via end-user flow so the pet is referenced in BookingRequestPets
    const euToken = await endUserToken(env, 'sunny-paws', 'jess@example.com');
    const book = await app.request(
      '/api/sunny-paws/bookings',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${euToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'boarding',
          optionKey: 'standard',
          startDate: '2026-09-01',
          endDate: '2026-09-03',
          petIds: ['pet_sp_bella'],
        }),
      },
      env,
    );
    expect(book.status).toBe(201);

    const del = await app.request(
      '/api/sunny-paws/admin/customers/eu_sp_jess/pets/pet_sp_bella',
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      env,
    );
    expect(del.status).toBe(409);
  });

  it('adds and removes a pet; rejects a disabled species', async () => {
    const { env } = createTestEnv();
    const token = await adminToken('tnt_sunnypaws');
    const add = await app.request(
      '/api/sunny-paws/admin/customers/eu_sp_jess/pets',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Rex', petType: 'dog' }),
      },
      env,
    );
    expect(add.status).toBe(201);
    const petId = ((await add.json()) as { id: string }).id;
    const del = await app.request(
      `/api/sunny-paws/admin/customers/eu_sp_jess/pets/${petId}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      env,
    );
    expect(del.status).toBe(204);

    const tokenB = await adminToken('tnt_happytails');
    const bad = await app.request(
      '/api/happy-tails/admin/customers/eu_ht_jess/pets',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Whiskers', petType: 'cat' }), // Happy Tails = dogs only
      },
      env,
    );
    expect(bad.status).toBe(400);
  });
});
