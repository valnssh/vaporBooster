import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/database';
import { steamAccount, steamChatMessage } from '$lib/server/steam/schema';
import { steamManager } from '$lib/server/steam/manager';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { isOidcEnabled } from '$lib/auth';
import type { PageServerLoad, Actions } from './$types';
import { LoginSession, EAuthTokenPlatformType } from 'steam-session';
import { qrSessions } from '$lib/server/steam/session_store';
import { encrypt } from '$lib/server/steam/crypto';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;

	let accounts;

	if (isOidcEnabled()) {
		if (!user) return { accounts: [], messages: {} as Record<string, any[]> };
		accounts = await db.select().from(steamAccount).where(eq(steamAccount.userId, user.id));
	} else {
		accounts = await db.select().from(steamAccount).where(isNull(steamAccount.userId));
	}

	const runtimeStatuses = await steamManager.getAllStatuses();

	const accountsWithStatus = accounts.map((acc) => ({
		...acc,
		runtimeStatus: runtimeStatuses[acc.id] || 'IDLE'
	}));

	const messagesMap: Record<string, any[]> = {};
	for (const acc of accounts) {
		const msgs = await db
			.select()
			.from(steamChatMessage)
			.where(eq(steamChatMessage.accountId, acc.id))
			.orderBy(desc(steamChatMessage.timestamp))
			.limit(50);
		messagesMap[acc.id] = msgs.reverse();
	}

	return {
		user,
		accounts: accountsWithStatus,
		messages: messagesMap
	};
};

export const actions: Actions = {
	addAccount: async ({ request, locals }) => {
		const formData = await request.formData();
		const accountName = formData.get('accountName') as string;
		const password = formData.get('password') as string;
		const sharedSecret = formData.get('sharedSecret') as string | null;
		const oidc = isOidcEnabled();
		const user = locals.user;

		if (!accountName || !password) {
			return fail(400, { missing: true });
		}

		if (oidc && !user) {
			return fail(401, { unauthorized: true });
		}

		try {
			const userId = oidc && user ? user.id : null;
			const accountId = crypto.randomUUID();
			await db.insert(steamAccount).values({
				id: accountId,
				accountName,
				sharedSecret: sharedSecret || null,
				userId,
				games: []
			});

			const newAccount = await db.query.steamAccount.findFirst({
				where: eq(steamAccount.id, accountId)
			});

			if (newAccount) {
				steamManager.startAccount(accountId, newAccount, password);
			}
		} catch (error) {
			console.error(error);
			return fail(500, { error: 'Failed to create account' });
		}
	},

	deleteAccount: async ({ request, locals }) => {
		const formData = await request.formData();
		const id = formData.get('id') as string;
		const oidc = isOidcEnabled();
		const user = locals.user;

		if (oidc && !user) return fail(401);

		const account = await db.query.steamAccount.findFirst({
			where: eq(steamAccount.id, id)
		});

		if (!account) return fail(404);

		if (oidc) {
			if (account.userId !== user!.id) return fail(403);
		} else {
			if (account.userId !== null) return fail(403);
		}

		await steamManager.stopAccount(id);
		await db.delete(steamAccount).where(eq(steamAccount.id, id));
	},

	startAccount: async ({ request, locals }) => {
		const formData = await request.formData();
		const id = formData.get('id') as string;
		const account = await db.query.steamAccount.findFirst({
			where: eq(steamAccount.id, id)
		});
		if (!account) return fail(404);

		await steamManager.startAccount(account.id, account);
	},

	stopAccount: async ({ request }) => {
		const formData = await request.formData();
		const id = formData.get('id') as string;
		await steamManager.stopAccount(id);
	},

	updateAccountConfig: async ({ request }) => {
		const formData = await request.formData();
		const id = formData.get('id') as string;
		const gamesJson = formData.get('games') as string;
		const customTitle = formData.get('customTitle') as string;
		const personaStateStr = formData.get('personaState') as string;

		let personaState = 1;
		if (personaStateStr) {
			const parsed = parseInt(personaStateStr);
			if (!isNaN(parsed)) personaState = parsed;
		}

		let games: number[] = [];
		try {
			if (gamesJson.trim().startsWith('[')) {
				games = JSON.parse(gamesJson).map(Number);
			} else {
				games = gamesJson
					.split(',')
					.map((s) => Number(s.trim()))
					.filter((n) => !isNaN(n));
			}
		} catch (e) {
			games = [];
		}

		const limit = customTitle ? 31 : 32;
		if (games.length > limit) {
			return fail(400, {
				error: `Too many games selected. Maximum allowed is ${limit} when "Boosting Message" is ${customTitle ? 'enabled' : 'disabled'}.`
			});
		}

		const autoReplyMessage = formData.get('autoReplyMessage') as string | null;

		await steamManager.updateConfig(id, {
			games,
			customTitle,
			personaState,
			autoReplyMessage
		});
	},

	submitSteamCode: async ({ request }) => {
		const formData = await request.formData();
		const id = formData.get('id') as string;
		const code = formData.get('code') as string;

		await steamManager.submitCode(id, code);
	},

	deleteChat: async ({ request, locals }) => {
		const formData = await request.formData();
		const accountId = formData.get('accountId') as string;
		const steamIdOther = formData.get('steamIdOther') as string;
		const oidc = isOidcEnabled();
		const user = locals.user;

		if (!accountId || !steamIdOther) return fail(400, { missing: true });

		const account = await db.query.steamAccount.findFirst({
			where: eq(steamAccount.id, accountId)
		});

		if (!account) return fail(404);

		if (oidc) {
			if (!user || account.userId !== user.id) return fail(403);
		} else {
			if (account.userId !== null) return fail(403);
		}

		await db
			.delete(steamChatMessage)
			.where(
				and(
					eq(steamChatMessage.accountId, accountId),
					eq(steamChatMessage.steamIdOther, steamIdOther)
				)
			);
	},

	startQrLogin: async () => {
		try {
			const session = new LoginSession(EAuthTokenPlatformType.SteamClient);
			const challenge = await session.startWithQR();
			const sessionId = crypto.randomUUID();

			qrSessions.set(sessionId, session);

			return {
				success: true,
				qrUrl: (challenge as any).qrChallengeUrl,
				sessionId
			};
		} catch (error) {
			console.error('Failed to start QR login:', error);
			return fail(500, { error: 'Failed to start QR login' });
		}
	},

	pollQrLogin: async ({ request, locals }) => {
		const formData = await request.formData();
		const sessionId = formData.get('sessionId') as string;
		const oidc = isOidcEnabled();
		const user = locals.user;

		if (!sessionId) return fail(400, { missing: true });

		const session = qrSessions.get(sessionId);
		if (!session) {
			return fail(404, { error: 'Session not found or expired' });
		}

		try {
			return await new Promise((resolve) => {
				let resolved = false;

				const cleanup = () => {
					session.removeAllListeners('authenticated');
					session.removeAllListeners('timeout');
					session.removeAllListeners('error');
				};

				const onAuth = async () => {
					if (resolved) return;
					resolved = true;
					cleanup();
					qrSessions.delete(sessionId);

					try {
						const refreshToken = session.refreshToken;
						const accountName = session.accountName || 'Unknown';

						if (!refreshToken) {
							resolve(fail(500, { error: 'No refresh token received' }));
							return;
						}

						const userId = oidc && user ? user.id : null;
						const accountId = crypto.randomUUID();

						const encrypted = encrypt(refreshToken);

						await db.insert(steamAccount).values({
							id: accountId,
							accountName,
							refreshToken: encrypted.content,
							iv: encrypted.iv,
							authTag: encrypted.authTag,
							userId,
							games: []
						});

						const newAccount = await db.query.steamAccount.findFirst({
							where: eq(steamAccount.id, accountId)
						});

						if (newAccount) {
							steamManager.startAccount(accountId, newAccount);
						}

						resolve({ success: true, accountName });
					} catch (e) {
						console.error('Error saving account:', e);
						resolve(fail(500, { error: 'Failed to save account' }));
					}
				};

				const onError = (err: any) => {
					if (resolved) return;
					resolved = true;
					cleanup();
					qrSessions.delete(sessionId);
					resolve(fail(500, { error: err.message || 'QR Login Failed' }));
				};

				const onTimeout = () => {
					if (resolved) return;
					resolved = true;
					cleanup();
					qrSessions.delete(sessionId);
					resolve(fail(408, { error: 'QR Code Timed Out' }));
				};

				session.on('authenticated', onAuth);
				session.on('timeout', onTimeout);
				session.on('error', onError);

				if (session.refreshToken) {
					onAuth();
				}

				setTimeout(() => {
					if (!resolved) {
						resolved = true;
						cleanup();
						resolve({ pending: true });
					}
				}, 2000);
			});
		} catch (error) {
			console.error(error);
			return fail(500, { error: 'Poll failed' });
		}
	}
};
