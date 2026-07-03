import { describe, expect, it } from 'vitest';
import { createTestEnv, TENANT_A, TENANT_B } from './helpers';
import { addEndUserPet, listEndUserPets, removeEndUserPet } from '../db/repo';

describe('EndUserPets repo', () => {
  it('adds, lists, and scopes pets by tenant', async () => {
    const { env } = createTestEnv();
    const pet = await addEndUserPet(env.PAWBOOK_DB, TENANT_A, 'eu_sp_jess', 'Rex', 'dog');
    expect(pet.Name).toBe('Rex');
    const forA = await listEndUserPets(env.PAWBOOK_DB, TENANT_A, 'eu_sp_jess');
    expect(forA.map((p) => p.Name).sort()).toEqual(['Bella', 'Mochi', 'Rex']);
    const forB = await listEndUserPets(env.PAWBOOK_DB, TENANT_B, 'eu_sp_jess');
    expect(forB).toEqual([]);
  });

  it('removes a pet scoped to its tenant', async () => {
    const { env } = createTestEnv();
    expect(await removeEndUserPet(env.PAWBOOK_DB, TENANT_A, 'pet_sp_bella')).toBe(true);
    const left = await listEndUserPets(env.PAWBOOK_DB, TENANT_A, 'eu_sp_jess');
    expect(left.map((p) => p.Name)).toEqual(['Mochi']);
    expect(await removeEndUserPet(env.PAWBOOK_DB, TENANT_B, 'pet_sp_mochi')).toBe(false);
  });
});
