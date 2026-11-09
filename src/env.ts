import { defineEnvVars } from '@sveltejs/kit/env';

// Runtime-only private values. validateConfig still enforces the complete security configuration.
const optional = { schema: (value: string | undefined) => value };
export const variables = defineEnvVars({
	BETTER_AUTH_SECRET: optional,
	BETTER_AUTH_URL: optional,
	ORIGIN: optional,
	OIDC_PROVIDER_NAME: optional,
	OIDC_PROVIDER_ID: optional,
	OIDC_CLIENT_ID: optional,
	OIDC_CLIENT_SECRET: optional,
	OIDC_DISCOVERY_URL: optional,
	STEAM_LOGIN_ENABLED: optional,
	STEAM_ALLOWED_IDS: optional,
	DATABASE_URL: optional,
	DATABASE_CA_FILE: optional,
	LOCAL_ACCOUNT_NAME: optional,
	ALLOW_ANONYMOUS: optional,
	NODE_TLS_REJECT_UNAUTHORIZED: optional
});
