import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { genericOAuth } from 'better-auth/plugins';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { db } from './database';
import { config, isOidcEnabled as isOidcConfigured } from '$lib/server/config';

const oidcConfig = isOidcConfigured()
	? [
			{
				providerId: config.oidc.providerId!,
				clientId: config.oidc.clientId!,
				clientSecret: config.oidc.clientSecret!,
				discoveryUrl: config.oidc.discoveryUrl!,
				scopes: ['openid', 'profile', 'email']
			}
		]
	: [];

export const isOidcEnabled = isOidcConfigured;
export const getOidcProviderName = () => config.oidc.providerName || null;
export const getOidcProviderId = () => config.oidc.providerId || null;

export const isAuthEnabled = () => isOidcEnabled();

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: 'sqlite'
	}),
	secret: config.auth.secret,
	baseURL: config.auth.url,
	plugins: [genericOAuth({ config: oidcConfig }), sveltekitCookies(getRequestEvent)]
});
