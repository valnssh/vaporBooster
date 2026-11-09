import { createDatabasePool } from './postgres.mjs';
import { migrateDatabase } from './migrations.mjs';

const pool = createDatabasePool(process.env);
try {
	await migrateDatabase(pool);
} catch {
	throw new Error('PostgreSQL migration failed; check connectivity, TLS and database ownership');
} finally {
	await pool.end();
}
