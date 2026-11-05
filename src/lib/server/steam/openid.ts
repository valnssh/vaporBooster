import { randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { BetterAuthPlugin, GenericEndpointContext } from 'better-auth';
import { APIError, createAuthEndpoint, getAuthoritativeSessionFromCtx } from 'better-auth/api';
import { expireCookie, setSessionCookie } from 'better-auth/cookies';
import { db } from '#lib/database.ts';
import { verification } from '#lib/schema.ts';
import { config, isSteamLoginEnabled } from '#lib/server/config.ts';

const endpoint = 'https://steamcommunity.com/openid/login';
const namespace = 'http://specs.openid.net/auth/2.0'; // Protocol identifier, never fetched.
const identifierSelect = 'http://specs.openid.net/auth/2.0/identifier_select';
const challengeType = 'steam-openid';
const lifetime = 300_000;
const callbackPath = '/api/auth/steam/callback';

function callbackUrl(state: string) {
	return `${config.auth.origin}${callbackPath}?state=${state}`;
}

function invalid(): never {
	throw new Error('Steam authentication failed');
}

/** Only Valve's fixed HTTPS endpoint can validate an assertion. No discovery URL is fetched. */
export async function verifySteamAssertion(url: URL, returnTo: string, now = Date.now()) {
	if (url.search.length > 8192) invalid();
	const seen = new Set<string>();
	for (const [key, value] of url.searchParams) {
		if (seen.has(key) || value.length > 4096) invalid();
		seen.add(key);
	}
	const get = (key: string) => url.searchParams.get(`openid.${key}`);
	if (
		get('ns') !== namespace ||
		get('mode') !== 'id_res' ||
		get('op_endpoint') !== endpoint ||
		get('return_to') !== returnTo
	)
		invalid();
	const identity = get('claimed_id');
	const match = identity?.match(/^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/);
	if (!match || get('identity') !== identity || !get('sig') || !get('assoc_handle')) invalid();
	const signed = get('signed')?.split(',') || [];
	if (
		new Set(signed).size !== signed.length ||
		['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce', 'assoc_handle'].some(
			(name) => !signed.includes(name)
		)
	)
		invalid();
	const nonce = get('response_nonce');
	if (!nonce || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ.+$/.test(nonce)) invalid();
	const timestamp = Date.parse(nonce.slice(0, 20));
	if (!Number.isFinite(timestamp) || timestamp < now - lifetime || timestamp > now + 60_000)
		invalid();
	if (!config.steamLogin.allowedIds.includes(match[1])) invalid();
	const body = new URLSearchParams();
	for (const [key, value] of url.searchParams) if (key.startsWith('openid.')) body.set(key, value);
	body.set('openid.mode', 'check_authentication');
	const response = await fetch(endpoint, {
		method: 'POST',
		body,
		redirect: 'error',
		signal: AbortSignal.timeout(10_000)
	});
	if (!response.ok || !response.body) invalid();
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.length;
			if (size > 4096) invalid();
			chunks.push(value);
		}
	} finally {
		await reader.cancel();
	}
	const fields = new Map<string, string>();
	for (const line of Buffer.concat(chunks).toString('utf8').trim().split('\n')) {
		const colon = line.indexOf(':');
		if (colon < 1) invalid();
		const key = line.slice(0, colon);
		if (fields.has(key)) invalid();
		fields.set(key, line.slice(colon + 1).replace(/\r$/, ''));
	}
	if (fields.get('ns') !== namespace || fields.get('is_valid') !== 'true') invalid();
	return match[1];
}

function stateCookie(ctx: GenericEndpointContext) {
	return ctx.context.createAuthCookie('steam_state', { maxAge: lifetime / 1000 });
}

async function begin(ctx: GenericEndpointContext, link: boolean) {
	if (!isSteamLoginEnabled()) throw new APIError('NOT_FOUND');
	if (ctx.request?.headers.get('origin') !== config.auth.origin) throw new APIError('FORBIDDEN');
	const current = await getAuthoritativeSessionFromCtx(ctx);
	if (link && !current) throw new APIError('UNAUTHORIZED');
	if (!link && current) throw new APIError('BAD_REQUEST');
	await db
		.delete(verification)
		.where(and(eq(verification.identifier, challengeType), lt(verification.expiresAt, new Date())));
	const pending = await db
		.select({ id: verification.id })
		.from(verification)
		.where(eq(verification.identifier, challengeType))
		.limit(128);
	if (pending.length >= 128) throw new APIError('TOO_MANY_REQUESTS');
	const state = randomBytes(32).toString('base64url');
	await db.insert(verification).values({
		id: state,
		identifier: challengeType,
		value: JSON.stringify({ userId: link ? current!.user.id : null }),
		expiresAt: new Date(Date.now() + lifetime)
	});
	const cookie = stateCookie(ctx);
	await ctx.setSignedCookie(cookie.name, state, ctx.context.secret, cookie.attributes);
	const url = new URL(endpoint);
	url.search = new URLSearchParams({
		'openid.ns': namespace,
		'openid.mode': 'checkid_setup',
		'openid.claimed_id': identifierSelect,
		'openid.identity': identifierSelect,
		'openid.return_to': callbackUrl(state),
		'openid.realm': `${config.auth.origin}/`
	}).toString();
	return ctx.json({ url: url.href });
}

async function complete(ctx: GenericEndpointContext) {
	if (!isSteamLoginEnabled()) throw new APIError('NOT_FOUND');
	let target = `${config.auth.origin}/login?steam=failed`;
	try {
		const url = new URL(ctx.request!.url);
		const state = url.searchParams.get('state');
		const cookie = stateCookie(ctx);
		if (
			!state ||
			!/^[\w-]{43}$/.test(state) ||
			(await ctx.getSignedCookie(cookie.name, ctx.context.secret)) !== state
		)
			invalid();
		expireCookie(ctx, cookie);
		// DELETE ... RETURNING consumes the challenge atomically, including across processes.
		const [challenge] = await db
			.delete(verification)
			.where(
				and(
					eq(verification.id, state),
					eq(verification.identifier, challengeType),
					gt(verification.expiresAt, new Date())
				)
			)
			.returning();
		if (!challenge) invalid();
		const { userId } = JSON.parse(challenge.value) as { userId: string | null };
		const current = await getAuthoritativeSessionFromCtx(ctx);
		if (userId) {
			target = `${config.auth.origin}/?steam=link_failed`;
			if (current?.user.id !== userId) invalid();
		} else if (current) invalid();
		const steamId = await verifySteamAssertion(url, callbackUrl(state));
		const adapter = ctx.context.internalAdapter;
		const owner = await adapter.findAccountOwnerByKey({ providerId: 'steam', accountId: steamId });
		if (owner?.kind === 'orphaned') invalid();
		if (userId) {
			if (owner && owner.user.id !== userId) invalid();
			if (
				!owner &&
				!(await adapter.createAccount({ providerId: 'steam', accountId: steamId, userId }))
			)
				invalid();
			target = `${config.auth.origin}/?steam=linked`;
		} else {
			// Steam supplies no verified email. Never search or merge by email.
			const user =
				owner?.user ||
				(
					await adapter.createOAuthUser(
						{
							name: 'Steam user',
							email: `steam-${steamId}@users.invalid`,
							emailVerified: false
						},
						{ providerId: 'steam', accountId: steamId }
					)
				).user;
			const session = await adapter.createSession(user.id);
			if (!session) invalid();
			await setSessionCookie(ctx, { session, user });
			target = `${config.auth.origin}/`;
		}
	} catch {
		// Assertions, SteamIDs, cookies and provider errors must never enter logs.
	}
	throw ctx.redirect(target);
}

export function steamOpenId(): BetterAuthPlugin {
	return {
		id: 'steam-openid',
		endpoints: {
			steamSignIn: createAuthEndpoint(
				'/sign-in/steam',
				{ method: 'POST', requireHeaders: true },
				(ctx) => begin(ctx, false)
			),
			steamLink: createAuthEndpoint(
				'/link/steam',
				{ method: 'POST', requireHeaders: true },
				(ctx) => begin(ctx, true)
			),
			steamCallback: createAuthEndpoint(
				'/steam/callback',
				{ method: 'GET', requireHeaders: true },
				complete
			)
		},
		rateLimit: [
			{
				pathMatcher: (path) => path === '/sign-in/steam' || path === '/link/steam',
				window: 60,
				max: 10
			}
		]
	};
}
