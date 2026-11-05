// Migrate the runtime database, never a database baked into an image.
import { resolve } from 'node:path';
import { httpsHandler, readTlsOptions, validateHttpsEnvironment } from './https.mjs';

const environment = Deno.env.toObject();
const origin = validateHttpsEnvironment(environment);
const tls = await readTlsOptions(environment);
await import('./migrate.mjs');
const { prepareServer } = await import('../.deno-deploy/handler.ts');
const deploy = JSON.parse(
	await Deno.readTextFile(new URL('../.deno-deploy/deploy.json', import.meta.url))
);
const svelte = JSON.parse(
	await Deno.readTextFile(new URL('../.deno-deploy/svelte.json', import.meta.url))
);
// The adapter parses /:file* placeholders; Windows path.join would turn them into \:file*.
// Absolute forward-slash paths prevent its parser from losing the placeholder.
for (const route of deploy.staticFiles ?? []) {
	route.destination = resolve(route.destination.replaceAll('\\', '/')).replaceAll('\\', '/');
}
const handler = prepareServer(svelte, deploy, Deno.cwd());
Deno.serve(
	{
		hostname: Deno.env.get('HOST') || '127.0.0.1',
		port: Number(Deno.env.get('PORT') || 8443),
		...tls
	},
	httpsHandler(handler, origin)
);
