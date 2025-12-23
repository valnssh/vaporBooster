import type { LayoutServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { isAuthEnabled } from '$lib/auth';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	const publicPaths = ['/login', '/api/auth'];
	const isPublicPath = publicPaths.some((path) => url.pathname.startsWith(path));

	if (!locals.session && !isPublicPath) {
		redirect(302, '/login');
	}

	return {
		user: locals.user,
		session: locals.session,
		authEnabled: isAuthEnabled()
	};
};
