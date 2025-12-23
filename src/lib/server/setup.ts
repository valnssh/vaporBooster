import { steamManager } from '$lib/server/steam/manager';

console.log('Server starting...');
steamManager.init().catch(console.error);

const shutdown = async () => {
	console.log('Server stopping...');
	await steamManager.stopAll();
	process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
