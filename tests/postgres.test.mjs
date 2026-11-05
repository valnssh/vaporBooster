import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabasePool, databaseOptions } from '../scripts/postgres.mjs';
import { migrateDatabase } from '../scripts/migrations.mjs';
import { testDatabase } from './helpers/postgres.mjs';

test('fresh PostgreSQL initialization and repeated startup preserve chat content and identity sequence', async () => {
	const database = await testDatabase();
	const pool = createDatabasePool({
		DATABASE_URL: database.url,
		DATABASE_CA_FILE: database.caFile
	});
	try {
		await migrateDatabase(pool);
		await pool.query('INSERT INTO "user" (id,name,email) VALUES ($1,$2,$3)', [
			'fixture-owner',
			'Fixture',
			'fixture@example.invalid'
		]);
		await pool.query(
			'INSERT INTO steam_account (id,account_name,user_id,created_at,updated_at) VALUES ($1,$2,$3,now(),now())',
			['fixture-account', 'FixtureAccount', 'fixture-owner']
		);
		const original = (
			await pool.query(
				'INSERT INTO steam_chat_message (account_id,steam_id_other,content,timestamp) VALUES ($1,$2,$3,$4) RETURNING *',
				['fixture-account', '76561198000000001', 'Сообщение 👋', new Date(1700000000123)]
			)
		).rows[0];
		await Promise.all([migrateDatabase(pool), migrateDatabase(pool)]);
		assert.deepEqual((await pool.query('SELECT * FROM steam_chat_message')).rows, [original]);
		assert.equal(original.timestamp.getTime(), 1700000000123);
		const next = await pool.query(
			'INSERT INTO steam_chat_message (account_id,steam_id_other,content) VALUES ($1,$2,$3) RETURNING id',
			['fixture-account', '76561198000000001', 'Следующее сообщение']
		);
		assert.equal(BigInt(next.rows[0].id), BigInt(original.id) + 1n);
		assert.equal(
			(await pool.query('SELECT count(*) FROM _hoursbooster_import_audit')).rows[0].count,
			'0'
		);
	} finally {
		await pool.end();
		await database.cleanup();
	}
});

test('upgrade renames the previous import audit without losing its report or timestamp', async () => {
	const database = await testDatabase();
	const pool = createDatabasePool({
		DATABASE_URL: database.url,
		DATABASE_CA_FILE: database.caFile
	});
	const directory = await mkdtemp(join(tmpdir(), 'hb-schema-upgrade-'));
	try {
		await mkdir(join(directory, 'meta'));
		const journal = JSON.parse(
			await readFile(new URL('../drizzle/postgresql/meta/_journal.json', import.meta.url), 'utf8')
		);
		journal.entries = journal.entries.filter((entry) => entry.idx < 3);
		for (const entry of journal.entries) {
			await copyFile(
				new URL('../drizzle/postgresql/' + entry.tag + '.sql', import.meta.url),
				join(directory, entry.tag + '.sql')
			);
		}
		await writeFile(join(directory, 'meta/_journal.json'), JSON.stringify(journal));
		await migrate(drizzle(pool), { migrationsFolder: directory });
		const snapshot = JSON.parse(
			await readFile(
				new URL('../drizzle/postgresql/meta/0002_snapshot.json', import.meta.url),
				'utf8'
			)
		);
		const previous = Object.values(snapshot.tables).find(
			(table) => table.columns.report?.type === 'jsonb'
		).name;
		const report = { verified: true, messages: { count: 123, checksum: 'synthetic-checksum' } };
		const createdAt = new Date(1700000000123);
		await pool.query('INSERT INTO "' + previous + '" (id,report,created_at) VALUES ($1,$2,$3)', [
			1,
			report,
			createdAt
		]);
		await migrateDatabase(pool);
		await migrateDatabase(pool);
		assert.deepEqual((await pool.query('SELECT * FROM _hoursbooster_import_audit')).rows, [
			{ id: 1, report, created_at: createdAt }
		]);
		assert.equal(
			(await pool.query('SELECT to_regclass($1) AS old_table', [previous])).rows[0].old_table,
			null
		);
	} finally {
		await pool.end();
		await database.cleanup();
		await rm(directory, { recursive: true, force: true });
	}
});

test('PostgreSQL configuration rejects non-PostgreSQL URLs, TLS bypass URL options and disabled verification', () => {
	for (const DATABASE_URL of [
		undefined,
		'file:test.db',
		'postgresql://localhost/db?sslmode=disable'
	]) {
		assert.throws(() => databaseOptions({ DATABASE_URL }));
	}
	assert.throws(() =>
		databaseOptions({
			DATABASE_URL: 'postgresql://localhost/db',
			NODE_TLS_REJECT_UNAUTHORIZED: '0'
		})
	);
	assert.equal(
		databaseOptions({ DATABASE_URL: 'postgresql://localhost/db' }).ssl.rejectUnauthorized,
		true
	);
});

test('PostgreSQL driver rejects an untrusted certificate and a wrong TLS hostname', async () => {
	const database = await testDatabase();
	const options = databaseOptions({
		DATABASE_URL: database.url,
		DATABASE_CA_FILE: database.caFile
	});
	const unknownCa = new pg.Pool({ ...options, ssl: { rejectUnauthorized: true } });
	const wrongHost = new pg.Pool({
		...options,
		ssl: { ...options.ssl, servername: 'wrong.example.invalid' }
	});
	try {
		await assert.rejects(unknownCa.query('SELECT 1'), /certificate|self.signed|issuer/i);
		await assert.rejects(wrongHost.query('SELECT 1'), /hostname|altnames|certificate/i);
	} finally {
		await unknownCa.end();
		await wrongHost.end();
		await database.cleanup();
	}
});
