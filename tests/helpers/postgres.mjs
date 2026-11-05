import { randomUUID } from 'node:crypto';
import { createDatabasePool } from '../../scripts/postgres.mjs';

// Tests may create/drop databases only on an explicitly designated test instance.
export async function testDatabase() {
	const url = new URL(process.env.TEST_DATABASE_URL || 'postgresql://invalid.invalid/missing');
	if (url.pathname !== '/hoursbooster_test')
		throw new Error('Set TEST_DATABASE_URL to the isolated hoursbooster_test database');
	const admin = createDatabasePool({
		DATABASE_URL: url.href,
		DATABASE_CA_FILE: process.env.TEST_DATABASE_CA_FILE
	});
	const name = 'hb_test_' + randomUUID().replaceAll('-', '');
	await admin.query(`CREATE DATABASE "${name}"`);
	url.pathname = '/' + name;
	return {
		url: url.href,
		caFile: process.env.TEST_DATABASE_CA_FILE,
		async cleanup() {
			try {
				await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
			} finally {
				await admin.end();
			}
		}
	};
}

export async function configureTestDatabase() {
	const database = await testDatabase();
	process.env.DATABASE_URL = database.url;
	process.env.DATABASE_CA_FILE = database.caFile || '';
	return database;
}
