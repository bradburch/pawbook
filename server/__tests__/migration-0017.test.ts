import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const MIGRATION_PATH = join(
  import.meta.dirname,
  '..',
  '..',
  'migrations',
  '0017_pets_capacity_units.sql',
);

/** Post-0015 shape: TenantServices carries BOTH cap columns. Minimal supporting columns only. */
const DDL = `
CREATE TABLE TenantServices (
  TenantId TEXT NOT NULL,
  ServiceType TEXT NOT NULL,
  CapacityKind TEXT NOT NULL DEFAULT 'none' CHECK (CapacityKind IN ('boarding', 'housesit', 'none')),
  MaxConcurrentPets INTEGER,
  MaxPerDay INTEGER,
  UNIQUE (TenantId, ServiceType)
);
`;

describe('migration 0017 — fold MaxPerDay into MaxConcurrentPets (house-sit)', () => {
  function migratedDb(): DatabaseSync {
    const db = new DatabaseSync(':memory:');
    db.exec(DDL);
    db.exec(`INSERT INTO TenantServices (TenantId, ServiceType, CapacityKind, MaxConcurrentPets, MaxPerDay) VALUES
      ('t1', 'housesitting', 'housesit', NULL, 2),
      ('t1', 'overnight-sit', 'housesit', 5, 2),
      ('t1', 'unlimited-sit', 'housesit', NULL, NULL),
      ('t1', 'boarding', 'boarding', 4, NULL),
      ('t1', 'walk', 'none', NULL, NULL)`);
    db.exec('BEGIN');
    db.exec(readFileSync(MIGRATION_PATH, 'utf8'));
    db.exec('COMMIT');
    return db;
  }

  const cap = (db: DatabaseSync, type: string) =>
    db
      .prepare(
        `SELECT MaxConcurrentPets, MaxPerDay FROM TenantServices WHERE TenantId = 't1' AND ServiceType = ?`,
      )
      .get(type) as { MaxConcurrentPets: number | null; MaxPerDay: number | null };

  it('copies MaxPerDay into a NULL MaxConcurrentPets for house-sit', () => {
    expect(cap(migratedDb(), 'housesitting').MaxConcurrentPets).toBe(2);
  });

  it('prefers an existing MaxConcurrentPets over MaxPerDay (COALESCE)', () => {
    expect(cap(migratedDb(), 'overnight-sit').MaxConcurrentPets).toBe(5);
  });

  it('leaves NULL/NULL house-sit unlimited', () => {
    expect(cap(migratedDb(), 'unlimited-sit').MaxConcurrentPets).toBeNull();
  });

  it('does not touch boarding or none-kind services', () => {
    const db = migratedDb();
    expect(cap(db, 'boarding').MaxConcurrentPets).toBe(4);
    expect(cap(db, 'walk').MaxConcurrentPets).toBeNull();
  });

  it('retires MaxPerDay in place — the column and its old values stay', () => {
    expect(cap(migratedDb(), 'housesitting').MaxPerDay).toBe(2);
  });
});
