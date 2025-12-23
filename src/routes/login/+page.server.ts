import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { isOidcEnabled, getOidcProviderName, getOidcProviderId } from '$lib/auth';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.session) {
		redirect(302, '/');
	}

	return {
		oidcEnabled: isOidcEnabled(),
		oidcProviderName: getOidcProviderName(),
		oidcProviderId: getOidcProviderId()
	};
};
