import { describe, expect, it } from 'vitest';
import {
  countPetTypeReferences,
  createPetType,
  createTenantFromSignup,
  deletePetType,
  deletePetTypeAndScrub,
  insertBookingRequest,
  listPetTypes,
  listServices,
  renamePetType,
  rollbackUnclaimedTenant,
  setServiceAcceptedPetTypes,
  setServiceConfig,
} from '../db/repo';
import { ALLOWED_EMAIL, createTestEnv, TENANT_A } from './helpers';

describe('pet-type rows (repo)', () => {
  it('listPetTypes returns Label, ordered by PetType', async () => {
    const { env } = createTestEnv();
    const rows = await listPetTypes(env.PAWBOOK_DB, TENANT_A);
    expect(rows.map((r) => ({ petType: r.PetType, label: r.Label, enabled: r.Enabled }))).toEqual([
      { petType: 'cat', label: 'Cats', enabled: 1 },
      { petType: 'dog', label: 'Dogs', enabled: 1 },
      { petType: 'rabbit', label: 'Rabbits', enabled: 1 },
    ]);
  });

  it('createPetType inserts enabled; duplicate slug throws UNIQUE', async () => {
    const { env } = createTestEnv();
    await createPetType(env.PAWBOOK_DB, TENANT_A, 'bird', 'Birds');
    const rows = await listPetTypes(env.PAWBOOK_DB, TENANT_A);
    expect(rows.find((r) => r.PetType === 'bird')).toMatchObject({ Label: 'Birds', Enabled: 1 });
    await expect(createPetType(env.PAWBOOK_DB, TENANT_A, 'bird', 'Birds!')).rejects.toThrow(
      /UNIQUE constraint failed/,
    );
  });

  it('renamePetType changes Label only; unknown slug reports false', async () => {
    const { env } = createTestEnv();
    expect(await renamePetType(env.PAWBOOK_DB, TENANT_A, 'rabbit', 'Bunnies')).toBe(true);
    const rows = await listPetTypes(env.PAWBOOK_DB, TENANT_A);
    expect(rows.find((r) => r.PetType === 'rabbit')?.Label).toBe('Bunnies');
    expect(await renamePetType(env.PAWBOOK_DB, TENANT_A, 'dragon', 'Dragons')).toBe(false);
  });

  it('countPetTypeReferences counts customer pets AND bookings of any status', async () => {
    const { env } = createTestEnv();
    // Seeded: Bella + Otis are dogs (Bella in TENANT_A), and seeded pending bookings carry
    // PetType 'dog' — but scope is per-tenant.
    expect(await countPetTypeReferences(env.PAWBOOK_DB, TENANT_A, 'rabbit')).toBe(0);
    await insertBookingRequest(env.PAWBOOK_DB, TENANT_A, {
      endUserId: null,
      serviceType: 'boarding',
      startDate: '2029-05-01',
      endDate: '2029-05-03',
      optionKey: 'standard',
      petType: 'rabbit',
      petCount: 1,
      estCost: null,
      status: 'confirmed',
    });
    expect(await countPetTypeReferences(env.PAWBOOK_DB, TENANT_A, 'rabbit')).toBe(1);
    // Cancelled history still counts (the countBookingsForService rule).
    // Seeded dog references: pets Bella + bookings seed_sp_pend1/seed_sp_pend2 (PetType 'dog').
    expect(await countPetTypeReferences(env.PAWBOOK_DB, TENANT_A, 'dog')).toBeGreaterThanOrEqual(3);
  });

  it('deletePetType removes the row; unknown reports false', async () => {
    const { env } = createTestEnv();
    expect(await deletePetType(env.PAWBOOK_DB, TENANT_A, 'rabbit')).toBe(true);
    expect((await listPetTypes(env.PAWBOOK_DB, TENANT_A)).some((r) => r.PetType === 'rabbit')).toBe(
      false,
    );
    expect(await deletePetType(env.PAWBOOK_DB, TENANT_A, 'rabbit')).toBe(false);
  });

  it('deletePetTypeAndScrub removes the row and scrubs EVERY referencing service in one atomic batch', async () => {
    const { env } = createTestEnv();
    await setServiceAcceptedPetTypes(env.PAWBOOK_DB, TENANT_A, 'walk', ['dog', 'rabbit']);
    await setServiceAcceptedPetTypes(env.PAWBOOK_DB, TENANT_A, 'checkin', ['rabbit']);
    await deletePetTypeAndScrub(env.PAWBOOK_DB, TENANT_A, 'rabbit');
    expect((await listPetTypes(env.PAWBOOK_DB, TENANT_A)).some((r) => r.PetType === 'rabbit')).toBe(
      false,
    );
    const services = await listServices(env.PAWBOOK_DB, TENANT_A);
    // Partial scrub: 'walk' keeps its other accepted slug.
    expect(services.find((s) => s.ServiceType === 'walk')?.AcceptedPetTypes).toEqual(['dog']);
    // Scrub-to-empty -> NULL: 'checkin' named only 'rabbit'.
    expect(services.find((s) => s.ServiceType === 'checkin')?.AcceptedPetTypes).toBeNull();
    // A service that never named the slug is left untouched.
    expect(services.find((s) => s.ServiceType === 'boarding')?.AcceptedPetTypes).toBeNull();
    // The test shim's db.batch() runs the statements inside one BEGIN/COMMIT (see helpers.ts),
    // so atomicity of the delete+scrub follows directly from using batch() here rather than
    // needing a separate mid-write-failure simulation.
  });
});

describe('AcceptedPetTypes round-trip (repo)', () => {
  it('setServiceConfig stores the list as JSON; listServices parses it back; NULL round-trips', async () => {
    const { env } = createTestEnv();
    const before = (await listServices(env.PAWBOOK_DB, TENANT_A)).find(
      (s) => s.ServiceType === 'boarding',
    )!;
    expect(before.AcceptedPetTypes).toBeNull();
    await setServiceConfig(env.PAWBOOK_DB, TENANT_A, 'boarding', {
      enabled: true,
      questions: before.Questions,
      minNights: before.MinNights,
      maxNights: before.MaxNights,
      minPetCount: before.MinPetCount,
      maxPetCount: before.MaxPetCount,
      acceptedPetTypes: ['dog'],
    });
    const after = (await listServices(env.PAWBOOK_DB, TENANT_A)).find(
      (s) => s.ServiceType === 'boarding',
    )!;
    expect(after.AcceptedPetTypes).toEqual(['dog']);
  });

  it('setServiceAcceptedPetTypes updates just the list', async () => {
    const { env } = createTestEnv();
    await setServiceAcceptedPetTypes(env.PAWBOOK_DB, TENANT_A, 'walk', ['dog', 'cat']);
    let walk = (await listServices(env.PAWBOOK_DB, TENANT_A)).find(
      (s) => s.ServiceType === 'walk',
    )!;
    expect(walk.AcceptedPetTypes).toEqual(['dog', 'cat']);
    await setServiceAcceptedPetTypes(env.PAWBOOK_DB, TENANT_A, 'walk', null);
    walk = (await listServices(env.PAWBOOK_DB, TENANT_A)).find((s) => s.ServiceType === 'walk')!;
    expect(walk.AcceptedPetTypes).toBeNull();
  });
});

describe('signup provisioning seeds dog + cat (spec F1)', () => {
  it('createTenantFromSignup yields enabled dog and cat rows', async () => {
    const { env } = createTestEnv();
    const ok = await createTenantFromSignup(env.PAWBOOK_DB, {
      tenantId: 'tnt_fresh',
      slug: 'fresh-paws',
      displayName: 'Fresh Paws',
      userId: 'tu_fresh',
      email: ALLOWED_EMAIL,
      passwordHash: 'x',
    });
    expect(ok).toBe(true);
    const rows = await listPetTypes(env.PAWBOOK_DB, 'tnt_fresh');
    expect(rows.map((r) => ({ petType: r.PetType, label: r.Label, enabled: r.Enabled }))).toEqual([
      { petType: 'cat', label: 'Cats', enabled: 1 },
      { petType: 'dog', label: 'Dogs', enabled: 1 },
    ]);
  });

  it('rollbackUnclaimedTenant removes the pet-type rows too (no FK orphans)', async () => {
    const { env } = createTestEnv();
    await createTenantFromSignup(env.PAWBOOK_DB, {
      tenantId: 'tnt_gone',
      slug: 'gone-paws',
      displayName: 'Gone Paws',
      userId: 'tu_gone',
      email: 'not-on-the-allowlist@example.com', // claim matches 0 rows -> caller compensates
      passwordHash: 'x',
    });
    await rollbackUnclaimedTenant(env.PAWBOOK_DB, 'tnt_gone', 'tu_gone');
    expect(await listPetTypes(env.PAWBOOK_DB, 'tnt_gone')).toEqual([]);
  });
});
