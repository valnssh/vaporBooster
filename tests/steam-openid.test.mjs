import assert from 'node:assert/strict';
import { privateEnvModule } from './helpers/private-env.mjs';
import { test, after, mock } from 'node:test';
import { registerHooks } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const origin = 'https://hours.example.test';
const steamId = '76561198000000001';
const scratch = mkdtempSync(join(tmpdir(), 'hoursbooster-openid-'));
process.env.DATABASE_URL = `file:${join(scratch, 'synthetic.db').replaceAll('\\', '/')}`;
process.env.BETTER_AUTH_SECRET = 'test-only-steam-openid-secret-0123456789';
process.env.BETTER_AUTH_URL = process.env.ORIGIN = origin;
process.env.STEAM_LOGIN_ENABLED = 'true';
process.env.STEAM_ALLOWED_IDS = steamId;
process.env.BETTER_AUTH_TELEMETRY = '0';
registerHooks({
	resolve(specifier, context, next) {
		if (specifier === '$app/env/private') return privateEnvModule();
		if (specifier.startsWith('#lib/'))
			specifier = new URL(`src/lib/${specifier.slice(5)}`, root).href;
		try {
			return next(specifier, context);
		} catch (error) {
			if (specifier.startsWith('.') || specifier.startsWith('file:')) {
				const url = new URL(specifier, context.parentURL);
				if (!/\.[a-z]+$/i.test(url.pathname)) {
					url.pathname += '.ts';
					return next(url.href, context);
				}
			}
			throw error;
		}
	}
});
await import('../scripts/migrate.mjs');
const { betterAuth } = await import('better-auth');
const { createAuthEndpoint } = await import('better-auth/api');
const { setSessionCookie } = await import('better-auth/cookies');
const { drizzleAdapter } = await import('better-auth/adapters/drizzle');
const { db } = await import('../src/lib/database.ts');
const { account, user, verification } = await import('../src/lib/schema.ts');
const { eq } = await import('drizzle-orm');
const { steamOpenId, verifySteamAssertion } = await import('../src/lib/server/steam/openid.ts');
const { config, validateConfig, isAuthEnabled } = await import('../src/lib/server/config.ts');
let syntheticSession;
const auth = betterAuth({
	database: drizzleAdapter(db, { provider: 'sqlite' }),
	baseURL: origin,
	secret: process.env.BETTER_AUTH_SECRET,
	telemetry: { enabled: false },
	logger: { disabled: true },
	advanced: { useSecureCookies: true },
	rateLimit: { enabled: false },
	plugins: [
		steamOpenId(),
		{
			id: 'test-fixture-only',
			endpoints: {
				issueFixtureCookie: createAuthEndpoint(
					'/test-fixture-only',
					{ method: 'POST' },
					async (ctx) => {
						await setSessionCookie(ctx, syntheticSession);
						return ctx.json({});
					}
				)
			}
		}
	]
});
const ctx = await auth.$context;
let verifyCalls = 0;
let validResponse = true;
let customResponse;
let networkFailure = false;
mock.method(globalThis, 'fetch', async (url, options) => {
	assert.equal(String(url), 'https://steamcommunity.com/openid/login');
	assert.equal(options.redirect, 'error');
	assert.equal(options.method, 'POST');
	assert.equal(options.body.get('openid.mode'), 'check_authentication');
	assert.ok(options.signal);
	verifyCalls++;
	if (networkFailure) throw new Error('Synthetic provider transport failure');
	return new Response(
		customResponse ?? `ns:http://specs.openid.net/auth/2.0\nis_valid:${validResponse}\n`
	);
});

function cookieHeader(response) {
	return response.headers
		.getSetCookie()
		.filter((cookie) => !/Max-Age=0/i.test(cookie))
		.map((cookie) => cookie.split(';')[0])
		.join('; ');
}
async function begin(path = '/sign-in/steam', cookie = '', requestOrigin = origin) {
	return auth.handler(
		new Request(`${origin}/api/auth${path}`, {
			method: 'POST',
			headers: { origin: requestOrigin, cookie }
		})
	);
}
async function challenge(path, cookie) {
	const response = await begin(path, cookie);
	assert.equal(response.status, 200, await response.clone().text());
	const url = new URL((await response.json()).url);
	assert.equal(url.origin, 'https://steamcommunity.com');
	assert.equal(url.pathname, '/openid/login');
	const stateCookie = cookieHeader(response);
	assert.match(response.headers.get('set-cookie'), /HttpOnly/i);
	assert.match(response.headers.get('set-cookie'), /Secure/i);
	assert.match(response.headers.get('set-cookie'), /SameSite=Lax/i);
	const cookies = new Map(
		[cookie, stateCookie]
			.join('; ')
			.split('; ')
			.filter(Boolean)
			.map((part) => [part.slice(0, part.indexOf('=')), part])
	);
	return {
		returnTo: url.searchParams.get('openid.return_to'),
		cookie: [...cookies.values()].join('; ')
	};
}
function assertion(returnTo, id = steamId) {
	const url = new URL(returnTo);
	const identity = `https://steamcommunity.com/openid/id/${id}`;
	for (const [name, value] of Object.entries({
		ns: 'http://specs.openid.net/auth/2.0',
		mode: 'id_res',
		op_endpoint: 'https://steamcommunity.com/openid/login',
		claimed_id: identity,
		identity,
		return_to: returnTo,
		response_nonce: `${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}random`,
		assoc_handle: 'synthetic-association',
		signed: 'op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
		sig: 'synthetic-signature-verified-only-by-mock'
	}))
		url.searchParams.set(`openid.${name}`, value);
	return url;
}
function callback(url, cookie = '') {
	return auth.handler(new Request(url, { headers: { cookie } }));
}
async function getSession(cookie) {
	return auth.api.getSession({ headers: new Headers({ cookie }) });
}

test('Steam auth is explicit, closed by allowlist, and uses owner access enforcement', async () => {
	validateConfig();
	assert.equal(isAuthEnabled(), true);
	const { requestOwnerId } = await import('../src/lib/server/access.ts');
	assert.throws(
		() => requestOwnerId({ user: null, session: null }),
		(error) => error.status === 401
	);
	assert.equal(requestOwnerId({ user: { id: 'owner' }, session: {} }), 'owner');
	const allowed = config.steamLogin.allowedIds;
	config.steamLogin.allowedIds = [];
	assert.throws(validateConfig, /explicit STEAM_ALLOWED_IDS/);
	config.steamLogin.allowedIds = allowed;
	const providerId = config.oidc.providerId;
	config.oidc.providerId = 'steam';
	assert.throws(validateConfig, /reserved for Steam OpenID/);
	config.oidc.providerId = providerId;
	assert.equal((await begin('/sign-in/steam', '', 'https://other.test')).status, 403);
	assert.equal((await begin('/link/steam')).status, 401);
});

test('OpenID rejects untrusted destinations, unsigned fields, stale assertions and unknown identities before networking', async () => {
	const returnTo = `${origin}/api/auth/steam/callback?state=synthetic`;
	for (const [key, value] of [
		['openid.op_endpoint', 'https://unknown.example/'],
		['openid.return_to', `${origin}/other`],
		['openid.ns', 'wrong'],
		['openid.mode', 'cancel'],
		['openid.identity', 'https://steamcommunity.com/openid/id/76561198000000002'],
		['openid.claimed_id', 'https://evil.test/openid/id/76561198000000001'],
		['openid.signed', 'claimed_id,identity'],
		['openid.response_nonce', '2000-01-01T00:00:00Zold'],
		['openid.response_nonce', '2999-01-01T00:00:00Zfuture'],
		['openid.assoc_handle', ''],
		['openid.sig', '']
	]) {
		const url = assertion(returnTo);
		url.searchParams.set(key, value);
		const before = verifyCalls;
		await assert.rejects(verifySteamAssertion(url, returnTo));
		assert.equal(verifyCalls, before);
	}
	const duplicate = assertion(returnTo);
	duplicate.searchParams.append(
		'openid.claimed_id',
		duplicate.searchParams.get('openid.claimed_id')
	);
	await assert.rejects(verifySteamAssertion(duplicate, returnTo));
	await assert.rejects(verifySteamAssertion(assertion(returnTo, '76561198000000002'), returnTo));
	validResponse = false;
	await assert.rejects(verifySteamAssertion(assertion(returnTo), returnTo));
	validResponse = true;
	assert.equal(await verifySteamAssertion(assertion(returnTo), returnTo), steamId);
});

test('real BetterAuth callback requires browser binding and consumes state once before making a secure session', async () => {
	const flow = await challenge();
	const proof = assertion(flow.returnTo);
	const before = verifyCalls;
	const stolen = await callback(proof);
	assert.equal(stolen.headers.get('location'), `${origin}/login?steam=failed`);
	assert.equal(verifyCalls, before);
	const result = await callback(proof, flow.cookie);
	assert.equal(result.headers.get('location'), `${origin}/`);
	assert.equal(verifyCalls, before + 1);
	const cookie = cookieHeader(result);
	assert.match(result.headers.get('set-cookie'), /session_token/);
	assert.match(result.headers.get('set-cookie'), /HttpOnly/i);
	assert.match(result.headers.get('set-cookie'), /Secure/i);
	const session = await getSession(cookie);
	assert.equal(session.user.name, 'Steam user');
	assert.equal(session.user.emailVerified, false);
	const binding = await ctx.internalAdapter.findAccountOwnerByKey({
		providerId: 'steam',
		accountId: steamId
	});
	assert.equal(binding.user.id, session.user.id);
	const again = await callback(proof, flow.cookie);
	assert.equal(again.headers.get('location'), `${origin}/login?steam=failed`);
	assert.equal(verifyCalls, before + 1);
	assert.ok(!again.headers.get('set-cookie')?.includes('session_token'));
	await assert.rejects(
		db
			.insert(account)
			.values({ id: 'duplicate', providerId: 'steam', accountId: steamId, userId: session.user.id })
	);
});

test('callbacks cannot merge by email and explicit linking requires the same live owner', async () => {
	const secondId = '76561198000000003';
	config.steamLogin.allowedIds.push(secondId);
	const existing = await ctx.internalAdapter.createUser({
		name: 'OIDC user',
		email: 'oidc@users.invalid',
		emailVerified: true
	});
	await ctx.internalAdapter.createAccount({
		userId: existing.id,
		providerId: 'keycloak',
		accountId: 'synthetic-oidc-subject'
	});
	const session = await ctx.internalAdapter.createSession(existing.id);
	syntheticSession = { user: existing, session };
	const oidcCookie = cookieHeader(await begin('/test-fixture-only'));
	// Get a genuine signed BetterAuth session cookie through its own sign-in callback for the existing Steam user.
	const steamFlow = await challenge();
	const steamResult = await callback(assertion(steamFlow.returnTo), steamFlow.cookie);
	const steamCookie = cookieHeader(steamResult);
	const steamSession = await getSession(steamCookie);
	const flow = await challenge('/link/steam', oidcCookie);
	const missingSession = await callback(
		assertion(flow.returnTo, secondId),
		flow.cookie
			.split('; ')
			.filter((part) => !part.includes('session_token'))
			.join('; ')
	);
	assert.equal(missingSession.headers.get('location'), `${origin}/?steam=link_failed`);
	assert.equal(
		await ctx.internalAdapter.findAccountOwnerByKey({ providerId: 'steam', accountId: secondId }),
		null
	);
	const swapped = await challenge('/link/steam', oidcCookie);
	const wrongUserCookies = swapped.cookie
		.split('; ')
		.filter((part) => !part.includes('session_token'))
		.concat(steamCookie)
		.join('; ');
	assert.equal(
		(await callback(assertion(swapped.returnTo, secondId), wrongUserCookies)).headers.get(
			'location'
		),
		`${origin}/?steam=link_failed`
	);
	const proper = await challenge('/link/steam', oidcCookie);
	const result = await callback(assertion(proper.returnTo, secondId), proper.cookie);
	assert.equal(result.headers.get('location'), `${origin}/?steam=linked`);
	assert.equal(
		(await ctx.internalAdapter.findAccountOwnerByKey({ providerId: 'steam', accountId: secondId }))
			.user.id,
		existing.id
	);
	const newLogin = await challenge();
	const loggedIn = await callback(assertion(newLogin.returnTo, secondId), newLogin.cookie);
	assert.equal((await getSession(cookieHeader(loggedIn))).user.id, existing.id);
	assert.notEqual(steamSession.user.id, existing.id);
	const taken = await challenge('/link/steam', oidcCookie);
	assert.equal(
		(await callback(assertion(taken.returnTo), taken.cookie)).headers.get('location'),
		`${origin}/?steam=link_failed`
	);
	await ctx.internalAdapter.deleteSession(session.token);

	const collisionId = '76561198000000004';
	config.steamLogin.allowedIds.push(collisionId);
	await ctx.internalAdapter.createUser({
		name: 'Unrelated profile',
		email: `steam-${collisionId}@users.invalid`,
		emailVerified: true
	});
	const collision = await challenge();
	const rejected = await callback(assertion(collision.returnTo, collisionId), collision.cookie);
	assert.equal(rejected.headers.get('location'), `${origin}/login?steam=failed`);
	assert.equal(
		await ctx.internalAdapter.findAccountOwnerByKey({
			providerId: 'steam',
			accountId: collisionId
		}),
		null
	);
});

test('provider failures, malformed verification responses and concurrent replay fail closed', async () => {
	const returnTo = `${origin}/api/auth/steam/callback?state=synthetic`;
	for (const text of [
		'is_valid:true\n',
		'ns:http://specs.openid.net/auth/2.0\nis_valid:true\nis_valid:true\n',
		'x'.repeat(4097)
	]) {
		customResponse = text;
		await assert.rejects(verifySteamAssertion(assertion(returnTo), returnTo));
	}
	customResponse = undefined;
	networkFailure = true;
	const failing = await challenge();
	assert.equal(
		(await callback(assertion(failing.returnTo), failing.cookie)).headers.get('location'),
		`${origin}/login?steam=failed`
	);
	networkFailure = false;
	const flow = await challenge();
	const before = verifyCalls;
	const responses = await Promise.all([
		callback(assertion(flow.returnTo), flow.cookie),
		callback(assertion(flow.returnTo), flow.cookie)
	]);
	assert.deepEqual(
		responses.map((response) => response.headers.get('location')).sort(),
		[`${origin}/`, `${origin}/login?steam=failed`].sort()
	);
	assert.equal(verifyCalls, before + 1);
});

test('expired challenges and duplicate callback parameters fail without a provider request', async () => {
	const flow = await challenge();
	const state = new URL(flow.returnTo).searchParams.get('state');
	await db
		.update(verification)
		.set({ expiresAt: new Date(0) })
		.where(eq(verification.id, state));
	const before = verifyCalls;
	assert.equal(
		(await callback(assertion(flow.returnTo), flow.cookie)).headers.get('location'),
		`${origin}/login?steam=failed`
	);
	const duplicate = await challenge();
	const proof = assertion(duplicate.returnTo);
	proof.searchParams.append('state', new URL(duplicate.returnTo).searchParams.get('state'));
	assert.equal(
		(await callback(proof, duplicate.cookie)).headers.get('location'),
		`${origin}/login?steam=failed`
	);
	assert.equal(verifyCalls, before);
});

after(() => {
	db.$client.close();
	mock.restoreAll();
});
