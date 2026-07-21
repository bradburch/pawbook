import { describe, expect, it } from 'vitest';
import { createTestEnv, TENANT_A } from './helpers';
import { listServices, setServiceConfig } from '../db/repo';

describe('cancellation tiers config round-trip', () => {
  it('setServiceConfig persists tiers and listServices parses them', async () => {
    const { env } = createTestEnv();
    const before = (await listServices(env.PAWBOOK_DB, TENANT_A)).find(
      (s) => s.ServiceType === 'boarding',
    )!;
    expect(before.CancellationTiers).toBeNull();

    const tiers = [
      { withinDays: 2, percent: 100 },
      { withinDays: 7, percent: 50 },
    ];
    const ok = await setServiceConfig(env.PAWBOOK_DB, TENANT_A, 'boarding', {
      enabled: true,
      questions: before.Questions,
      minNights: before.MinNights,
      maxNights: before.MaxNights,
      minPetCount: before.MinPetCount,
      maxPetCount: before.MaxPetCount,
      acceptedPetTypes: before.AcceptedPetTypes,
      maxConcurrentPets: before.MaxConcurrentPets,
      maxPerDay: before.MaxPerDay,
      cancellationTiers: tiers,
    });
    expect(ok).toBe(true);

    const after = (await listServices(env.PAWBOOK_DB, TENANT_A)).find(
      (s) => s.ServiceType === 'boarding',
    )!;
    expect(after.CancellationTiers).toEqual(tiers);
  });

  it('null clears tiers', async () => {
    const { env } = createTestEnv();
    const before = (await listServices(env.PAWBOOK_DB, TENANT_A)).find(
      (s) => s.ServiceType === 'boarding',
    )!;

    const tiers = [{ withinDays: 3, percent: 25 }];
    const setOk = await setServiceConfig(env.PAWBOOK_DB, TENANT_A, 'boarding', {
      enabled: true,
      questions: before.Questions,
      minNights: before.MinNights,
      maxNights: before.MaxNights,
      minPetCount: before.MinPetCount,
      maxPetCount: before.MaxPetCount,
      acceptedPetTypes: before.AcceptedPetTypes,
      maxConcurrentPets: before.MaxConcurrentPets,
      maxPerDay: before.MaxPerDay,
      cancellationTiers: tiers,
    });
    expect(setOk).toBe(true);

    const withTiers = (await listServices(env.PAWBOOK_DB, TENANT_A)).find(
      (s) => s.ServiceType === 'boarding',
    )!;
    expect(withTiers.CancellationTiers).toEqual(tiers);

    const clearOk = await setServiceConfig(env.PAWBOOK_DB, TENANT_A, 'boarding', {
      enabled: true,
      questions: before.Questions,
      minNights: before.MinNights,
      maxNights: before.MaxNights,
      minPetCount: before.MinPetCount,
      maxPetCount: before.MaxPetCount,
      acceptedPetTypes: before.AcceptedPetTypes,
      maxConcurrentPets: before.MaxConcurrentPets,
      maxPerDay: before.MaxPerDay,
      cancellationTiers: null,
    });
    expect(clearOk).toBe(true);

    const cleared = (await listServices(env.PAWBOOK_DB, TENANT_A)).find(
      (s) => s.ServiceType === 'boarding',
    )!;
    expect(cleared.CancellationTiers).toBeNull();
  });
});
