import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import {
	isOidcEnabled,
	isSteamLoginEnabled,
	getOidcProviderName,
	getOidcProviderId
} from '#lib/auth.ts';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.session) {
		redirect(302, '/');
	}

	return {
		steamLoginEnabled: isSteamLoginEnabled(),
		steamLoginFailed: url.searchParams.get('steam') === 'failed',
		oidcEnabled: isOidcEnabled(),
		oidcProviderName: getOidcProviderName(),
		oidcProviderId: getOidcProviderId()
	};
};
