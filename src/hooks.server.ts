import { auth, isAuthEnabled } from '#lib/auth.ts';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { building } from '$app/env';
import { ready } from '#lib/server/setup.ts';
import type { Handle } from '@sveltejs/kit/hooks';
import { config } from '#lib/server/config.ts';
import { error } from '@sveltejs/kit';

import { createMockSession, createMockUser } from '#lib/server/mock.ts';

export const handle: Handle = async ({ event, resolve }) => {
	if (!building && event.url.protocol !== 'https:') error(400, 'HTTPS is required');
	if (!building && event.url.origin !== config.auth.origin) error(421, 'Unexpected request origin');
	await ready;
	const session = await auth.api.getSession({
		headers: event.request.headers
	});

	if (isAuthEnabled()) {
		if (session) {
			event.locals.session = session.session;
			event.locals.user = session.user;
		}
	} else {
		event.locals.user = createMockUser() as any;
		event.locals.session = createMockSession() as any;
	}

	const response = await svelteKitHandler({ event, resolve, auth, building });
	response.headers.set('Cache-Control', 'private, no-store');
	response.headers.set('Referrer-Policy', 'no-referrer');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Strict-Transport-Security', 'max-age=31536000');
	return response;
};
