import { auth, isAuthEnabled } from '$lib/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { building } from '$app/environment';
import '$lib/server/setup';
import type { Handle } from '@sveltejs/kit';

import { createMockSession, createMockUser } from '$lib/server/mock';

export const handle: Handle = async ({ event, resolve }) => {
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

	return svelteKitHandler({ event, resolve, auth, building });
};
