import { createAuthClient } from 'better-auth/svelte';
import { genericOAuthClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
	plugins: [genericOAuthClient()]
});

export const { signIn, signOut, useSession } = authClient;
