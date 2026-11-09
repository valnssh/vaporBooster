import { readFile, realpath } from 'node:fs/promises';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** @param {string} pathname */
export function isTlsAssetPath(pathname) {
	try {
		pathname = decodeURIComponent(pathname).replaceAll('\\', '/');
	} catch {
		return true;
	}
	return /(?:^|\/)(?:certs|\.private)(?:\/|$)|\.(?:crt|pem|key|p12|pfx)(?:\/|$)/i.test(pathname);
}

/** @param {string | undefined} value @param {string} name */
export function httpsOrigin(value, name) {
	let url;
	try {
		if (typeof value !== 'string' || !value) throw new Error('Missing origin');
		url = new URL(value);
	} catch {
		throw new Error(`${name} must be an explicit HTTPS origin`);
	}
	if (
		url.protocol !== 'https:' ||
		url.username ||
		url.password ||
		url.pathname !== '/' ||
		url.search ||
		url.hash
	) {
		throw new Error(`${name} must be an HTTPS origin without credentials, path, query or fragment`);
	}
	return url.origin;
}

/** @param {Record<string, string | undefined>} env */
export function validateHttpsEnvironment(env) {
	const origin = httpsOrigin(env.ORIGIN, 'ORIGIN');
	if (httpsOrigin(env.BETTER_AUTH_URL, 'BETTER_AUTH_URL') !== origin) {
		throw new Error('ORIGIN and BETTER_AUTH_URL must have the same HTTPS origin');
	}
	if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
		throw new Error('TLS certificate verification must remain enabled');
	}
	return origin;
}

/** @param {Record<string, string | undefined>} env */
export async function readTlsOptions(env) {
	if (!env.TLS_CERT_FILE || !env.TLS_KEY_FILE) {
		throw new Error('TLS_CERT_FILE and TLS_KEY_FILE are required; HTTP is disabled');
	}
	const files = [resolve(env.TLS_CERT_FILE), resolve(env.TLS_KEY_FILE)];
	const actualFiles = await Promise.all(files.map((file) => realpath(file)));
	const publicRoots = ['static', 'public', '.deno-deploy/static', '.svelte-kit/output/client'];
	for (const directory of publicRoots) {
		const root = resolve(directory);
		const actualRoot = await realpath(root).catch(() => root);
		for (const file of [...files, ...actualFiles]) {
			for (const publicRoot of [root, actualRoot]) {
				const child = relative(publicRoot, file);
				if (!child || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child))) {
					throw new Error('TLS credentials must be outside public asset directories');
				}
			}
		}
	}
	const [cert, key] = await Promise.all([
		readFile(actualFiles[0], 'utf8'),
		readFile(actualFiles[1], 'utf8')
	]);
	// Parse the chain and matching private key before migrations or account startup.
	const blocks = cert.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
	if (!blocks?.length) throw new Error('Invalid TLS certificate chain');
	const chain = blocks.map((block) => new X509Certificate(block));
	if (!chain[0].checkPrivateKey(createPrivateKey(key))) {
		throw new Error('TLS certificate and private key do not match');
	}
	return { cert, key };
}

/**
 * @param {(request: Request, info: any) => Response | Promise<Response>} handler
 * @param {string} origin
 * @returns {(request: Request, info: any) => Promise<Response>}
 */
export function httpsHandler(handler, origin) {
	return async (request, info) => {
		const url = new URL(request.url);
		let response;
		if (url.protocol !== 'https:') {
			response = new Response('HTTPS is required', { status: 400 });
		} else if (url.origin !== origin) {
			response = new Response('Unexpected request origin', { status: 421 });
		} else if (isTlsAssetPath(url.pathname)) {
			response = new Response('Not found', { status: 404 });
		} else {
			try {
				response = await handler(request, info);
			} catch (failure) {
				const missing = failure instanceof Error && failure.name === 'NotFound';
				response = new Response(missing ? 'Not found' : 'Internal server error', {
					status: missing ? 404 : 500
				});
			}
		}
		response.headers.set('Strict-Transport-Security', 'max-age=31536000');
		response.headers.set('X-Content-Type-Options', 'nosniff');
		response.headers.set('Referrer-Policy', 'no-referrer');
		return response;
	};
}
