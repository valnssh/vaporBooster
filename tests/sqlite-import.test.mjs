import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabasePool, databaseOptions } from '../scripts/postgres.mjs';
import { migrateDatabase } from '../scripts/migrations.mjs';
import { importSqlite } from '../scripts/import-sqlite.mjs';
import { testDatabase } from './helpers/postgres.mjs';

async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), 'hb-import-'));
	const source = join(directory, 'legacy.db');
	const sqlite = new DatabaseSync(source);
	for (const name of [
		'0000_known_supernaut.sql',
		'0001_scope_steam_account_names.sql',
		'0002_steam_panel_identity.sql'
	]) {
		sqlite.exec(await readFile(new URL('../drizzle/sqlite/' + name, import.meta.url), 'utf8'));
	}
	sqlite.exec(`
		INSERT INTO user (id,name,email,email_verified,created_at,updated_at)
		VALUES ('alice','Алиса','alice@example.invalid',1,1700000000123,1700000000456), ('bob','Bob','bob@example.invalid',0,1,2);
		INSERT INTO account (id,account_id,provider_id,user_id,access_token,refresh_token,created_at,updated_at)
		VALUES ('identity','oidc-id','keycloak','alice','synthetic-oidc-token','synthetic-refresh-token',1,2);
		INSERT INTO session (id,expires_at,token,created_at,updated_at,user_id)
		VALUES ('session',2000000000123,'synthetic-session-token',1,2,'alice');
		INSERT INTO verification (id,identifier,value,expires_at,created_at,updated_at)
		VALUES ('verification','test-id','synthetic-verification',2000000000123,1,2);
		INSERT INTO steam_account (id,account_name,user_id,refresh_token,iv,auth_tag,shared_secret,games,created_at,updated_at)
		VALUES ('upper','LegacyName','alice','synthetic-cipher','synthetic-iv','synthetic-tag','synthetic-encrypted-seed','[730,570]',1,2),
		       ('lower','legacyname','alice',NULL,NULL,NULL,NULL,NULL,3,4),
		       ('local','LocalName',NULL,NULL,NULL,NULL,NULL,'[]',5,6);
	`);
	const insert = sqlite.prepare(
		'INSERT INTO steam_chat_message (account_id,steam_id_other,content,timestamp) VALUES (?,?,?,?)'
	);
	for (let i = 0; i < 1001; i++)
		insert.run('upper', '76561198000000001', `Сообщение ${i} 👋`, 1700000000 + i);
	sqlite.exec(
		"INSERT INTO steam_chat_message (id,account_id,steam_id_other,content) VALUES (100000,'upper','76561198000000001','deleted'); DELETE FROM steam_chat_message WHERE id=100000;"
	);
	sqlite.close();
	const database = await testDatabase();
	const pool = createDatabasePool({
		DATABASE_URL: database.url,
		DATABASE_CA_FILE: database.caFile
	});
	return {
		source,
		pool,
		async cleanup() {
			await pool.end();
			await database.cleanup();
			await rm(directory, { recursive: true, force: true });
		}
	};
}

test('SQLite import preserves every field, ownership, encryption, dates and deleted-ID sequence across batches', async () => {
	const f = await fixture();
	try {
		const before = await readFile(f.source);
		const report = await importSqlite(f.source, f.pool);
		assert.equal(report.steam_chat_message.count, 1001);
		assert.equal(report.steam_account.count, 3);
		assert.equal(report.account.count, 1);
		const alice = (await f.pool.query('SELECT * FROM "user" WHERE id=\'alice\'')).rows[0];
		assert.equal(alice.created_at.getTime(), 1700000000123);
		assert.equal(alice.email_verified, true);
		const chat = (await f.pool.query('SELECT * FROM steam_chat_message ORDER BY id LIMIT 1'))
			.rows[0];
		assert.equal(chat.timestamp.getTime(), 1700000000000);
		assert.equal(chat.content, 'Сообщение 0 👋');
		const account = (await f.pool.query("SELECT * FROM steam_account WHERE id='upper'")).rows[0];
		assert.deepEqual(account.games, [730, 570]);
		assert.equal(account.refresh_token, 'synthetic-cipher');
		assert.equal(account.shared_secret, 'synthetic-encrypted-seed');
		assert.equal(account.user_id, 'alice');
		assert.equal(
			(await f.pool.query('SELECT token FROM session')).rows[0].token,
			'synthetic-session-token'
		);
		await migrateDatabase(f.pool);
		await migrateDatabase(f.pool);
		assert.deepEqual(await readFile(f.source), before, 'The SQLite source must remain unchanged');
		await assert.rejects(importSqlite(f.source, f.pool), /already received/);
		const next = await f.pool.query(
			"INSERT INTO steam_chat_message (account_id,steam_id_other,content) VALUES ('upper','76561198000000001','new') RETURNING id"
		);
		assert.equal(next.rows[0].id, '100001');
		const add = (id, name, owner) =>
			f.pool.query(
				'INSERT INTO steam_account (id,account_name,user_id,created_at,updated_at) VALUES ($1,$2,$3,now(),now())',
				[id, name, owner]
			);
		await add('bob-shared', 'LegacyName', 'bob');
		await add('local-shared', 'LegacyName', null);
		await assert.rejects(add('owned-duplicate', 'LegacyName', 'alice'), /unique/);
		await assert.rejects(add('local-duplicate', 'LocalName', null), /unique/);
		await f.pool.query("DELETE FROM steam_account WHERE id='upper'");
		assert.equal(
			(await f.pool.query("SELECT count(*) FROM steam_chat_message WHERE account_id='upper'"))
				.rows[0].count,
			'0'
		);
	} finally {
		await f.cleanup();
	}
});

test('failed import rolls back earlier tables and can be retried after fixing a copy of the source', async () => {
	const f = await fixture();
	try {
		let sqlite = new DatabaseSync(f.source);
		sqlite.exec("UPDATE steam_account SET games='bad-json' WHERE id='upper'");
		sqlite.close();
		await assert.rejects(importSqlite(f.source, f.pool));
		assert.equal((await f.pool.query('SELECT count(*) FROM "user"')).rows[0].count, '0');
		assert.equal(
			(await f.pool.query('SELECT count(*) FROM "_hoursbooster_sqlite_import"')).rows[0].count,
			'0'
		);
		sqlite = new DatabaseSync(f.source);
		sqlite.exec("UPDATE steam_account SET games='[730]' WHERE id='upper'");
		sqlite.close();
		await importSqlite(f.source, f.pool);
	} finally {
		await f.cleanup();
	}
});

test('nonempty targets and unknown source tables are refused without deleting data', async () => {
	const f = await fixture();
	try {
		await migrateDatabase(f.pool);
		await f.pool.query(
			"INSERT INTO \"user\" (id,name,email) VALUES ('existing','Existing','existing@example.invalid')"
		);
		await assert.rejects(importSqlite(f.source, f.pool), /not empty/);
		assert.equal((await f.pool.query('SELECT count(*) FROM "user"')).rows[0].count, '1');
		const sqlite = new DatabaseSync(f.source);
		sqlite.exec('CREATE TABLE custom_data (id INTEGER)');
		sqlite.close();
		await assert.rejects(importSqlite(f.source, f.pool), /Unknown SQLite tables/);
	} finally {
		await f.cleanup();
	}
});

test('PostgreSQL configuration rejects SQLite, TLS bypass URL options and disabled verification', () => {
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

test('read-only SQLite import includes committed WAL records', async () => {
	const f = await fixture();
	const sqlite = new DatabaseSync(f.source);
	try {
		sqlite.exec(
			"PRAGMA journal_mode=WAL; INSERT INTO steam_chat_message (account_id,steam_id_other,content) VALUES ('upper','76561198000000001','committed-in-wal')"
		);
		const report = await importSqlite(f.source, f.pool);
		assert.equal(report.steam_chat_message.count, 1002);
		assert.equal(
			(
				await f.pool.query(
					"SELECT count(*) FROM steam_chat_message WHERE content='committed-in-wal'"
				)
			).rows[0].count,
			'1'
		);
	} finally {
		sqlite.close();
		await f.cleanup();
	}
});
