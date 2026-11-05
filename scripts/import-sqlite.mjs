import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDatabasePool } from './postgres.mjs';
import { migrateDatabase } from './migrations.mjs';

const tables = {
	user: ['id', 'name', 'email', 'email_verified', 'image', 'created_at', 'updated_at'],
	account: [
		'id',
		'account_id',
		'provider_id',
		'user_id',
		'access_token',
		'refresh_token',
		'id_token',
		'access_token_expires_at',
		'refresh_token_expires_at',
		'scope',
		'password',
		'created_at',
		'updated_at'
	],
	session: [
		'id',
		'expires_at',
		'token',
		'created_at',
		'updated_at',
		'ip_address',
		'user_agent',
		'user_id'
	],
	verification: ['id', 'identifier', 'value', 'expires_at', 'created_at', 'updated_at'],
	steam_account: [
		'id',
		'account_name',
		'refresh_token',
		'iv',
		'auth_tag',
		'shared_secret',
		'custom_title',
		'persona_state',
		'auto_reply_message',
		'games',
		'boost_started_at',
		'status',
		'user_id',
		'created_at',
		'updated_at'
	],
	steam_chat_message: [
		'id',
		'account_id',
		'steam_id_other',
		'sender_name',
		'content',
		'direction',
		'timestamp'
	]
};
const quote = (name) => '"' + name + '"'; // Only static names from tables above.
const canonical = (row, columns) =>
	JSON.stringify(
		columns.map((key) => {
			const value = row[key];
			if (value instanceof Date) return value.toISOString();
			if (key === 'id' && typeof value === 'string' && /^-?\d+$/.test(value)) return value;
			return value;
		})
	) + '\n';

function convert(row, table) {
	for (const [key, value] of Object.entries(row)) {
		if (value === null) continue;
		if (key.endsWith('_at') || key === 'timestamp') {
			if (!Number.isSafeInteger(value)) throw new Error('Invalid SQLite timestamp');
			const date = new Date(value * (table === 'steam_chat_message' ? 1000 : 1));
			if (!Number.isFinite(date.getTime())) throw new Error('SQLite timestamp is out of range');
			row[key] = date;
		} else if (key === 'email_verified') {
			if (value !== 0 && value !== 1) throw new Error('Invalid SQLite boolean');
			row[key] = value === 1;
		} else if (key === 'games') {
			const games = JSON.parse(value);
			if (!Array.isArray(games) || games.some((id) => !Number.isSafeInteger(id)))
				throw new Error('Invalid SQLite game list');
			row[key] = games;
		} else if (table === 'steam_chat_message' && key === 'id') {
			if (!Number.isSafeInteger(value))
				throw new Error('SQLite message ID exceeds the supported range');
			row[key] = String(value);
		}
	}
	return row;
}

// Import is explicit, one-time and atomic. Neither the source nor existing target rows are overwritten.
export async function importSqlite(source, pool) {
	const sqlite = new DatabaseSync(resolve(source), { readOnly: true });
	let client;
	try {
		sqlite.exec('BEGIN');
		if (
			sqlite
				.prepare('PRAGMA integrity_check')
				.all()
				.some((row) => row.integrity_check !== 'ok')
		)
			throw new Error('SQLite integrity check failed');
		if (sqlite.prepare('PRAGMA foreign_key_check').all().length)
			throw new Error('SQLite has broken foreign keys');
		const names = sqlite
			.prepare("SELECT name FROM sqlite_master WHERE type='table'")
			.all()
			.map((row) => row.name);
		if (
			names.some(
				(name) =>
					!name.startsWith('sqlite_') &&
					name !== '__drizzle_migrations' &&
					!Object.hasOwn(tables, name)
			)
		)
			throw new Error('Unknown SQLite tables; refusing an incomplete import');
		for (const [table, columns] of Object.entries(tables)) {
			const existing = sqlite
				.prepare(`PRAGMA table_info(${quote(table)})`)
				.all()
				.map((row) => row.name);
			if (
				existing.length !== columns.length ||
				columns.some((column) => !existing.includes(column))
			)
				throw new Error('Unsupported SQLite schema; upgrade the old application first');
		}
		await migrateDatabase(pool);
		client = await pool.connect();
		await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
		await client.query('SET LOCAL statement_timeout = 0');
		await client.query('SELECT pg_advisory_xact_lock(721884031)');
		await client.query(
			`LOCK TABLE ${Object.keys(tables).map(quote).join(',')}, "_hoursbooster_sqlite_import" IN ACCESS EXCLUSIVE MODE`
		);
		if ((await client.query('SELECT 1 FROM "_hoursbooster_sqlite_import"')).rowCount)
			throw new Error('This database already received a SQLite import');
		for (const table of Object.keys(tables)) {
			if ((await client.query(`SELECT 1 FROM ${quote(table)} LIMIT 1`)).rowCount)
				throw new Error('Target PostgreSQL database is not empty');
		}
		const report = {};
		for (const [table, columns] of Object.entries(tables)) {
			const sourceHash = createHash('sha256');
			const targetHash = createHash('sha256');
			let count = 0;
			let batch = [];
			async function insertBatch() {
				if (!batch.length) return;
				const values = [];
				const placeholders = batch.map(
					(row) =>
						'(' +
						columns
							.map((key) => {
								values.push(
									key === 'games' && row[key] !== null ? JSON.stringify(row[key]) : row[key]
								);
								return '$' + values.length;
							})
							.join(',') +
						')'
				);
				await client.query(
					`INSERT INTO ${quote(table)} (${columns.map(quote).join(',')}) VALUES ${placeholders.join(',')}`,
					values
				);
				const reread = await client.query(
					`SELECT ${columns.map(quote).join(',')} FROM ${quote(table)} WHERE id = ANY($1)`,
					[batch.map((row) => row.id)]
				);
				const byId = new Map(reread.rows.map((row) => [String(row.id), row]));
				for (const row of batch) {
					const stored = byId.get(String(row.id));
					if (!stored) throw new Error('PostgreSQL verification lost a row');
					sourceHash.update(canonical(row, columns));
					targetHash.update(canonical(stored, columns));
				}
				count += batch.length;
				batch = [];
			}
			for (const row of sqlite
				.prepare(`SELECT ${columns.map(quote).join(',')} FROM ${quote(table)} ORDER BY id`)
				.iterate()) {
				batch.push(convert(row, table));
				if (batch.length === 500) await insertBatch();
			}
			await insertBatch();
			const checksum = sourceHash.digest('hex');
			if (
				checksum !== targetHash.digest('hex') ||
				Number((await client.query(`SELECT count(*) FROM ${quote(table)}`)).rows[0].count) !== count
			)
				throw new Error('PostgreSQL content verification failed');
			report[table] = { count, checksum };
		}
		const last =
			sqlite.prepare("SELECT seq FROM sqlite_sequence WHERE name='steam_chat_message'").get()
				?.seq ?? 0;
		if (!Number.isSafeInteger(last)) throw new Error('SQLite sequence exceeds the supported range');
		await client.query(
			`SELECT setval(pg_get_serial_sequence('steam_chat_message','id'), GREATEST($1::bigint, COALESCE(max(id),0), 1), GREATEST($1::bigint, COALESCE(max(id),0)) > 0) FROM steam_chat_message`,
			[last]
		);
		await client.query('INSERT INTO "_hoursbooster_sqlite_import" (id, report) VALUES (1, $1)', [
			JSON.stringify(report)
		]);
		await client.query('COMMIT');
		return report;
	} catch (error) {
		if (client) await client.query('ROLLBACK').catch(() => {});
		throw error;
	} finally {
		client?.release();
		sqlite.close();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const args = process.argv.slice(2);
	if (args.length !== 3 || args[0] !== '--source' || args[2] !== '--confirm-stopped') {
		console.error(
			'Usage: pnpm import:sqlite --source /private/backup.sqlite --confirm-stopped (stop both application instances and back up first)'
		);
		process.exitCode = 1;
	} else {
		let pool;
		try {
			pool = createDatabasePool(process.env);
			const report = await importSqlite(args[1], pool);
			console.log(
				'SQLite import committed and verified:',
				Object.fromEntries(Object.entries(report).map(([name, value]) => [name, value.count]))
			);
		} catch {
			console.error(
				'SQLite import refused or failed; no partial application rows committed. Check source schema/integrity, an empty target, PostgreSQL TLS and permissions. Keep the source backup.'
			);
			process.exitCode = 1;
		} finally {
			await pool?.end();
		}
	}
}
