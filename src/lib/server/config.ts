import * as env from '$app/env/private';
import { validateHttpsEnvironment } from '../../../scripts/https.mjs';

export const config = {
	auth: {
		secret: env.BETTER_AUTH_SECRET,
		url: env.BETTER_AUTH_URL,
		origin: env.ORIGIN
	},
	oidc: {
		providerName: env.OIDC_PROVIDER_NAME,
		providerId: env.OIDC_PROVIDER_ID,
		clientId: env.OIDC_CLIENT_ID,
		clientSecret: env.OIDC_CLIENT_SECRET,
		discoveryUrl: env.OIDC_DISCOVERY_URL
	},
	steamLogin: {
		enabled: env.STEAM_LOGIN_ENABLED === 'true',
		allowedIds: (env.STEAM_ALLOWED_IDS || '')
			.split(',')
			.map((id) => id.trim())
			.filter(Boolean)
	},
	database: {
		url: env.DATABASE_URL || 'file:sqlite.db'
	},
	general: {
		localAccountName: env.LOCAL_ACCOUNT_NAME || 'Anonymous',
		allowAnonymous: env.ALLOW_ANONYMOUS === 'true'
	}
};

export const isOidcEnabled = () => {
	const { providerId, clientId, clientSecret, discoveryUrl } = config.oidc;
	return !!(providerId && clientId && clientSecret && discoveryUrl);
};

export const isSteamLoginEnabled = () => config.steamLogin.enabled;
export const isAuthEnabled = () => isOidcEnabled() || isSteamLoginEnabled();

export function validateConfig() {
	const origin = validateHttpsEnvironment({
		ORIGIN: config.auth.origin,
		BETTER_AUTH_URL: config.auth.url,
		NODE_TLS_REJECT_UNAUTHORIZED: env.NODE_TLS_REJECT_UNAUTHORIZED
	});
	config.auth.origin = origin;
	config.auth.url = origin;
	if (!config.auth.secret || config.auth.secret.length < 32) {
		throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters');
	}
	if (config.oidc.providerId === 'steam') {
		throw new Error('OIDC_PROVIDER_ID steam is reserved for Steam OpenID');
	}
	if (Object.values(config.oidc).some(Boolean) && !isOidcEnabled()) {
		throw new Error('Incomplete OIDC configuration');
	}
	if (env.STEAM_LOGIN_ENABLED && !['true', 'false'].includes(env.STEAM_LOGIN_ENABLED)) {
		throw new Error('STEAM_LOGIN_ENABLED must be true or false');
	}
	if (
		config.steamLogin.allowedIds.some((id) => !/^\d{17}$/.test(id)) ||
		(isSteamLoginEnabled() && !config.steamLogin.allowedIds.length)
	) {
		throw new Error(
			'Steam panel login requires an explicit STEAM_ALLOWED_IDS allowlist of SteamID64 values'
		);
	}
	if (!isAuthEnabled() && !config.general.allowAnonymous) {
		throw new Error(
			'Configure OIDC or Steam login, or explicitly enable ALLOW_ANONYMOUS for local use'
		);
	}
	for (const value of [config.oidc.discoveryUrl].filter(Boolean)) {
		const url = new URL(value!);
		if (url.protocol !== 'https:' || url.username || url.password) {
			throw new Error('OIDC discovery requires HTTPS without URL credentials');
		}
	}
}
