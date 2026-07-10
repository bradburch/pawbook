import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../index';
import { reconcileBookingsWithCalendar, reconcileIfStale } from '../lib/calendar-sync';
import { insertBookingRequest, setBookingGCalEventId, setProviderTokens } from '../db/repo';
import { encryptToken } from '../lib/token-crypto';
import { adminToken, createTestEnv, TENANT_A, TEST_SECRET } from './helpers';
import type { Tenant } from '../types';

const tenant = { Id: TENANT_A, Slug: 'sunny-paws', Timezone: null } as Tenant;

async function connectCalendar(env: Env) {
  await setProviderTokens(env.PAWBOOK_DB, TENANT_A, 'calendar', 'google-calendar', {
    access: await encryptToken(TEST_SECRET, 'access-1'),
    refresh: await encryptToken(TEST_SECRET, 'refresh-1'),
    expiresAt: '2030-01-01T00:00:00Z', // far future — no refresh-token fetch needed
    calendarId: 'primary',
  });
}

function calendarListResponse(bookingIds: string[]) {
  return new Response(
    JSON.stringify({
      items: bookingIds.map((id) => ({
        summary: 'Boarding',
        start: { date: '2030-03-01' },
        end: { date: '2030-03-04' },
        extendedProperties: { private: { pawbook: 'true', category: 'boarding', bookingId: id } },
      })),
    }),
    { status: 200 },
  );
}

async function seedSyncedBooking(env: Env): Promise<string> {
  const id = await insertBookingRequest(env.PAWBOOK_DB, TENANT_A, {
    endUserId: null,
    serviceType: 'boarding',
    startDate: '2030-03-01',
    endDate: '2030-03-04',
    optionKey: 'standard',
    petType: 'dog',
    petCount: 1,
    estCost: 150,
    status: 'confirmed',
  });
  await setBookingGCalEventId(env.PAWBOOK_DB, TENANT_A, id, 'evt_1');
  return id;
}

async function statusOf(env: Env, id: string): Promise<string> {
  const row = await env.PAWBOOK_DB.prepare('SELECT Status FROM BookingRequests WHERE Id = ?')
    .bind(id)
    .first<{ Status: string }>();
  return row!.Status;
}

describe('reconcileBookingsWithCalendar', () => {
  afterEach(() => vi.restoreAllMocks());

  it('cancels a synced booking whose event is missing from Calendar', async () => {
    const { env } = createTestEnv();
    await connectCalendar(env);
    const id = await seedSyncedBooking(env);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(calendarListResponse([])); // event deleted
    await reconcileBookingsWithCalendar(env, tenant);
    expect(await statusOf(env, id)).toBe('cancelled');
  });

  it('leaves a booking untouched when its event is still present', async () => {
    const { env } = createTestEnv();
    await connectCalendar(env);
    const id = await seedSyncedBooking(env);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(calendarListResponse([id]));
    await reconcileBookingsWithCalendar(env, tenant);
    expect(await statusOf(env, id)).toBe('confirmed');
  });

  it('no-ops when no calendar is connected', async () => {
    const { env } = createTestEnv();
    const spy = vi.spyOn(globalThis, 'fetch');
    await reconcileBookingsWithCalendar(env, tenant);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('reconcileIfStale', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reconciles once, then skips within the TTL window', async () => {
    const { env } = createTestEnv();
    await connectCalendar(env);
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(calendarListResponse([]));
    await reconcileIfStale(env, tenant);
    expect(spy).toHaveBeenCalledTimes(1);
    await reconcileIfStale(env, tenant);
    expect(spy).toHaveBeenCalledTimes(1); // second call within the TTL skips Calendar entirely
  });

  it('writes the TTL marker even when reconciliation fails, throttling retries during an outage', async () => {
    const { env } = createTestEnv();
    await connectCalendar(env);
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 500 })); // Calendar API failure
    await reconcileIfStale(env, tenant);
    expect(spy).toHaveBeenCalledTimes(1);
    await reconcileIfStale(env, tenant);
    expect(spy).toHaveBeenCalledTimes(1); // marker was written despite the first call's failure
  });
});

describe('GET /:slug/admin/bookings triggers reconciliation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('cancels a booking whose calendar event is gone before returning the list', async () => {
    const { env } = createTestEnv();
    await connectCalendar(env);
    const id = await seedSyncedBooking(env);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(calendarListResponse([]));
    const token = await adminToken(TENANT_A);
    const res = await app.request(
      '/api/sunny-paws/admin/bookings',
      { headers: { Authorization: `Bearer ${token}` } },
      env,
    );
    const body = (await res.json()) as { bookings: { id: string; status: string }[] };
    expect(body.bookings.find((b) => b.id === id)?.status).toBe('cancelled');
  });
});
