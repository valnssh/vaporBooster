import { readFileSync } from 'node:fs';
import pg from 'pg';

// One pool per process; TLS verification is mandatory, including on a LAN.
/** @param {Record<string, string | undefined>} environment @returns {import('pg').PoolConfig} */
export function databaseOptions(environment, building = false) {
	if (building) return { max: 5 };
	let url;
	try {
		url = new URL(environment.DATABASE_URL || '');
	} catch {
		throw new Error('Set DATABASE_URL to a PostgreSQL connection URL');
	}
	if (
		!['postgres:', 'postgresql:'].includes(url.protocol) ||
		!url.hostname ||
		!url.pathname.slice(1) ||
		url.search ||
		url.hash
	) {
		throw new Error(
			'DATABASE_URL must be a PostgreSQL URL without query parameters or fragment; use DATABASE_CA_FILE for a private CA'
		);
	}
	if (environment.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
		throw new Error('TLS certificate verification must not be disabled');
	}
	return {
		connectionString: url.href,
		max: 5,
		connectionTimeoutMillis: 5000,
		idleTimeoutMillis: 30000,
		statement_timeout: 15000,
		application_name: 'hoursbooster',
		ssl: {
			rejectUnauthorized: true,
			minVersion: 'TLSv1.2',
			...(environment.DATABASE_CA_FILE
				? { ca: readFileSync(environment.DATABASE_CA_FILE, 'utf8') }
				: {})
		}
	};
}

/** @param {Record<string, string | undefined>} environment */
export function createDatabasePool(environment, building = false) {
	const pool = new pg.Pool(databaseOptions(environment, building));
	// Driver errors can contain SQL values. Never log their payload.
	pool.on('error', () => console.error('PostgreSQL idle connection failed'));
	return pool;
}
