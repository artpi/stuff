const migrations = new Map();

export function registerMigration(fromVersion, migration) {
  const from = Number(fromVersion);
  if (!Number.isInteger(from) || from < 0) throw new TypeError('Migration versions must be non-negative integers.');
  if (!migration || migration.to !== from + 1 || !Array.isArray(migration.steps)) {
    throw new TypeError('A migration must target the next integer version and declare idempotent steps.');
  }
  migrations.set(from, Object.freeze({ ...migration, steps: Object.freeze([...migration.steps]) }));
}

export function migrationPath(fromVersion, toVersion) {
  const path = [];
  for (let version = Number(fromVersion); version < Number(toVersion); version += 1) {
    const migration = migrations.get(version);
    if (!migration) return null;
    path.push(migration);
  }
  return path;
}

export function registeredMigrations() {
  return new Map(migrations);
}
