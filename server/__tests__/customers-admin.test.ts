import { describe, expect, it } from 'vitest';
import app from '../index';
import { adminHeaders, createTestEnv, TENANT_A } from './helpers';

const SLUG = 'sunny-paws';

describe('admin customers', () => {
  it('adds, lists, and removes a customer', async () => {
    const { env } = createTestEnv();
    const headers = { ...(await adminHeaders(TENANT_A)), 'Content-Type': 'application/json' };

    const add = await app.request(`/api/${SLUG}/admin/customers`, {
      method: 'POST', headers, body: JSON.stringify({ email: 'guest@example.com', name: 'Guest' }),
    }, env);
    expect(add.status).toBe(201);
    const created = (await add.json()) as { id: string; status: string };
    expect(created.status).toBe('invited');

    const list = await app.request(`/api/${SLUG}/admin/customers`,
      { headers: await adminHeaders(TENANT_A) }, env);
    const { customers } = (await list.json()) as { customers: { email: string }[] };
    expect(customers.some((c) => c.email === 'guest@example.com')).toBe(true);

    const del = await app.request(`/api/${SLUG}/admin/customers/${created.id}`,
      { method: 'DELETE', headers: await adminHeaders(TENANT_A) }, env);
    expect(del.status).toBe(204);
  });

  it('rejects an invalid email with 400', async () => {
    const { env } = createTestEnv();
    const headers = { ...(await adminHeaders(TENANT_A)), 'Content-Type': 'application/json' };
    const res = await app.request(`/api/${SLUG}/admin/customers`,
      { method: 'POST', headers, body: JSON.stringify({ email: 'nope' }) }, env);
    expect(res.status).toBe(400);
  });

  it('refuses to delete a customer with bookings (409)', async () => {
    const { env, raw } = createTestEnv();
    raw.exec(`INSERT INTO EndUsers (Id, TenantId, Email, Status) VALUES ('eu1','${TENANT_A}','has@example.com','active')`);
    raw.exec(`INSERT INTO BookingRequests (Id, TenantId, EndUserId, ServiceType, StartDate, PetCount, Status)
              VALUES ('bk1','${TENANT_A}','eu1','daycare','2030-05-01',1,'pending')`);
    const res = await app.request(`/api/${SLUG}/admin/customers/eu1`,
      { method: 'DELETE', headers: await adminHeaders(TENANT_A) }, env);
    expect(res.status).toBe(409);
  });

  it('requires admin auth', async () => {
    const { env } = createTestEnv();
    const res = await app.request(`/api/${SLUG}/admin/customers`, {}, env);
    expect(res.status).toBe(401);
  });
});
