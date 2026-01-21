// Export a mutable Drizzle instance that will be initialized by
// `initializeDatabase()` in the database service. This avoids creating
// a separate connection before the app has initialized the DB file/schema.
export let db: any = null;

export function setDrizzleInstance(instance: any) {
  db = instance;
}
