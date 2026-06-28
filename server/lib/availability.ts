import {
  addDays,
  billableUnits,
  buildCapacity,
  nightsBetween,
  rangeHasConflict,
  walkHasConflict,
  type CapacityEvent,
  type CapacityLimits,
} from '../../src/shared/index.js';
import { listCapacityRows } from '../db/repo';
import { SERVICE_CATALOG, type ServiceType } from '../lib/services';
import type { BookingRow, Tenant, TenantServiceOption } from '../types';

/**
 * Per-tenant availability built on the shared capacity engine. The tenant's nullable config
 * columns map straight onto CapacityLimits (null = unlimited / auto pass-through).
 */
function tenantLimits(tenant: Tenant): CapacityLimits {
  return {
    maxBoardingPets: tenant.MaxBoardingPets,
    maxHouseSitsPerDay: tenant.MaxHouseSitsPerDay,
  };
}

export function rowsToCapacityEvents(rows: BookingRow[]): CapacityEvent[] {
  return rows.map((row) => ({
    start_date: row.StartDate,
    end_date: row.EndDate ?? undefined,
    type:
      row.ServiceType === 'blocked'
        ? 'blocked'
        : row.ServiceType === 'housesitting'
          ? 'house-sit'
          : 'boarding',
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
  const requestType = serviceType === 'housesitting' ? 'house-sit' : 'boarding';
  const limits = tenantLimits(tenant);
  // A boarding request for more pets than a CONFIGURED per-day cap can never fit, even on an empty
  // calendar (the range walk skips empty days). Skipped entirely when boarding is unlimited.
  if (
    requestType === 'boarding' &&
    tenant.MaxBoardingPets !== null &&
    petCount > tenant.MaxBoardingPets
  ) {
    return { available: false, reason: 'That exceeds our boarding capacity.' };
  }
  // Fetch one day PAST checkout so the soft-bookend look-ahead sees a booking starting on the
  // checkout day (without +1, listCapacityRows clips that row and a final night can double-book).
  const rows = await listCapacityRows(
    env.PAWBOOK_DB,
    tenant.Id,
    startDate,
    addDays(endDateExclusive, 1),
    excludeBookingId,
  );
  const capacity = buildCapacity(rowsToCapacityEvents(rows));
  if (rangeHasConflict(startDate, endDateExclusive, requestType, capacity, limits, petCount)) {
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
