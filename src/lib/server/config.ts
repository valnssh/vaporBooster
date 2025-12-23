import { env } from '$env/dynamic/private';

export const config = {
	auth: {
		secret: env.BETTER_AUTH_SECRET,
		url: env.BETTER_AUTH_URL
	},
	oidc: {
		providerName: env.OIDC_PROVIDER_NAME,
		providerId: env.OIDC_PROVIDER_ID,
		clientId: env.OIDC_CLIENT_ID,
		clientSecret: env.OIDC_CLIENT_SECRET,
		discoveryUrl: env.OIDC_DISCOVERY_URL
	},
	database: {
		url: env.DATABASE_URL || 'file:sqlite.db'
	},
	general: {
		localAccountName: env.LOCAL_ACCOUNT_NAME || 'Anonymous'
	}
};

export const isOidcEnabled = () => {
	const { providerName, providerId, clientId, clientSecret, discoveryUrl } = config.oidc;
	return !!(providerName && providerId && clientId && clientSecret && discoveryUrl);
};
