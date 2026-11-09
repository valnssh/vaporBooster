import { steamManager } from '#lib/server/steam/manager.ts';
import { clearQrSessions } from './steam/session_store';
import { validateConfig } from './config';
import { building } from '$app/env';
import { pool } from '#lib/database.ts';

export const ready = building
	? Promise.resolve()
	: (async () => {
			validateConfig();
			await steamManager.init();
		})();
ready.catch(() =>
	console.error('Server initialization failed. Check authentication configuration and database.')
);

const shutdown = async () => {
	console.log('Server stopping...');
	clearQrSessions();
	await steamManager.stopAll();
	await pool.end();
	process.exit(0);
};

if (!building) {
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);
}
