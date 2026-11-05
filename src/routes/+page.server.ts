import { fail, error } from '@sveltejs/kit';
import { db } from '#lib/database.ts';
import { steamAccount, steamChatMessage } from '#lib/server/steam/schema.ts';
import { steamManager } from '#lib/server/steam/manager.ts';
import { eq, and, desc, asc, sql } from 'drizzle-orm';
import type { PageServerLoad, Actions } from './$types';
import { requestOwnerId, ownerFilter, requireAccount, formText } from '#lib/server/access.ts';
import { startQrSession, takeQrResult, cancelQrSession } from '#lib/server/steam/session_store.ts';
import { encrypt, encryptSharedSecret } from '#lib/server/steam/crypto.ts';
import { isSteamLoginEnabled } from '#lib/server/config.ts';

export const load: PageServerLoad = async ({ locals, url }) => {
	const ownerId = requestOwnerId(locals);
	// Explicit projection: authentication material never becomes page data.
	const accounts = await db
		.select({
			id: steamAccount.id,
			accountName: steamAccount.accountName,
			customTitle: steamAccount.customTitle,
			personaState: steamAccount.personaState,
			autoReplyMessage: steamAccount.autoReplyMessage,
			games: steamAccount.games,
			latestBoostStartedAt: steamAccount.latestBoostStartedAt,
			status: steamAccount.status,
			createdAt: steamAccount.createdAt,
			updatedAt: steamAccount.updatedAt
		})
		.from(steamAccount)
		.where(ownerFilter(ownerId));
	const runtimeStatuses = await steamManager.getAllStatuses();
	const messages: Record<string, unknown[]> = {};
	for (const account of accounts) messages[account.id] = [];
	// The index supplies the latest 50 rows per account; history is never deleted.
	const recent = db
		.select()
		.from(steamChatMessage)
		.where(eq(steamChatMessage.accountId, steamAccount.id))
		.orderBy(desc(steamChatMessage.timestamp), desc(steamChatMessage.id))
		.limit(50)
		.as('recent');
	const rows = await db
		.select({
			accountId: steamAccount.id,
			message: {
				id: recent.id,
				accountId: recent.accountId,
				steamIdOther: recent.steamIdOther,
				senderName: recent.senderName,
				content: recent.content,
				direction: recent.direction,
				timestamp: recent.timestamp
			}
		})
		.from(steamAccount)
		.innerJoinLateral(recent, sql`true`)
		.where(ownerFilter(ownerId))
		.orderBy(asc(recent.timestamp), asc(recent.id));
	for (const row of rows) messages[row.accountId]?.push(row.message);
	return {
		steamLoginEnabled: isSteamLoginEnabled(),
		steamLinkStatus:
			url?.searchParams.get('steam') === 'linked'
				? 'linked'
				: url?.searchParams.get('steam') === 'link_failed'
					? 'failed'
					: null,
		user: locals.user,
		accounts: accounts.map((account) => ({
			...account,
			runtimeStatus: runtimeStatuses[account.id] || 'IDLE'
		})),
		messages
	};
};

export const actions: Actions = {
	addAccount: async ({ request, locals }) => {
		const userId = requestOwnerId(locals);
		const form = await request.formData();
		const accountName = formText(form, 'accountName', 64).trim();
		const password = formText(form, 'password', 256);
		const sharedSecret = formText(form, 'sharedSecret', 128, false).trim();
		if (sharedSecret && !/^[A-Za-z0-9+/]{27}=$/.test(sharedSecret)) {
			return fail(400, { error: 'Invalid Steam Guard shared secret' });
		}
		try {
			const accountId = crypto.randomUUID();
			await db.insert(steamAccount).values({
				id: accountId,
				accountName,
				userId,
				games: [],
				sharedSecret: sharedSecret ? encryptSharedSecret(sharedSecret) : null
			});
			await steamManager.startAccount(accountId, undefined, password);
		} catch {
			console.error('Unable to add Steam account');
			return fail(500, { error: 'Failed to create account' });
		}
	},
	deleteAccount: async ({ request, locals }) => {
		const form = await request.formData();
		const account = await requireAccount(locals, formText(form, 'id', 64));
		await steamManager.stopAccount(account.id);
		await db.delete(steamAccount).where(eq(steamAccount.id, account.id));
	},
	startAccount: async ({ request, locals }) => {
		const form = await request.formData();
		const account = await requireAccount(locals, formText(form, 'id', 64));
		await steamManager.startAccount(account.id, account);
	},
	stopAccount: async ({ request, locals }) => {
		const form = await request.formData();
		const account = await requireAccount(locals, formText(form, 'id', 64));
		await steamManager.stopAccount(account.id);
	},
	updateAccountConfig: async ({ request, locals }) => {
		const form = await request.formData();
		const account = await requireAccount(locals, formText(form, 'id', 64));
		const gamesText = formText(form, 'games', 4096, false);
		const customTitle = formText(form, 'customTitle', 128, false);
		const autoReplyMessage = formText(form, 'autoReplyMessage', 2000, false);
		const stateText = formText(form, 'personaState', 1, false);
		const personaState = stateText ? Number(stateText) : 1;
		if (!Number.isInteger(personaState) || personaState < 0 || personaState > 7)
			error(400, 'Invalid persona state');
		let values: unknown;
		try {
			values = gamesText.trim().startsWith('[')
				? JSON.parse(gamesText)
				: gamesText.trim()
					? gamesText.split(',').map(Number)
					: [];
		} catch {
			return fail(400, { error: 'Invalid game list' });
		}
		if (
			!Array.isArray(values) ||
			values.some((id) => !Number.isInteger(id) || id <= 0 || id > 0xffffffff)
		) {
			return fail(400, { error: 'Game IDs must be positive integers' });
		}
		const games = values as number[];
		const limit = customTitle ? 31 : 32;
		if (games.length > limit) return fail(400, { error: `Maximum ${limit} games allowed` });
		await steamManager.updateConfig(account.id, {
			games,
			customTitle,
			personaState,
			autoReplyMessage
		});
	},
	submitSteamCode: async ({ request, locals }) => {
		const form = await request.formData();
		const account = await requireAccount(locals, formText(form, 'id', 64));
		const code = formText(form, 'code', 5).toUpperCase();
		if (!/^[A-Z0-9]{5}$/.test(code)) return fail(400, { error: 'Invalid Steam Guard code' });
		await steamManager.submitCode(account.id, code);
	},
	deleteChat: async ({ request, locals }) => {
		const form = await request.formData();
		const account = await requireAccount(locals, formText(form, 'accountId', 64));
		const steamIdOther = formText(form, 'steamIdOther', 20);
		if (!/^\d{17}$/.test(steamIdOther)) return fail(400, { error: 'Invalid Steam ID' });
		await db
			.delete(steamChatMessage)
			.where(
				and(
					eq(steamChatMessage.accountId, account.id),
					eq(steamChatMessage.steamIdOther, steamIdOther)
				)
			);
	},
	startQrLogin: async ({ locals }) => {
		const ownerId = requestOwnerId(locals);
		return { success: true, ...(await startQrSession(ownerId)) };
	},
	pollQrLogin: async ({ request, locals }) => {
		const ownerId = requestOwnerId(locals);
		const form = await request.formData();
		const result = takeQrResult(formText(form, 'sessionId', 64), ownerId);
		if ('pending' in result) return result;
		if ('error' in result) return fail(result.status, { error: result.error });
		try {
			const accountId = crypto.randomUUID();
			const token = encrypt(result.refreshToken);
			await db.insert(steamAccount).values({
				id: accountId,
				accountName: result.accountName,
				userId: ownerId,
				refreshToken: token.content,
				iv: token.iv,
				authTag: token.authTag,
				games: []
			});
			await steamManager.startAccount(accountId);
			return { success: true, accountName: result.accountName };
		} catch {
			console.error('Unable to save QR-authenticated Steam account');
			return fail(500, { error: 'Failed to save account' });
		}
	},
	cancelQrLogin: async ({ request, locals }) => {
		const ownerId = requestOwnerId(locals);
		const form = await request.formData();
		cancelQrSession(formText(form, 'sessionId', 64), ownerId);
		return { success: true };
	}
};
