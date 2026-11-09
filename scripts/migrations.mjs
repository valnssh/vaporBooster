import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';

export async function migrateDatabase(pool) {
	const client = await pool.connect();
	try {
		await client.query('SET statement_timeout = 0');
		// Serialize schema upgrades across simultaneous application starts.
		await client.query('SELECT pg_advisory_lock(721884031)');
		await migrate(drizzle(client), {
			migrationsFolder: fileURLToPath(new URL('../drizzle/postgresql', import.meta.url))
		});
	} finally {
		try {
			await client.query('SELECT pg_advisory_unlock(721884031)');
			await client.query('SET statement_timeout = 15000');
		} finally {
			client.release();
		}
	}
}
