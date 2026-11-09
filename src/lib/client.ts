import { createAuthClient } from 'better-auth/svelte';

export const authClient = createAuthClient();

export const { signIn, signOut, useSession } = authClient;
