import { configureTestDatabase } from './helpers/postgres.mjs';
const testDb = await configureTestDatabase();
import assert from 'node:assert/strict';
import { test, mock, beforeEach, after } from 'node:test';
import { registerHooks, createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCipheriv } from 'node:crypto';
import { createTlsFixture } from './helpers/tls-fixture.mjs';
import { privateEnvModule } from './helpers/private-env.mjs';

const root = new URL('../', import.meta.url);
const scratchRoot = realpathSync(process.env.SECURITY_TEST_DIR || tmpdir());
const scratch = mkdtempSync(join(scratchRoot, 'vaporbooster-security-'));
process.env.BETTER_AUTH_SECRET = 'test-only-master-secret-0123456789abcdefghijk';
process.env.BETTER_AUTH_URL = 'https://localhost:8443';
process.env.ORIGIN = 'https://localhost:8443';
process.env.ALLOW_ANONYMOUS = 'true';

registerHooks({
	resolve(specifier, context, next) {
		if (specifier === '$app/env')
			return { url: 'data:text/javascript,export const building=false;', shortCircuit: true };
		if (specifier === '$app/env/private') {
			return privateEnvModule();
		}
		if (specifier.startsWith('#lib/'))
			specifier = new URL(`src/lib/${specifier.slice(5)}`, root).href;
		try {
			return next(specifier, context);
		} catch (failure) {
			if (specifier.startsWith('.') || specifier.startsWith('file:')) {
				const url = new URL(specifier, context.parentURL);
				if (!/\.[a-z]+$/i.test(url.pathname)) {
					url.pathname += '.ts';
					return next(url.href, context);
				}
			}
			throw failure;
		}
	}
});

class FakeSession extends EventEmitter {
	static instances = [];
	static start = async () => ({ qrChallengeUrl: 'https://s.team/q/test-only' });
	constructor(platform, options) {
		super();
		const destroy = options.agent.destroy.bind(options.agent);
		options.agent.destroy = () => {
			this.agentDestroyed = true;
			destroy();
		};
		FakeSession.instances.push(this);
	}
	startWithQR() {
		return FakeSession.start(this);
	}
	cancelLoginAttempt() {
		this.cancelled = true;
		return true;
	}
}
mock.module('steam-session', {
	namedExports: { LoginSession: FakeSession, EAuthTokenPlatformType: { SteamClient: 1 } }
});
const calls = [];
mock.module(new URL('src/lib/server/steam/manager.ts', root).href, {
	namedExports: {
		steamManager: {
			startAccount: async (...args) => calls.push(['start', ...args]),
			stopAccount: async (...args) => calls.push(['stop', ...args]),
			updateConfig: async (...args) => calls.push(['update', ...args]),
			submitCode: async (...args) => calls.push(['code', ...args]),
			getAllStatuses: async () => ({})
		}
	}
});
const { config, validateConfig, isOidcEnabled } = await import('../src/lib/server/config.ts');
mock.module(new URL('src/lib/auth.ts', root).href, {
	namedExports: { isAuthEnabled: isOidcEnabled }
});
await import('../scripts/migrate.mjs');
const { db, pool } = await import('../src/lib/database.ts');
const { user } = await import('../src/lib/schema.ts');
const { steamAccount, steamChatMessage } = await import('../src/lib/server/steam/schema.ts');
const { eq } = await import('drizzle-orm');
const page = await import('../src/routes/+page.server.ts');
const layout = await import('../src/routes/+layout.server.ts');
const crypto = await import('../src/lib/server/steam/crypto.ts');
const qr = await import('../src/lib/server/steam/session_store.ts');
const alice = { user: { id: 'alice', name: 'Alice' }, session: { token: 'session-secret' } };
const bob = { user: { id: 'bob', name: 'Bob' }, session: { token: 'other-session' } };
const anonymous = { user: null, session: null };

function oidc(enabled) {
	Object.assign(
		config.oidc,
		enabled
			? {
					providerName: 'Test',
					providerId: 'test',
					clientId: 'test',
					clientSecret: 'test-only',
					discoveryUrl: 'https://idp.invalid/.well-known/openid-configuration'
				}
			: {
					providerName: undefined,
					providerId: undefined,
					clientId: undefined,
					clientSecret: undefined,
					discoveryUrl: undefined
				}
	);
}
function event(locals, fields = {}) {
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.set(key, value);
	return {
		locals,
		request: new Request('https://localhost:8443/', { method: 'POST', body: form })
	};
}
const status = (expected) => (failure) => failure.status === expected;
async function account(id, userId = 'alice', extra = {}) {
	await db.insert(steamAccount).values({ id, accountName: id, userId, games: [], ...extra });
}

beforeEach(async () => {
	qr.clearQrSessions();
	FakeSession.instances.length = 0;
	FakeSession.start = async () => ({ qrChallengeUrl: 'https://s.team/q/test-only' });
	calls.length = 0;
	oidc(true);
	config.general.allowAnonymous = true;
	await db.delete(steamChatMessage);
	await db.delete(steamAccount);
	await db.delete(user);
	await db.insert(user).values([
		{ id: 'alice', name: 'Alice', email: 'alice@example.invalid' },
		{ id: 'bob', name: 'Bob', email: 'bob@example.invalid' }
	]);
});

test('every account action rejects anonymous and foreign owners; local mode isolates null-owned rows', async () => {
	await account('victim');
	const fields = {
		id: 'victim',
		accountId: 'victim',
		steamIdOther: '76561198000000000',
		games: '[730]',
		code: 'ABCDE'
	};
	for (const name of [
		'startAccount',
		'stopAccount',
		'updateAccountConfig',
		'submitSteamCode',
		'deleteAccount',
		'deleteChat'
	]) {
		await assert.rejects(page.actions[name](event(anonymous, fields)), status(401));
		await assert.rejects(page.actions[name](event(bob, fields)), status(404));
		oidc(false);
		await assert.rejects(page.actions[name](event(anonymous, fields)), status(404));
		oidc(true);
	}
	assert.deepEqual(calls, []);
	assert.equal((await db.select().from(steamAccount)).length, 1);
	await page.actions.startAccount(event(alice, fields));
	await page.actions.stopAccount(event(alice, fields));
	await page.actions.updateAccountConfig(event(alice, fields));
	await page.actions.submitSteamCode(event(alice, fields));
	assert.deepEqual(
		calls.map(([name]) => name),
		['start', 'stop', 'update', 'code']
	);
	await account('local', null);
	oidc(false);
	await page.actions.startAccount(event(anonymous, { id: 'local' }));
	assert.equal(calls.at(-1)[1], 'local');
});

test('dashboard returns the latest 50 messages for each owned account with deterministic timestamp ties', async () => {
	await account('first');
	await account('second');
	await account('foreign', 'bob');
	for (const id of ['first', 'second', 'foreign']) {
		await db.insert(steamChatMessage).values(
			Array.from({ length: 65 }, (_, i) => ({
				accountId: id,
				steamIdOther: '76561198000000001',
				content: `${id}-${i}`,
				timestamp: new Date(1700000000000)
			}))
		);
	}
	const data = await page.load({ locals: alice });
	assert.deepEqual(Object.keys(data.messages).sort(), ['first', 'second']);
	for (const id of ['first', 'second']) {
		assert.deepEqual(
			data.messages[id].map((row) => row.content),
			Array.from({ length: 50 }, (_, i) => `${id}-${i + 15}`)
		);
	}
	assert.equal(
		(await db.select().from(steamChatMessage)).length,
		195,
		'Loading a page must not delete history'
	);
});

test('page and layout serialize neither Steam credentials nor auth session token', async () => {
	await account('own', 'alice', {
		sharedSecret: 'seed-not-for-client',
		refreshToken: 'cipher-not-for-client',
		iv: 'iv-not-for-client',
		authTag: 'tag-not-for-client'
	});
	await account('foreign', 'bob');
	const data = await page.load({ locals: alice });
	assert.deepEqual(
		data.accounts.map((row) => row.id),
		['own']
	);
	for (const field of ['sharedSecret', 'refreshToken', 'iv', 'authTag', 'userId'])
		assert.equal(field in data.accounts[0], false);
	assert.equal(JSON.stringify(data).includes('not-for-client'), false);
	const layoutData = await layout.load({ locals: alice, url: new URL('https://localhost:8443/') });
	assert.equal('session' in layoutData, false);
	assert.equal(JSON.stringify(layoutData).includes('session-secret'), false);
	await assert.rejects(page.load({ locals: anonymous }), status(401));
});

test('configuration refuses partial OIDC, implicit anonymous mode and weak master secret', () => {
	validateConfig();
	oidc(false);
	config.general.allowAnonymous = false;
	assert.throws(validateConfig, /Configure OIDC/);
	config.general.allowAnonymous = true;
	validateConfig();
	config.oidc.clientId = 'partial';
	assert.throws(validateConfig, /Incomplete OIDC/);
	oidc(true);
	const secret = config.auth.secret;
	config.auth.secret = '';
	assert.throws(validateConfig, /32 characters/);
	assert.throws(() => crypto.encrypt('token'), /strong/);
	config.auth.secret = secret;
});

test('authentication configuration requires matching HTTPS origins, including localhost', () => {
	const saved = { ...config.auth };
	const discovery = config.oidc.discoveryUrl;
	try {
		for (const url of [
			'',
			'http://localhost:8443',
			'https://name:password@localhost:8443',
			'https://localhost:8443/path'
		]) {
			config.auth.url = url;
			assert.throws(validateConfig, undefined, `Accepted unsafe auth URL ${url}`);
		}
		config.auth.url = saved.url;
		for (const origin of [
			'',
			'http://localhost:8443',
			'https://other.invalid',
			'https://localhost:8443/path'
		]) {
			config.auth.origin = origin;
			assert.throws(validateConfig, undefined, `Accepted unsafe origin ${origin}`);
		}
		config.auth.origin = saved.origin;
		config.oidc.discoveryUrl = 'http://localhost/.well-known/openid-configuration';
		assert.throws(validateConfig, /HTTPS/);
	} finally {
		Object.assign(config.auth, saved);
		config.oidc.discoveryUrl = discovery;
	}
	validateConfig();
});

test('legacy tokens remain readable; new credentials authenticate ciphertext and migrate idle 2FA seeds', async () => {
	const cipher = createCipheriv(
		'aes-256-gcm',
		Buffer.from(config.auth.secret.slice(0, 32)),
		Buffer.alloc(16, 7)
	);
	const content = Buffer.concat([cipher.update('legacy-test-token'), cipher.final()]).toString(
		'hex'
	);
	assert.equal(
		crypto.decrypt({
			content,
			iv: Buffer.alloc(16, 7).toString('hex'),
			authTag: cipher.getAuthTag().toString('hex')
		}),
		'legacy-test-token'
	);
	const encrypted = crypto.encrypt('current-test-token');
	assert.match(encrypted.content, /^v2:/);
	assert.equal(crypto.decrypt(encrypted), 'current-test-token');
	assert.throws(() => crypto.decrypt({ ...encrypted, authTag: '00'.repeat(16) }));
	assert.throws(() => crypto.decryptSharedSecret('enc:v1:malformed'));
	assert.throws(() => crypto.decryptSharedSecret('enc:v9:unsupported'));
	const seed = Buffer.alloc(20, 3).toString('base64');
	await account('idle-legacy', 'alice', { sharedSecret: seed });
	const { steamManager } = await import('../src/lib/server/steam/manager.ts?actual');
	await steamManager.init();
	const migrated = await db.query.steamAccount.findFirst({
		where: eq(steamAccount.id, 'idle-legacy')
	});
	assert.match(migrated.sharedSecret, /^enc:v1:/);
	assert.equal(crypto.decryptSharedSecret(migrated.sharedSecret), seed);
});

test('normal account addition encrypts 2FA and preserves the ephemeral password workflow', async () => {
	const seed = Buffer.alloc(20, 4).toString('base64');
	await page.actions.addAccount(
		event(alice, {
			accountName: 'test-account',
			password: 'test-only-password',
			sharedSecret: seed
		})
	);
	const row = await db.query.steamAccount.findFirst();
	assert.equal(crypto.decryptSharedSecret(row.sharedSecret), seed);
	assert.notEqual(row.sharedSecret, seed);
	assert.equal('password' in row, false);
	assert.equal(calls.at(-1)[3], 'test-only-password');
});

test('password and QR additions cannot reserve or reveal another owner account name', async () => {
	await account('existing-alice', 'alice', { accountName: 'shared-synthetic-name' });
	const add = (locals, accountName) =>
		page.actions.addAccount(event(locals, { accountName, password: 'unverified-test-password' }));
	const existing = await add(bob, 'shared-synthetic-name');
	const fresh = await add(bob, 'fresh-synthetic-name');
	assert.equal(existing, undefined);
	assert.deepEqual(existing, fresh);
	assert.equal((await page.load({ locals: alice })).accounts.length, 1);
	assert.equal((await page.load({ locals: bob })).accounts.length, 2);
	// Bob's unverified password attempt must not block Alice's confirmed QR result.
	const started = await page.actions.startQrLogin(event(alice));
	const session = FakeSession.instances.at(-1);
	session.accountName = 'fresh-synthetic-name';
	session.refreshToken = 'synthetic-qr-token';
	session.emit('authenticated');
	const result = await page.actions.pollQrLogin(event(alice, { sessionId: started.sessionId }));
	assert.equal(result.success, true);
	assert.equal((await page.load({ locals: alice })).accounts.length, 2);
	assert.equal((await page.load({ locals: bob })).accounts.length, 2);
	const duplicate = await add(bob, 'shared-synthetic-name');
	assert.equal(duplicate.status, 500, 'Same-owner duplicates remain rejected');
	oidc(false);
	assert.equal(await add(anonymous, 'shared-synthetic-name'), undefined);
	assert.equal((await add(anonymous, 'shared-synthetic-name')).status, 500);
});

test('a malformed legacy seed is rejected per account without disabling the dashboard', async () => {
	await account('broken-seed', 'alice', { sharedSecret: 'enc:v1:not-json' });
	await account('healthy-seed', 'alice', { sharedSecret: Buffer.alloc(20, 5).toString('base64') });
	const { steamManager } = await import('../src/lib/server/steam/manager.ts?actual');
	await steamManager.init();
	const broken = await db.query.steamAccount.findFirst({
		where: eq(steamAccount.id, 'broken-seed')
	});
	assert.equal(broken.status, 'LOGIN_REQUIRED');
	assert.equal(broken.sharedSecret, 'enc:v1:not-json');
	const data = await page.load({ locals: alice });
	assert.equal(data.accounts.length, 2);
	assert.equal(JSON.stringify(data).includes('not-json'), false);
	await page.actions.deleteAccount(event(alice, { id: 'broken-seed' }));
	assert.equal((await db.select().from(steamAccount)).length, 1);
});

test('PostgreSQL runtime migrations are idempotent without deleting existing data', async () => {
	await account('legacy-data');

	await import('../scripts/migrate.mjs?legacy-schema');
	await import('../scripts/migrate.mjs?idempotent');
	const rows = await db.select().from(steamAccount);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].id, 'legacy-data');
});

test('QR auth before first poll stays owner-bound, persists once and never returns the token', async () => {
	await assert.rejects(page.actions.startQrLogin(event(anonymous)), status(401));
	const started = await page.actions.startQrLogin(event(alice));
	const session = FakeSession.instances.at(-1);
	session.accountName = 'qr-test-account';
	session.refreshToken = 'test-refresh-secret';
	session.emit('authenticated');
	await assert.rejects(
		page.actions.pollQrLogin(event(bob, { sessionId: started.sessionId })),
		status(404)
	);
	const result = await page.actions.pollQrLogin(event(alice, { sessionId: started.sessionId }));
	assert.equal(result.success, true);
	assert.equal(JSON.stringify(result).includes('test-refresh-secret'), false);
	await assert.rejects(
		page.actions.pollQrLogin(event(alice, { sessionId: started.sessionId })),
		status(404)
	);
	const rows = await db.select().from(steamAccount);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].userId, 'alice');
	assert.equal(
		crypto.decrypt({ content: rows[0].refreshToken, iv: rows[0].iv, authTag: rows[0].authTag }),
		'test-refresh-secret'
	);
});

test('QR reservations bound in-flight attempts; abandoned sessions expire and cannot resurrect', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const resolvers = [];
	FakeSession.start = () => new Promise((resolve) => resolvers.push(resolve));
	const first = qr.startQrSession('alice');
	const second = qr.startQrSession('alice');
	await assert.rejects(qr.startQrSession('alice'), status(429));
	t.mock.timers.tick(120_000);
	assert.ok(FakeSession.instances.every((session) => session.cancelled && session.agentDestroyed));
	for (const resolve of resolvers) resolve({ qrChallengeUrl: 'https://s.team/q/test-only' });
	await assert.rejects(first, status(408));
	await assert.rejects(second, status(408));
	t.mock.timers.reset();
	FakeSession.start = async () => ({ qrChallengeUrl: 'https://s.team/q/test-only' });
	for (let index = 0; index < 16; index++) await qr.startQrSession(`owner-${index}`);
	await assert.rejects(qr.startQrSession('extra'), status(429));
});

test('QR errors are sanitized and cancellation requires ownership', async () => {
	const started = await qr.startQrSession('alice');
	assert.throws(() => qr.cancelQrSession(started.sessionId, 'bob'), status(404));
	FakeSession.instances.at(-1).emit('error', new Error('upstream-secret-must-not-leak'));
	assert.deepEqual(qr.takeQrResult(started.sessionId, 'alice'), {
		status: 500,
		error: 'Steam QR login failed'
	});
	const another = await qr.startQrSession('alice');
	qr.cancelQrSession(another.sessionId, 'alice');
	assert.throws(() => qr.takeQrResult(another.sessionId, 'alice'), status(404));
});

test('confirmation renders active account-name markup as text', async () => {
	const { createServer } = await import('vite');
	const tls = await createTlsFixture();
	const previous = {
		TLS_CERT_FILE: process.env.TLS_CERT_FILE,
		TLS_KEY_FILE: process.env.TLS_KEY_FILE
	};
	process.env.TLS_CERT_FILE = tls.certFile;
	process.env.TLS_KEY_FILE = tls.keyFile;
	let vite;
	try {
		vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
		const { default: ConfirmModal } = await vite.ssrLoadModule(
			'/src/lib/components/ui/ConfirmModal.svelte'
		);
		const { render } = await vite.ssrLoadModule('svelte/server');
		const { body } = render(ConfirmModal, {
			props: { message: '<img src=x onerror="test-only">', onConfirm() {}, onCancel() {} }
		});
		assert.ok(body.includes('&lt;img'));
		assert.equal(body.includes('<img src=x'), false);
	} finally {
		if (vite) await vite.close();
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		await tls.cleanup();
	}
});

test('patched dependencies preserve Steam APIs and the Better Auth database schema', async () => {
	const require = createRequire(import.meta.resolve('steam-user'));
	const { EncryptedAppTicket } = require('steam-appticket/protobufs/generated/_load.js');
	const bytes = EncryptedAppTicket.encode({
		ticket_version_no: 1,
		encrypted_ticket: Buffer.from('test-only')
	}).finish();
	const decoded = EncryptedAppTicket.decode(bytes);
	assert.equal(decoded.ticket_version_no, 1);
	assert.equal(Buffer.from(decoded.encrypted_ticket).toString(), 'test-only');
	const AdmZip = require('adm-zip');
	const zip = new AdmZip();
	zip.addFile('test.txt', Buffer.from('test-only'));
	const archive = new AdmZip(zip.toBuffer());
	assert.equal(archive.readFile(archive.getEntries()[0]).toString(), 'test-only');
	const cookie = createRequire(import.meta.resolve('@sveltejs/kit'))('cookie');
	assert.equal(
		cookie.parseCookie(cookie.stringifySetCookie({ name: 'session', value: 'test-only' })).session,
		'test-only'
	);
	const authRequire = createRequire(import.meta.resolve('better-auth'));
	const { getAuthTables } = await import(
		pathToFileURL(authRequire.resolve('@better-auth/core/db'))
	);
	const { getTableColumns } = await import('drizzle-orm');
	const schema = await import('../src/lib/schema.ts');
	for (const [name, table] of Object.entries(getAuthTables({}))) {
		const columns = getTableColumns(schema[name]);
		for (const field of Object.keys(table.fields)) assert.ok(field in columns, `${name}.${field}`);
	}
});

test(
	'real Steam transport cancellation stops connecting sockets and rejects late connection work',
	{ timeout: 5000 },
	async (t) => {
		const require = createRequire(import.meta.resolve('steam-session'));
		const websocket = require('websocket13');
		const Original = websocket.WebSocket;
		const sockets = [];
		class FakeSocket extends EventEmitter {
			state = websocket.State.Connecting;
			constructor() {
				super();
				sockets.push(this);
			}
			setTimeout(ms) {
				clearTimeout(this.timer);
				if (ms) this.timer = setTimeout(() => this.emit('timeout'), ms);
			}
			disconnect() {
				clearTimeout(this.timer);
				this.state = websocket.State.Disconnected;
				this.emit('disconnected', 1000, 'test-only', true);
			}
			send() {}
		}
		websocket.WebSocket = FakeSocket;
		t.mock.timers.enable({ apis: ['setTimeout'] });
		const Transport = require('steam-session/dist/transports/WebSocketCMTransport.js').default;
		const transport = new Transport({});
		const delayed = new Transport({});
		const normal = new Transport({});
		const list = [{ type: 'websockets', realm: 'steamglobal', endpoint: 'test.invalid:443' }];
		transport._getCMList = async () => list;
		try {
			const connecting = transport._connectToCM();
			const closed = assert.rejects(connecting, /canceled/);
			await Promise.resolve();
			t.mock.timers.tick(1000);
			await Promise.resolve();
			await Promise.resolve();
			const count = sockets.length;
			assert.ok(count >= 2);
			transport.close();
			await closed;
			t.mock.timers.tick(122_000);
			await Promise.resolve();
			assert.equal(sockets.length, count);
			assert.ok(sockets.every((socket) => socket.state === websocket.State.Disconnected));
			let finishList;
			delayed._getCMList = () =>
				new Promise((resolve) => {
					finishList = resolve;
				});
			const late = delayed._connectToCM();
			const rejected = assert.rejects(late, /canceled/);
			delayed.close();
			await rejected;
			finishList(list);
			await Promise.resolve();
			assert.equal(sockets.length, count);
			normal._getCMList = async () => list;
			const ready = normal._connectToCM();
			await Promise.resolve();
			const connected = sockets.at(-1);
			connected.state = websocket.State.Connected;
			connected.emit('connected');
			await ready;
			assert.equal(normal._connectionWaiters.size, 0);
		} finally {
			transport.close();
			delayed.close();
			normal.close();
			t.mock.timers.reset();
			websocket.WebSocket = Original;
		}
	}
);

after(async () => {
	qr.clearQrSessions();
	await pool.end();
	await testDb.cleanup();
	// Native SQLite can retain file handles until process exit on Windows.
	// These synthetic fixtures are in OS temp, outside the source tree.
	if (process.platform === 'win32') return;
	const resolved = realpathSync(scratch);
	const child = relative(scratchRoot, resolved);
	assert.ok(child && !child.startsWith('..') && !isAbsolute(child));
	rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
