import {
  addDays,
  billableUnits,
  buildCapacity,
  nightsBetween,
  walkHasConflict,
  type CapacityEvent,
  type DayCapacity,
} from '../../src/shared/index.js';
import { listCapacityRows } from '../db/repo';
import { SERVICE_CATALOG, type ServiceType } from '../lib/services';
import type { BookingRow, Tenant, TenantServiceOption } from '../types';

/**
 * Per-tenant availability. Counting, boundary, and blocked semantics come from shared
 * `buildCapacity`/`walkHasConflict`. The range-conflict walk below is a faithful port of
 * shared `rangeHasConflict`'s boarding path with the hardcoded max of 2 replaced by the
 * tenant's `MaxBoardingPets` — a CONSCIOUS deviation recorded in the architecture doc (D-E);
 * `availability.test.ts` pins this port to the shared implementation at max = 2.
 * Graduation path: add an optional `maxPets` param to the shared functions instead.
 */

function dayBlocksBoarding(capacity: DayCapacity, requestPets: number, maxPets: number): boolean {
  const pets = Math.max(1, requestPets);
  if (capacity.blocked >= 1 || capacity.houseSits >= 1) return true;
  return capacity.boarding + pets > maxPets;
}

export function tenantRangeHasConflict(
  startDate: string,
  endDateExclusive: string,
  capacityByDate: Map<string, DayCapacity>,
  requestPetCount: number,
  maxBoardingPets: number,
): boolean {
  const requestEnd = addDays(endDateExclusive, -1); // last occupied night
  const requestPets = Math.max(1, requestPetCount);

  for (let date = startDate; date < endDateExclusive; date = addDays(date, 1)) {
    const capacity = capacityByDate.get(date);
    if (!capacity) continue;
    if (!dayBlocksBoarding(capacity, requestPets, maxBoardingPets)) continue;

    const isRequestEndpoint = date === startDate || date === requestEnd;
    if (isRequestEndpoint && capacity.isBoundary) continue;

    // Soft bookend: an unavailable (non-blocked) endpoint is allowed when the next day has
    // room for this request — the existing booking is ending here.
    if (isRequestEndpoint && capacity.blocked === 0) {
      const next = capacityByDate.get(addDays(date, 1));
      if (!next || !dayBlocksBoarding(next, requestPets, maxBoardingPets)) continue;
    }

    return true;
  }

  return false;
}

export function rowsToCapacityEvents(rows: BookingRow[]): CapacityEvent[] {
  return rows.map((row) => ({
    start_date: row.StartDate,
    end_date: row.EndDate ?? undefined,
    // boarding AND housesitting both consume a boarding slot in this prototype (conscious
    // simplification, like the D-E deviation): a real model would block the day exclusively.
    type: row.ServiceType === 'blocked' ? 'blocked' : 'boarding',
    petCount: row.PetCount,
  }));
}

export type AvailabilityResult =
  | { available: true; estCost: number; nights?: number }
  | { available: false; reason: string };

/**
 * The estimated cost of a booking — the ONE place the price formula lives, so the availability
 * quote and the stored booking cost can't diverge. Range services bill per night; single-day
 * services (daycare/walk/check-in) are a flat per-booking rate. Pure (no DB), so callers that
 * already know the dates can price a booking without a capacity read.
 */
export function estimateCost(
  serviceType: ServiceType,
  option: TenantServiceOption,
  startDate: string,
  endDateExclusive: string,
): number {
  if (SERVICE_CATALOG[serviceType].shape !== 'range') return option.Rate;
  return option.Rate * billableUnits(nightsBetween(startDate, endDateExclusive), 'night');
}

async function checkRange(
  env: Env,
  tenant: Tenant,
  serviceType: ServiceType,
  option: TenantServiceOption,
  startDate: string,
  endDateExclusive: string,
  petCount: number,
  excludeBookingId?: string,
): Promise<AvailabilityResult> {
  // A request for more pets than the tenant's per-day cap can never fit, even on an empty
  // calendar — the range walk skips days with no existing rows, so this isolation check is
  // what actually enforces MaxBoardingPets when there's nothing to conflict with.
  if (petCount > tenant.MaxBoardingPets) {
    return { available: false, reason: 'That exceeds our boarding capacity.' };
  }
  // Fetch one day PAST checkout so the soft-bookend look-ahead (which peeks at the day after the
  // last occupied night) sees a booking that starts exactly on the checkout day. Without the +1,
  // listCapacityRows' `StartDate < end` clips that row and a full final night can be double-booked.
  const rows = await listCapacityRows(
    env.PAWBOOK_DB,
    tenant.Id,
    startDate,
    addDays(endDateExclusive, 1),
    excludeBookingId,
  );
  const capacity = buildCapacity(rowsToCapacityEvents(rows));
  if (
    tenantRangeHasConflict(startDate, endDateExclusive, capacity, petCount, tenant.MaxBoardingPets)
  ) {
    return { available: false, reason: 'Those dates are not available.' };
  }
  return {
    available: true,
    estCost: estimateCost(serviceType, option, startDate, endDateExclusive),
    nights: nightsBetween(startDate, endDateExclusive),
  };
}

async function checkSingle(
  env: Env,
  tenant: Tenant,
  serviceType: ServiceType,
  option: TenantServiceOption,
  date: string,
  excludeBookingId?: string,
): Promise<AvailabilityResult> {
  const rows = await listCapacityRows(
    env.PAWBOOK_DB,
    tenant.Id,
    date,
    addDays(date, 1),
    excludeBookingId,
  );
  const capacity = buildCapacity(rowsToCapacityEvents(rows));
  if (walkHasConflict(date, capacity)) {
    return { available: false, reason: 'That day is blocked off.' };
  }
  return { available: true, estCost: estimateCost(serviceType, option, date, date) };
}

export function checkAvailability(
  env: Env,
  tenant: Tenant,
  serviceType: ServiceType,
  option: TenantServiceOption,
  startDate: string,
  endDateExclusive: string,
  petCount = 1,
  excludeBookingId?: string,
): Promise<AvailabilityResult> {
  return SERVICE_CATALOG[serviceType].shape === 'range'
    ? checkRange(
        env,
        tenant,
        serviceType,
        option,
        startDate,
        endDateExclusive,
        petCount,
        excludeBookingId,
      )
    : checkSingle(env, tenant, serviceType, option, startDate, excludeBookingId);
}
