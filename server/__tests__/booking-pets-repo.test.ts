import { describe, expect, it } from 'vitest';
import { createTestEnv, TENANT_A } from './helpers';
import { addBookingPets, insertBookingRequest, listBookingPetsForUser } from '../db/repo';

describe('BookingRequestPets repo', () => {
  it('links a booking to pets and lists them for the user', async () => {
    const { env } = createTestEnv();
    const bookingId = await insertBookingRequest(env.PAWBOOK_DB, TENANT_A, {
      endUserId: 'eu_sp_jess',
      serviceType: 'boarding',
      startDate: '2026-08-01',
      endDate: '2026-08-03',
      optionKey: 'standard',
      petType: 'dog',
      petCount: 2,
      estCost: 100,
      status: 'pending',
    });
    await addBookingPets(env.PAWBOOK_DB, bookingId, ['pet_sp_bella', 'pet_sp_mochi']);
    const rows = await listBookingPetsForUser(env.PAWBOOK_DB, TENANT_A, 'eu_sp_jess');
    const names = rows
      .filter((r) => r.BookingRequestId === bookingId)
      .map((r) => r.Name)
      .sort();
    expect(names).toEqual(['Bella', 'Mochi']);
  });
});
