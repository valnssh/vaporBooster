import devtoolsJson from 'vite-plugin-devtools-json';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import adapter from '@deno/svelte-adapter';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';
import type { ViteDevServer, PreviewServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { isTlsAssetPath, readTlsOptions, validateHttpsEnvironment } from './scripts/https.mjs';

function protectTlsFiles(request: IncomingMessage, response: ServerResponse, next: () => void) {
	let pathname;
	try {
		pathname = new URL(request.url || '/', 'https://localhost').pathname;
	} catch {
		response.writeHead(400).end();
		return;
	}
	if (isTlsAssetPath(pathname)) {
		response.writeHead(404).end();
		return;
	}
	next();
}

export default defineConfig(async ({ command, mode }) => {
	const environment = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
	let https;
	const privatePaths: string[] = [];
	if (command === 'serve' && (environment.TLS_CERT_FILE || environment.TLS_KEY_FILE)) {
		validateHttpsEnvironment(environment);
		https = await readTlsOptions(environment);
		for (const file of [environment.TLS_CERT_FILE, environment.TLS_KEY_FILE]) {
			if (!file) continue;
			for (const path of [resolve(file), realpathSync(file)]) {
				privatePaths.push(path.replaceAll('\\', '/').replace(/[()[\]{}*?!+@]/g, '\\$&'));
			}
		}
	}
	return {
		plugins: [
			{
				name: 'https-only',
				configureServer(server: ViteDevServer) {
					validateHttpsEnvironment(environment);
					if (!server.config.server.https)
						throw new Error('TLS certificates are required for HTTPS');
					server.middlewares.use(protectTlsFiles);
				},
				configurePreviewServer(server: PreviewServer) {
					validateHttpsEnvironment(environment);
					if (!server.config.preview.https)
						throw new Error('TLS certificates are required for HTTPS');
					server.middlewares.use(protectTlsFiles);
				}
			},
			tailwindcss(),
			sveltekit({
				adapter: adapter(),
				preprocess: vitePreprocess()
			}),
			devtoolsJson()
		],
		server: {
			https,
			fs: {
				deny: [
					'.env',
					'.env.*',
					'**/.git/**',
					'**/.private/**',
					'**/certs/**',
					'**/*.{crt,pem,key,p12,pfx}',
					...privatePaths
				]
			}
		},
		preview: { https }
	};
});
