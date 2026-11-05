import { configureTestDatabase } from './helpers/postgres.mjs';
const testDb = await configureTestDatabase();
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { Agent, request as httpsRequest, createServer as createHttpsServer } from 'node:https';
import { promisify } from 'node:util';
import { createTlsFixture } from './helpers/tls-fixture.mjs';

const kitRequire = createRequire(import.meta.resolve('@sveltejs/kit'));
const { parse } = await import(pathToFileURL(kitRequire.resolve('devalue')));

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await readFile(join(root, '.deno-deploy', 'deploy.json'));
await assert.rejects(readFile(join(root, '.deno-deploy', 'server.ts')), { code: 'ENOENT' });
const scratch = await mkdtemp(join(tmpdir(), 'hoursbooster-runtime-'));
const tls = await createTlsFixture();
const agent = new Agent({ ca: tls.cert, keepAlive: false });
const portable = (value) => value.replaceAll('\\', '/');
const canary = `private-runtime-canary-${randomUUID()}`;
await writeFile(join(scratch, 'private-canary.txt'), canary);
await mkdir(join(scratch, 'cache'));

async function unusedPort() {
	const listener = createServer();
	await new Promise((done, fail) => {
		listener.once('error', fail);
		listener.listen(0, '127.0.0.1', done);
	});
	const port = listener.address().port;
	await new Promise((done, fail) => listener.close((error) => (error ? fail(error) : done())));
	return port;
}

const port = await unusedPort();
const base = `https://127.0.0.1:${port}/`;
const origin = new URL(base).origin;
function launch(overrides = {}) {
	const child = spawn(
		process.env.DENO_BINARY || 'deno',
		[
			'run',
			'--cached-only',
			'--no-prompt',
			'--allow-env',
			'--allow-net',
			'--allow-sys',
			`--allow-read=${portable(root)},${portable(scratch)},${portable(tls.directory)},${portable(testDb.caFile)}`,
			`--allow-write=${portable(scratch)}`,
			`--allow-ffi=${portable(join(root, 'node_modules'))}`,
			'scripts/start.ts'
		],
		{
			cwd: root,
			windowsHide: true,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: {
				...process.env,
				HOST: '127.0.0.1',
				PORT: String(port),
				DATABASE_URL: testDb.url,
				DATABASE_CA_FILE: testDb.caFile,
				DENO_DIR: join(scratch, 'cache'),
				BETTER_AUTH_SECRET: `synthetic-runtime-test-only-${randomUUID()}`,
				BETTER_AUTH_URL: origin,
				ORIGIN: origin,
				TLS_CERT_FILE: tls.certFile,
				TLS_KEY_FILE: tls.keyFile,
				BETTER_AUTH_TELEMETRY: '0',
				ALLOW_ANONYMOUS: 'true',
				STEAM_LOGIN_ENABLED: 'false',
				OIDC_PROVIDER_NAME: '',
				OIDC_PROVIDER_ID: '',
				OIDC_CLIENT_ID: '',
				OIDC_CLIENT_SECRET: '',
				OIDC_DISCOVERY_URL: '',
				...overrides
			}
		}
	);
	let output = '';
	let launchError;
	child.stdout.on('data', (data) => (output += data));
	child.stderr.on('data', (data) => (output += data));
	child.on('error', (failure) => (launchError = failure));
	const closed = new Promise((done) => child.once('close', done));
	return {
		child,
		closed,

		get output() {
			return output;
		},
		get launchError() {
			return launchError;
		}
	};
}

function request(
	url,
	{
		method = 'GET',
		headers,
		body,
		agent: requestAgent = agent,
		servername = 'localhost',
		timeout = 15_000
	} = {}
) {
	return new Promise((done, fail) => {
		const req = httpsRequest(url, { method, headers, agent: requestAgent, servername }, (res) => {
			const chunks = [];
			res.on('error', fail);
			res.on('data', (chunk) => chunks.push(chunk));
			res.on('end', () => {
				const text = Buffer.concat(chunks).toString('utf8');
				const responseHeaders = new Headers();
				for (let index = 0; index < res.rawHeaders.length; index += 2) {
					responseHeaders.append(res.rawHeaders[index], res.rawHeaders[index + 1]);
				}
				done({
					status: res.statusCode,
					headers: responseHeaders,
					text: async () => text,
					json: async () => JSON.parse(text)
				});
			});
		});
		req.on('error', fail);
		req.setTimeout(timeout, () => req.destroy(new Error('Test HTTPS request timed out')));
		req.end(body instanceof URLSearchParams ? body.toString() : body);
	});
}

async function rejectedStartup(overrides, name, beforeMigration = false) {
	const running = launch(overrides);
	let timer;
	try {
		const exit = await Promise.race([
			running.closed,
			new Promise((done) => (timer = setTimeout(() => done('timeout'), 15_000)))
		]);
		if (running.launchError) throw running.launchError;
		assert.notEqual(exit, 'timeout', `Invalid ${name} configuration did not stop startup`);
		assert.notEqual(exit, 0, `Invalid ${name} configuration was accepted`);
		assert.doesNotMatch(running.output, /Listening on /);
	} finally {
		clearTimeout(timer);
		if (running.child.exitCode === null) running.child.kill();
		await running.closed;
	}
}

const pause = (ms) => new Promise((done) => setTimeout(done, ms));
let running;
let oidcStub;

try {
	await rejectedStartup({ TLS_CERT_FILE: '' }, 'missing-certificate', true);
	await rejectedStartup({ TLS_KEY_FILE: '' }, 'missing-key', true);
	const malformed = join(tls.directory, 'malformed.pem');
	await writeFile(malformed, 'synthetic invalid certificate\n');
	await rejectedStartup({ TLS_CERT_FILE: malformed }, 'malformed-certificate', true);
	await rejectedStartup({ TLS_KEY_FILE: malformed }, 'malformed-key', true);
	const otherTls = await createTlsFixture();
	try {
		const otherKey = join(tls.directory, 'mismatched-key.pem');
		await writeFile(otherKey, otherTls.key);
		await rejectedStartup({ TLS_KEY_FILE: otherKey }, 'mismatched-key', true);
	} finally {
		await otherTls.cleanup();
	}
	for (const [name, overrides] of [
		['missing-auth-url', { BETTER_AUTH_URL: '' }],
		['missing-origin', { ORIGIN: '' }],
		['http-auth-url', { BETTER_AUTH_URL: `http://127.0.0.1:${port}` }],
		['http-origin', { ORIGIN: `http://127.0.0.1:${port}` }],
		['different-origin', { ORIGIN: 'https://hours.example.com' }],
		['credentialed-origin', { ORIGIN: `https://name:password@127.0.0.1:${port}` }],
		['path-origin', { ORIGIN: `${origin}/unexpected` }]
	])
		await rejectedStartup(overrides, name);
	console.log('PASS: invalid TLS credentials and insecure/mismatched origins refuse startup');

	running = launch();
	for (let attempt = 0; attempt < 200; attempt++) {
		if (running.launchError) throw running.launchError;
		if (running.child.exitCode !== null)
			throw new Error(`Deno exited before readiness:\n${running.output}`);
		if (running.output.includes(`Listening on ${base}`)) break;
		await pause(100);
	}
	assert.ok(
		running.output.includes(`Listening on ${base}`),
		`No HTTPS listening address from Deno:\n${running.output}`
	);
	const get = (url, options) => request(url, options);
	const page = await get(base);
	assert.equal(page.status, 200);
	assert.match(page.headers.get('content-type'), /text\/html/);
	assert.match(page.headers.get('cache-control'), /no-store/);
	assert.match(page.headers.get('strict-transport-security'), /^max-age=[1-9]\d*/);
	const html = await page.text();
	assert.match(html, /Welcome back/);
	assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com|steamdb\.info/);
	console.log('PASS: verified HTTPS production page, HSTS and private no-store response');

	await assert.rejects(request(base, { agent: false }), /self.signed|certificate/i);
	await assert.rejects(
		request(base, { servername: 'wrong.example.invalid' }),
		/hostname|altnames|certificate/i
	);
	await new Promise((done, fail) => {
		const req = httpRequest(base.replace('https:', 'http:'), (response) => {
			const chunks = [];
			response.on('data', (chunk) => chunks.push(chunk));
			response.on('error', fail);
			response.on('end', () => {
				try {
					assert.equal(response.statusCode, 400);
					assert.doesNotMatch(Buffer.concat(chunks).toString(), /Welcome back/);
					done();
				} catch (failure) {
					fail(failure);
				}
			});
		});
		req.on('error', (failure) => {
			const tlsAlert =
				failure.code === 'HPE_INVALID_CONSTANT' &&
				Buffer.isBuffer(failure.rawPacket) &&
				failure.rawPacket.length >= 5 &&
				failure.rawPacket[0] === 0x15 &&
				failure.rawPacket[1] === 0x03;
			if (failure.code === 'ECONNRESET' || tlsAlert) done();
			else fail(failure);
		});
		req.setTimeout(5000, () => req.destroy(new Error('Plain HTTP test timed out')));
		req.end();
	});
	console.log(
		'PASS: untrusted/wrong-host certificates and plaintext HTTP cannot access the application'
	);

	const { stdout } = await promisify(execFile)(
		process.env.DENO_BINARY || 'deno',
		[
			'run',
			'--cached-only',
			'--no-prompt',
			'--allow-env',
			'--allow-net',
			'--allow-sys',
			`--allow-read=${portable(root)},${portable(tls.directory)}`,
			`--allow-write=${portable(scratch)}`,
			'tests/helpers/wss-probe.mjs',
			base.replace('https:', 'wss:'),
			tls.certFile
		],
		{
			cwd: root,
			env: { ...process.env, DENO_DIR: join(scratch, 'cache') },
			windowsHide: true,
			timeout: 35_000
		}
	);
	const [unknownCa, wrongName, trusted] = JSON.parse(stdout);
	assert.equal(unknownCa.status, null);
	assert.notEqual(unknownCa.code, 'PROBE_TIMEOUT');
	assert.match(unknownCa.message, /certificate|cert|issuer|self.signed/i);
	assert.equal(wrongName.status, null);
	assert.notEqual(wrongName.code, 'PROBE_TIMEOUT');
	assert.match(wrongName.message, /hostname|name|valid for|subject.?alt/i);
	assert.equal(trusted.status, 200);
	console.log(
		'PASS: Deno websocket13 rejects unknown CA/wrong hostname; trusted TLS reaches HTTP 200'
	);

	const forwarded = await get(base, {
		headers: { 'X-Forwarded-Proto': 'http', 'X-Forwarded-Host': 'untrusted.invalid' }
	});
	assert.equal(forwarded.status, 200);
	const wrongHost = await get(base, {
		headers: {
			Host: 'untrusted.invalid',
			'X-Forwarded-Proto': 'https',
			'X-Forwarded-Host': new URL(base).host
		}
	});
	assert.ok(wrongHost.status >= 400 && wrongHost.status < 500);
	const crossOrigin = await request(`${origin}/?/startQrLogin`, {
		method: 'POST',
		headers: {
			Origin: 'https://untrusted.invalid',
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: ''
	});
	assert.equal(crossOrigin.status, 403);
	const signedOut = await request(`${origin}/api/auth/sign-out`, {
		method: 'POST',
		headers: { Origin: origin, 'Content-Type': 'application/json' },
		body: '{}'
	});
	assert.equal(signedOut.status, 200);
	const cookies = signedOut.headers.getSetCookie();
	assert.ok(cookies.length > 0, 'Auth handler did not emit cookies');
	for (const cookie of cookies) {
		assert.match(cookie, /^__Secure-/);
		assert.match(cookie, /; Secure(?:;|$)/i);
		assert.match(cookie, /; HttpOnly(?:;|$)/i);
		assert.match(cookie, /; SameSite=Lax(?:;|$)/i);
	}
	console.log('PASS: canonical host, origin checks and Secure/HttpOnly/SameSite auth cookies');

	const queue = [];
	const visited = new Set();
	function enqueue(candidate, parent) {
		const url = new URL(candidate, parent);
		if (url.origin !== origin || !url.pathname.startsWith('/_app/immutable/')) return;
		if (!/\.(?:js|css)$/.test(url.pathname)) return;
		if (!visited.has(url.href)) queue.push(url.href);
	}
	for (const match of html.matchAll(/(?:href|src)=["']([^"']+)["']|import\(\s*["']([^"']+)["']/g)) {
		enqueue(match[1] || match[2], base);
	}
	let cssCount = 0;
	let jsCount = 0;
	while (queue.length) {
		const url = queue.shift();
		if (visited.has(url)) continue;
		visited.add(url);
		assert.ok(visited.size < 500, 'Unexpectedly large static import graph');
		const asset = await get(url);
		assert.equal(asset.status, 200, `Missing asset: ${new URL(url).pathname}`);
		assert.match(asset.headers.get('strict-transport-security'), /^max-age=[1-9]\d*/);
		const body = await asset.text();
		assert.ok(body.length > 0, `Empty asset: ${url}`);
		if (new URL(url).pathname.endsWith('.css')) {
			assert.match(asset.headers.get('content-type'), /^text\/css\b/);
			cssCount++;
		} else {
			assert.match(asset.headers.get('content-type'), /^(?:text|application)\/javascript\b/);
			jsCount++;
			for (const match of body.matchAll(
				/(["'])(\.{0,2}\/[^"'\\\s]+?\.(?:js|css)(?:\?[^"'\\\s]*)?)\1/g
			)) {
				enqueue(match[2], url);
			}
		}
	}
	assert.ok(cssCount > 0, 'No linked stylesheets were checked');
	assert.ok(jsCount > 1, 'No client entry modules were checked');
	console.log(
		`PASS: ${cssCount} stylesheet(s) and ${jsCount} JavaScript module(s), including imports`
	);
	const favicon = await get(new URL('/favicon.svg', base));
	assert.equal(favicon.status, 200);
	assert.match(favicon.headers.get('strict-transport-security'), /^max-age=[1-9]\d*/);
	assert.match(favicon.headers.get('content-type'), /^image\/svg\+xml\b/);
	assert.match(await favicon.text(), /<svg/);
	console.log('PASS: favicon content and MIME type');

	for (const pathname of [
		'/_app/immutable/not-present-runtime-test.js',
		'/_app/immutable/../../package.json',
		'/_app/immutable/%2e%2e%2fpackage.json',
		'/_app/immutable/..%5c..%5cpackage.json',
		'/_app/immutable/%252e%252e%252fpackage.json',
		'/scripts/start.ts',
		'/.env',
		'/certs/localhost-key.pem',
		'/tls/localhost-key.pem',
		'/localhost-key.pem',
		`/_app/immutable/%2e%2e%2f${portable(tls.keyFile)}`,
		`/_app/immutable/..%5c..%5c${encodeURIComponent(tls.keyFile)}`
	]) {
		const response = await get(new URL(pathname, base));
		const body = await response.text();
		assert.notEqual(response.status, 200, `Expected rejection for ${pathname}`);
		assert.match(response.headers.get('strict-transport-security'), /^max-age=[1-9]\d*/);
		assert.equal(body.includes(canary), false);
		assert.equal(body.includes('"packageManager"'), false);
		assert.equal(body.includes('BETTER_AUTH_SECRET='), false);
		assert.equal(body.includes('-----BEGIN PRIVATE KEY-----'), false);
		assert.equal(body.includes(tls.key.toString()), false);
	}
	console.log('PASS: missing assets, traversal variants and private source paths are not served');

	if (process.env.LIVE_STEAM === '1') {
		async function action(name, fields = {}) {
			const response = await request(`${origin}/?/${name}`, {
				method: 'POST',
				headers: {
					Origin: origin,
					Accept: 'application/json',
					'x-sveltekit-action': 'true',
					'Content-Type': 'application/x-www-form-urlencoded'
				},
				body: new URLSearchParams(fields),
				timeout: 45_000
			});
			const result = await response.json();
			return {
				...result,
				http: response.status,
				data: result.data ? parse(result.data) : undefined
			};
		}
		const started = await action('startQrLogin');
		assert.equal(started.type, 'success', `QR start failed with status ${started.http}`);
		assert.equal(new URL(started.data.qrUrl).hostname, 's.team');
		try {
			const pending = await action('pollQrLogin', { sessionId: started.data.sessionId });
			assert.equal(pending.data.pending, true);
		} finally {
			const cancelled = await action('cancelQrLogin', { sessionId: started.data.sessionId });
			assert.equal(cancelled.data.success, true);
			const after = await action('pollQrLogin', { sessionId: started.data.sessionId });
			assert.equal(after.http, 404);
		}
		console.log('PASS: live Steam QR challenge, pending poll and cancellation; challenge omitted');
	}

	// Exercise real Deno TLS discovery and the production BetterAuth route, not an adapter mock.
	if (running.child.exitCode === null) running.child.kill();
	await running.closed;
	const identityPort = await unusedPort();
	const issuer = `https://127.0.0.1:${identityPort}/realms/synthetic`;
	let discoveries = 0;
	let identityReady = false;
	const oidcKey = join(tls.directory, 'oidc-key.pem');
	const oidcCsr = join(tls.directory, 'oidc.csr');
	const oidcCert = join(tls.directory, 'oidc-cert.pem');
	const oidcExtensions = join(tls.directory, 'oidc.ext');
	await writeFile(
		oidcExtensions,
		'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n'
	);
	await promisify(execFile)(
		process.env.OPENSSL_BINARY || 'openssl',
		[
			'req',
			'-new',
			'-newkey',
			'rsa:2048',
			'-nodes',
			'-keyout',
			oidcKey,
			'-out',
			oidcCsr,
			'-subj',
			'/CN=localhost'
		],
		{ windowsHide: true }
	);
	await promisify(execFile)(
		process.env.OPENSSL_BINARY || 'openssl',
		[
			'x509',
			'-req',
			'-in',
			oidcCsr,
			'-CA',
			tls.certFile,
			'-CAkey',
			tls.keyFile,
			'-set_serial',
			'2',
			'-days',
			'2',
			'-extfile',
			oidcExtensions,
			'-out',
			oidcCert
		],
		{ windowsHide: true }
	);
	oidcStub = createHttpsServer(
		{ key: await readFile(oidcKey), cert: await readFile(oidcCert) },
		(req, res) => {
			if (req.url !== '/realms/synthetic/.well-known/openid-configuration') {
				res.writeHead(404).end();
				return;
			}
			discoveries++;
			if (!identityReady) {
				res
					.writeHead(503, { 'Content-Type': 'application/json' })
					.end(JSON.stringify({ error: 'synthetic-startup-pending' }));
				return;
			}
			res.writeHead(200, { 'Content-Type': 'application/json' }).end(
				JSON.stringify({
					issuer,
					authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
					token_endpoint: `${issuer}/protocol/openid-connect/token`,
					userinfo_endpoint: `${issuer}/protocol/openid-connect/userinfo`,
					jwks_uri: `${issuer}/protocol/openid-connect/certs`,
					id_token_signing_alg_values_supported: ['RS256']
				})
			);
		}
	);
	await new Promise((done, fail) => {
		oidcStub.once('error', fail);
		oidcStub.listen(identityPort, '127.0.0.1', done);
	});
	running = launch(
		{
			ALLOW_ANONYMOUS: 'false',
			OIDC_PROVIDER_ID: 'synthetic',
			OIDC_PROVIDER_NAME: 'Synthetic OIDC',
			OIDC_CLIENT_ID: 'synthetic-client',
			OIDC_CLIENT_SECRET: 'synthetic-client-secret',
			OIDC_DISCOVERY_URL: `${issuer}/.well-known/openid-configuration`,
			DENO_CERT: tls.certFile,
			NODE_EXTRA_CA_CERTS: tls.certFile
		},
		'oidc.db'
	);
	for (let attempt = 0; attempt < 200; attempt++) {
		if (running.launchError) throw running.launchError;
		if (running.child.exitCode !== null) throw new Error(`OIDC Deno exited:\n${running.output}`);
		if (running.output.includes(`Listening on ${base}`)) break;
		await pause(100);
	}
	assert.ok(running.output.includes(`Listening on ${base}`), running.output);
	const login = await request(`${origin}/login`);
	assert.match(await login.text(), /Synthetic OIDC/);
	assert.ok(discoveries > 0, 'Startup did not attempt HTTPS OIDC discovery');
	identityReady = true;
	const oidcStart = await request(`${origin}/api/auth/sign-in/social`, {
		method: 'POST',
		headers: { Origin: origin, 'Content-Type': 'application/json' },
		body: JSON.stringify({ provider: 'synthetic', callbackURL: `${origin}/` })
	});
	assert.equal(
		oidcStart.status,
		200,
		`OIDC initiation failed (${discoveries} discoveries): ${await oidcStart.text()}`
	);
	const authorization = new URL((await oidcStart.json()).url);
	assert.equal(authorization.origin, new URL(issuer).origin);
	assert.equal(authorization.pathname, '/realms/synthetic/protocol/openid-connect/auth');
	assert.equal(
		authorization.searchParams.get('redirect_uri'),
		`${origin}/api/auth/callback/synthetic`
	);
	assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
	assert.ok(authorization.searchParams.get('state'));
	assert.ok(authorization.searchParams.get('nonce'));
	assert.ok(discoveries > 0, 'OIDC discovery never reached the verified HTTPS provider');
	console.log(
		'PASS: real Deno HTTPS OIDC discovery and sign-in route produce PKCE/nonce authorization'
	);
} finally {
	// Only this test's child is stopped. No existing user service is queried or stopped.
	if (running) {
		if (running.child.exitCode === null) running.child.kill();
		await running.closed;
	}
	if (oidcStub) {
		oidcStub.closeAllConnections();
		await new Promise((done) => oidcStub.close(done));
	}
	await testDb.cleanup();
	agent.destroy();
	await tls.cleanup();
	await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
