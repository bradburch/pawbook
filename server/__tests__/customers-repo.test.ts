import { describe, expect, it } from 'vitest';
import {
  countBookingsForUser, deleteCustomer, getEndUserByEmail, insertInvitedCustomer,
  listCustomers, promoteCustomerActive,
} from '../db/repo';
import { createTestEnv, TENANT_A } from './helpers';

describe('customer repo', () => {
  it('inserts an invited customer and is idempotent (no active downgrade)', async () => {
    const { env } = createTestEnv();
    const a = await insertInvitedCustomer(env.PAWBOOK_DB, TENANT_A, 'new@example.com', 'New Person');
    expect(a.Status).toBe('invited');
    expect(a.Name).toBe('New Person');

    await promoteCustomerActive(env.PAWBOOK_DB, TENANT_A, a.Id);
    const again = await insertInvitedCustomer(env.PAWBOOK_DB, TENANT_A, 'new@example.com', 'Ignored');
    expect(again.Id).toBe(a.Id);
    expect(again.Status).toBe('active'); // not downgraded
  });

  it('getEndUserByEmail returns null for unknown', async () => {
    const { env } = createTestEnv();
    expect(await getEndUserByEmail(env.PAWBOOK_DB, TENANT_A, 'nobody@example.com')).toBeNull();
  });

  it('lists customers and counts bookings', async () => {
    const { env, raw } = createTestEnv();
    const c = await insertInvitedCustomer(env.PAWBOOK_DB, TENANT_A, 'c@example.com', null);
    expect((await listCustomers(env.PAWBOOK_DB, TENANT_A)).some((u) => u.Id === c.Id)).toBe(true);
    expect(await countBookingsForUser(env.PAWBOOK_DB, TENANT_A, c.Id)).toBe(0);

    raw.exec(`INSERT INTO BookingRequests (Id, TenantId, EndUserId, ServiceType, StartDate, PetCount, Status)
              VALUES ('bk1','${TENANT_A}','${c.Id}','daycare','2030-04-01',1,'pending')`);
    expect(await countBookingsForUser(env.PAWBOOK_DB, TENANT_A, c.Id)).toBe(1);
  });

  it('deleteCustomer refuses when the customer has bookings (TOCTOU guard)', async () => {
    const { env, raw } = createTestEnv();
    const c = await insertInvitedCustomer(env.PAWBOOK_DB, TENANT_A, 'withbooking@example.com', null);
    raw.exec(`INSERT INTO BookingRequests (Id, TenantId, EndUserId, ServiceType, StartDate, PetCount, Status)
              VALUES ('bk2','${TENANT_A}','${c.Id}','daycare','2030-04-01',1,'pending')`);
    // With a booking: must return false and leave both rows intact
    expect(await deleteCustomer(env.PAWBOOK_DB, TENANT_A, c.Id)).toBe(false);
    expect((await listCustomers(env.PAWBOOK_DB, TENANT_A)).some((u) => u.Id === c.Id)).toBe(true);
    expect(await countBookingsForUser(env.PAWBOOK_DB, TENANT_A, c.Id)).toBe(1);
  });

  it('deleteCustomer succeeds with no bookings; returns false for missing id', async () => {
    const { env } = createTestEnv();
    const c = await insertInvitedCustomer(env.PAWBOOK_DB, TENANT_A, 'nobooking@example.com', null);
    expect(await deleteCustomer(env.PAWBOOK_DB, TENANT_A, c.Id)).toBe(true);
    expect((await listCustomers(env.PAWBOOK_DB, TENANT_A)).some((u) => u.Id === c.Id)).toBe(false);
    expect(await deleteCustomer(env.PAWBOOK_DB, TENANT_A, 'missing')).toBe(false);
  });
});
