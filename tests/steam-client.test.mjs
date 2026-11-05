import assert from 'node:assert/strict';
import { privateEnvModule } from './helpers/private-env.mjs';
import { test, mock, after } from 'node:test';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { format } from 'node:util';

const root = new URL('../', import.meta.url);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const token = (claims = {}) =>
	['{}', JSON.stringify({ iss: 'steam', aud: ['client'], sub: '76561198000000000', ...claims })]
		.map((part) => Buffer.from(part).toString('base64url'))
		.join('.') + '.synthetic-signature';
const seed = Buffer.alloc(20, 1).toString('base64');

// Use the actual installed SteamUser. Only its network connection is replaced.
const { SteamClient } = await import('../src/lib/server/steam/client.ts');
function client() {
	const instance = new SteamClient('synthetic-test-account');
	instance.connectionAttempts = 0;
	instance.client._doConnection = async () => instance.connectionAttempts++;
	instance.client._apiRequest = async () => {
		throw new Error('Network requests are forbidden in this test');
	};
	return instance;
}

test('real SteamUser accepts a client refresh token without mixing in the stored 2FA seed', async () => {
	const instance = client();
	try {
		assert.equal(instance.client.options.webCompatibilityMode, true);
		await Promise.all([instance.login(null, token(), seed), instance.login(null, token(), seed)]);
		await tick();
		assert.equal(instance.connectionAttempts, 1);
		assert.equal(instance.client._logOnDetails.access_token, token());
		assert.equal(instance.client._logOnDetails.two_factor_code, undefined);
		assert.equal(instance.client._logOnDetails.password, undefined);
		assert.equal(instance.client._logOnDetails.account_name, undefined);
	} finally {
		await instance.logOff();
	}
});

test('password login still supplies the account and a generated Steam Guard code', async () => {
	const instance = client();
	try {
		await instance.login('synthetic-password', null, seed);
		await tick();
		assert.equal(instance.client._logOnDetails.account_name, 'synthetic-test-account');
		assert.equal(instance.client._logOnDetails.password, 'synthetic-password');
		assert.match(
			instance.client._logOnDetails.two_factor_code,
			/^[23456789BCDFGHJKMNPQRTVWXY]{5}$/
		);
		assert.equal(instance.connectionAttempts, 1);
	} finally {
		await instance.logOff();
	}
});

test('malformed and wrong-audience tokens fail before SteamUser schedules a login', async () => {
	const instance = client();
	for (const invalid of [
		'not-a-jwt',
		token({ iss: 'other' }),
		token({ aud: ['web'] }),
		token({ sub: 123 })
	]) {
		await assert.rejects(instance.login(null, invalid, seed));
		assert.equal(instance.isActive, false);
	}
	await tick();
	assert.equal(instance.connectionAttempts, 0);
});

test('transient disconnect leaves reconnection to SteamUser and rejects duplicate starts', async () => {
	const instance = client();
	try {
		await instance.login(null, token());
		await tick();
		instance.client.emit('disconnected', 0, 'Synthetic transient disconnect');
		assert.equal(instance.status, 'CONNECTING');
		assert.equal(instance.isActive, true);
		await instance.login(null, token());
		await tick();
		assert.equal(instance.connectionAttempts, 1);
	} finally {
		await instance.logOff();
	}
});

test('logout waits for the delayed Steam disconnect and blocks login during that wait', async () => {
	const instance = client();
	await instance.login(null, token());
	await tick();
	instance.client.steamID = {};
	let requested = false;
	instance.client.logOff = () => {
		requested = true;
	};
	let finished = false;
	const stopping = instance.logOff().then(() => {
		finished = true;
	});
	await tick();
	assert.equal(requested, true);
	assert.equal(finished, false);
	await instance.login(null, token());
	assert.equal(instance.connectionAttempts, 1);
	instance.client.emit('disconnected', 0, 'Synthetic logout');
	instance.client.steamID = null;
	await stopping;
	assert.equal(instance.status, 'DISCONNECTED');
	assert.equal(instance.isActive, false);
});

test('Steam Guard callbacks are consumed once and discarded after stop or a fatal error', async () => {
	const instance = client();
	await instance.login(null, token());
	await tick();
	const supplied = [];
	instance.client.emit('steamGuard', null, (code) => supplied.push(code));
	instance.provideGuardCode('ABCDE');
	instance.provideGuardCode('FGHIJ');
	assert.deepEqual(supplied, ['ABCDE']);
	instance.client.emit('steamGuard', null, (code) => supplied.push(code));
	await instance.logOff();
	instance.provideGuardCode('KLMNO');
	assert.deepEqual(supplied, ['ABCDE']);
	await instance.login(null, token());
	await tick();
	instance.client.emit('steamGuard', null, (code) => supplied.push(code));
	instance.client.emit('error', new Error('Synthetic error'));
	instance.provideGuardCode('PQRST');
	assert.deepEqual(supplied, ['ABCDE']);
	await instance.logOff();
});

test('Steam client lifecycle logs omit account identity and authentication material', async (t) => {
	const output = [];
	for (const method of ['log', 'warn', 'error'])
		t.mock.method(console, method, (...values) => output.push(format(...values)));
	const instance = client();
	const password = 'synthetic-private-password';
	const refresh = 'synthetic-private-refresh-token';
	const domain = 'synthetic-private-mail.invalid';
	const code = 'QWERT';
	const supplied = [];
	try {
		await instance.login(password, null, seed);
		await tick();
		instance.client.setPersona = () => {};
		instance.client.gamesPlayed = () => {};
		instance.client.steamID = {};
		instance.client.emit('loggedOn');
		instance.client.emit('refreshToken', refresh);
		instance.client.emit('steamGuard', domain, (value) => supplied.push(value));
		instance.provideGuardCode(code);
		instance.provideGuardCode(code);
		instance.setGames([]);
		instance.client.emit('error', new Error(password));
		assert.deepEqual(supplied, [code]);
		assert.ok(output.length > 0);
		for (const secret of ['synthetic-test-account', password, refresh, domain, code, seed])
			assert.equal(output.join('\n').includes(secret), false, 'Sensitive client log value');
	} finally {
		instance.client.steamID = null;
		await instance.logOff();
	}
});

test('new chat API saves the confirmed reply and does not report failed sends as outgoing', async () => {
	const instance = client();
	await instance.login(null, token());
	await tick();
	instance.setAutoReply('requested reply');
	const messages = [];
	instance.on('message', (message) => messages.push(message));
	const incoming = {
		steamid_friend: { getSteamID64: () => '76561198000000001' },
		message: 'incoming'
	};
	let confirm;
	instance.client.chat.sendFriendMessage = async (recipient, message) => {
		assert.equal(recipient, incoming.steamid_friend);
		assert.equal(message, 'requested reply');
		return await new Promise((resolve) => {
			confirm = resolve;
		});
	};
	instance.client.chat.emit('friendMessage', incoming);
	assert.equal(messages.length, 1);
	confirm({ modified_message: 'Steam-confirmed reply' });
	await tick();
	assert.deepEqual(messages[1], {
		steamId: '76561198000000001',
		message: 'Steam-confirmed reply',
		direction: 'outgoing'
	});
	instance.client.chat.sendFriendMessage = async () => {
		throw new Error('Synthetic Steam rejection');
	};
	instance.client.chat.emit('friendMessage', incoming);
	await tick();
	assert.equal(messages.length, 3);
	assert.equal(messages.filter((message) => message.direction === 'outgoing').length, 1);
	await instance.logOff();
});

test('games and persona settings use the supported SteamUser call formats after login', async () => {
	const instance = client();
	const played = [];
	const personas = [];
	instance.client.gamesPlayed = (games) => played.push(games);
	instance.client.setPersona = (state) => personas.push(state);
	instance.setPersonaState(7);
	instance.setGames([730], 'Custom non-Steam title');
	assert.equal(played.length, 0);
	await instance.login(null, token());
	await tick();
	instance.client.steamID = {};
	instance.client.emit('loggedOn');
	assert.deepEqual(played.at(-1), ['Custom non-Steam title', 730]);
	assert.equal(personas.at(-1), 7);
	assert.equal(instance.status, 'BOOSTING');
	instance.setGames([]);
	assert.deepEqual(played.at(-1), []);
	assert.equal(instance.status, 'ONLINE');
	instance.client.steamID = null;
	await instance.logOff();
});

// Manager tests retain the real SQLite schema and encryption. Only Steam sessions are fake.
process.env.DATABASE_URL = 'file::memory:';
process.env.BETTER_AUTH_SECRET = 'steam-tests-only-master-secret-0123456789abcdefgh';
registerHooks({
	resolve(specifier, context, next) {
		if (specifier === '$app/env/private') return privateEnvModule();
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
class FakeSteamClient extends EventEmitter {
	static instances = [];
	constructor() {
		super();
		this.isActive = false;
		this.status = 'DISCONNECTED';
		this.logins = 0;
		FakeSteamClient.instances.push(this);
	}
	async login() {
		this.logins++;
		this.isActive = true;
		this.status = 'CONNECTING';
	}
	async logOff() {
		if (this.stopWait) await this.stopWait;
		this.isActive = false;
		this.status = 'DISCONNECTED';
		this.emit('status', 'DISCONNECTED');
	}
	setPersonaState() {}
	setAutoReply() {}
	setGames() {}
	getStatus() {
		return this.status;
	}
}
mock.module(new URL('src/lib/server/steam/client.ts', root).href, {
	namedExports: { SteamClient: FakeSteamClient }
});
const { db } = await import('../src/lib/database.ts');
const { steamAccount, steamChatMessage } = await import('../src/lib/server/steam/schema.ts');
const { eq } = await import('drizzle-orm');
const { encrypt, decrypt } = await import('../src/lib/server/steam/crypto.ts');
await db.$client.executeMultiple(
	readFileSync(new URL('../drizzle/0000_known_supernaut.sql', import.meta.url), 'utf8')
);
const { steamManager } = await import('../src/lib/server/steam/manager.ts');
after(async () => {
	await steamManager.stopAll();
	db.$client.close();
});

test('manager serializes duplicate starts and stop-restart, ignoring retired session events', async () => {
	const encrypted = encrypt(token());
	const account = {
		id: 'queued-account',
		accountName: 'queued-account',
		games: [],
		refreshToken: encrypted.content,
		iv: encrypted.iv,
		authTag: encrypted.authTag
	};
	await db.insert(steamAccount).values(account);
	await Promise.all([
		steamManager.startAccount(account.id, account),
		steamManager.startAccount(account.id, account)
	]);
	assert.equal(FakeSteamClient.instances.length, 1);
	const first = FakeSteamClient.instances[0];
	assert.equal(first.logins, 1);
	let finishStop;
	first.stopWait = new Promise((resolve) => {
		finishStop = resolve;
	});
	const stopping = steamManager.stopAccount(account.id);
	const restarting = steamManager.startAccount(account.id, account);
	await tick();
	assert.equal(FakeSteamClient.instances.length, 1);
	assert.equal((await db.select().from(steamAccount))[0].status, 'CONNECTING');
	finishStop();
	await Promise.all([stopping, restarting]);
	assert.equal(FakeSteamClient.instances.length, 2);
	const second = FakeSteamClient.instances[1];
	assert.equal(second.logins, 1);
	second.status = 'ONLINE';
	second.emit('status', 'ONLINE');
	await tick();
	first.emit('status', 'ERROR');
	first.emit('refreshToken', 'retired-token');
	first.emit('message', { steamId: '76561198000000001', message: 'retired-message' });
	await tick();
	const row = (await db.select().from(steamAccount).where(eq(steamAccount.id, account.id)))[0];
	assert.equal(row.status, 'ONLINE');
	assert.equal(row.refreshToken, encrypted.content);
	assert.deepEqual(await db.select().from(steamChatMessage), []);
	assert.equal(steamManager.getClientStatus(account.id), 'ONLINE');
	await steamManager.stopAccount(account.id);
	assert.equal((await db.select().from(steamAccount))[0].status, 'IDLE');
});

test('manager logs omit account identity, credentials and chat during startup and updates', async (t) => {
	const output = [];
	for (const method of ['log', 'warn', 'error'])
		t.mock.method(console, method, (...values) => output.push(format(...values)));
	const id = 'synthetic-private-manager-id';
	const name = 'synthetic-private-manager-name';
	const message = 'synthetic-private-chat-body';
	const refreshed = 'synthetic-private-refreshed-token';
	const encrypted = encrypt(token());
	await db.insert(steamAccount).values({
		id,
		accountName: name,
		games: [],
		status: 'ONLINE',
		refreshToken: encrypted.content,
		iv: encrypted.iv,
		authTag: encrypted.authTag
	});
	try {
		await steamManager.init();
		const active = FakeSteamClient.instances.at(-1);
		active.emit('refreshToken', refreshed);
		active.emit('message', { steamId: '76561198000000001', message });
		await tick();
		await steamManager.updateConfig(id, { games: [730], customTitle: message });
		const row = await db.query.steamAccount.findFirst({ where: eq(steamAccount.id, id) });
		assert.equal(
			decrypt({ content: row.refreshToken, iv: row.iv, authTag: row.authTag }),
			refreshed
		);
		assert.equal((await db.select().from(steamChatMessage))[0].content, message);
		const missingId = 'synthetic-private-missing-id';
		await db
			.insert(steamAccount)
			.values({ id: missingId, accountName: 'synthetic-missing-name', games: [] });
		await steamManager.startAccount(missingId);
		assert.ok(output.length > 0);
		for (const secret of [
			id,
			name,
			message,
			refreshed,
			token(),
			missingId,
			'synthetic-missing-name',
			'76561198000000001'
		])
			assert.equal(output.join('\n').includes(secret), false, 'Sensitive manager log value');
	} finally {
		await steamManager.stopAccount(id);
	}
});
