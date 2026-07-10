import { addDays, DEFAULT_TIMEZONE, getPacificDateStr } from '../../src/shared/index.js';
import {
  getEndUserById,
  getProviderConnection,
  listSyncedBookingIds,
  setBookingGCalEventId,
  setProviderTokens,
  updateBookingStatus,
} from '../db/repo';
import {
  buildEventResource,
  createEvent,
  listCalendarEvents,
  refreshAccessToken,
} from './google-calendar';
import type { ServiceType } from './services';
import { decryptToken, encryptToken } from './token-crypto';
import type { Tenant, ProviderConnectionWithTokens } from '../types';

export type SyncInput = {
  bookingId: string;
  endUserId: string | null;
  serviceType: ServiceType; // tenant service slug — stored as the event's category
  serviceLabel: string;
  startDate: string;
  endDate: string | null;
  startTime: string | null;
  durationMinutes: number | null;
  petCount: number;
  estCost: number | null;
};

/**
 * Decrypt the stored access token for a provider connection, refreshing it (and persisting the new
 * tokens) if the current token is missing or expired. Returns the plaintext access token.
 */
export async function getCalendarAccessToken(
  env: Env,
  tenant: Tenant,
  conn: ProviderConnectionWithTokens,
): Promise<string> {
  if (!conn.TokenExpiresAt || conn.TokenExpiresAt <= new Date().toISOString()) {
    const refreshToken = await decryptToken(env.TOKEN_SECRET, conn.RefreshToken!);
    const refreshed = await refreshAccessToken(env, refreshToken);
    await setProviderTokens(env.PAWBOOK_DB, tenant.Id, 'calendar', conn.Provider, {
      access: await encryptToken(env.TOKEN_SECRET, refreshed.accessToken),
      refresh: conn.RefreshToken!,
      expiresAt: refreshed.expiresAt,
      calendarId: conn.CalendarId ?? 'primary',
    });
    return refreshed.accessToken;
  }
  return decryptToken(env.TOKEN_SECRET, conn.AccessToken!);
}

/**
 * Best-effort: create a Google Calendar event for a booking and persist its id. Callers run this
 * via executionCtx.waitUntil and ignore rejections — a Google failure must never affect a booking.
 */
export async function syncBookingToCalendar(env: Env, tenant: Tenant, b: SyncInput): Promise<void> {
  const conn = await getProviderConnection(env.PAWBOOK_DB, tenant.Id, 'calendar');
  if (!conn || conn.Status !== 'connected' || !conn.AccessToken || !conn.RefreshToken) return;

  const accessToken = await getCalendarAccessToken(env, tenant, conn);

  const customer = b.endUserId
    ? await getEndUserById(env.PAWBOOK_DB, tenant.Id, b.endUserId)
    : null;

  const resource = buildEventResource({
    serviceLabel: b.serviceLabel,
    category: b.serviceType,
    bookingId: b.bookingId,
    startDate: b.startDate,
    endDate: b.endDate,
    startTime: b.startTime,
    durationMinutes: b.durationMinutes,
    petCount: b.petCount,
    estCost: b.estCost,
    customerEmail: customer?.Email ?? null,
    timezone: tenant.Timezone ?? DEFAULT_TIMEZONE,
  });

  const { id } = await createEvent(accessToken, conn.CalendarId ?? 'primary', resource);
  await setBookingGCalEventId(env.PAWBOOK_DB, tenant.Id, b.bookingId, id);
}

const CALENDAR_SYNC_TTL_SECONDS = 120;
const calendarSyncKey = (tenantId: string) => `calendar-sync:${tenantId}:last`;

/**
 * Reconciles this tenant's synced bookings against Google Calendar: if a booking's event was
 * deleted directly in Calendar (not through Pawbook), the booking is marked cancelled. Read-only
 * against Google and strictly best-effort — a Calendar failure must never block the dashboard from
 * returning current DB state, same philosophy as syncBookingToCalendar above.
 */
export async function reconcileBookingsWithCalendar(env: Env, tenant: Tenant): Promise<void> {
  const conn = await getProviderConnection(env.PAWBOOK_DB, tenant.Id, 'calendar');
  if (!conn || conn.Status !== 'connected' || !conn.AccessToken || !conn.RefreshToken) return;

  const accessToken = await getCalendarAccessToken(env, tenant, conn);
  const today = getPacificDateStr(new Date(), tenant.Timezone ?? DEFAULT_TIMEZONE);
  const events = await listCalendarEvents(
    accessToken,
    conn.CalendarId ?? 'primary',
    `${addDays(today, -1)}T00:00:00Z`,
    `${addDays(today, 180)}T00:00:00Z`,
  );
  const liveBookingIds = new Set(events.map((e) => e.private.bookingId).filter(Boolean));

  const candidates = await listSyncedBookingIds(env.PAWBOOK_DB, tenant.Id);
  for (const id of candidates) {
    if (!liveBookingIds.has(id)) {
      await updateBookingStatus(env.PAWBOOK_DB, tenant.Id, id, 'cancelled');
    }
  }
}

/** Reconciles at most once per CALENDAR_SYNC_TTL_SECONDS per tenant, via PAWBOOK_CACHE. */
export async function reconcileIfStale(env: Env, tenant: Tenant): Promise<void> {
  const key = calendarSyncKey(tenant.Id);
  if (await env.PAWBOOK_CACHE.get(key)) return;
  try {
    await reconcileBookingsWithCalendar(env, tenant);
  } catch {
    /* best-effort; the dashboard falls back to current DB state and tries again next TTL window */
  }
  await env.PAWBOOK_CACHE.put(key, '1', { expirationTtl: CALENDAR_SYNC_TTL_SECONDS });
}
