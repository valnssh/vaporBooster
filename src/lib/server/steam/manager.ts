import { db } from '$lib/database';
import { steamAccount, steamChatMessage } from '$lib/server/steam/schema';
import { SteamClient, type SteamClientStatus } from './client';
import { eq } from 'drizzle-orm';
import { encrypt, decrypt } from './crypto';

class SteamManager {
	private clients: Map<string, SteamClient> = new Map();

	constructor() {}

	public async init() {
		console.log('[SteamManager] Initializing...');
		const accounts = await db.select().from(steamAccount);

		for (const account of accounts) {
			if (account.status === 'BOOSTING' || account.status === 'ONLINE') {
				console.log(`[SteamManager] Auto-starting account: ${account.accountName}`);
				this.startAccount(account.id, account);
			}
		}
	}

	private setupClientListeners(id: string, client: SteamClient) {
		client.on('status', async (status: SteamClientStatus) => {
			const updates: Partial<typeof steamAccount.$inferInsert> = {
				status: status as
					| 'IDLE'
					| 'CONNECTING'
					| 'ONLINE'
					| 'BOOSTING'
					| 'ERROR'
					| 'LOGIN_REQUIRED'
					| 'WAITING_FOR_CODE'
			};

			if (status === 'BOOSTING') {
				updates.latestBoostStartedAt = new Date();
			} else if (status === 'DISCONNECTED' || status === 'ERROR' || status === 'ONLINE') {
				updates.latestBoostStartedAt = null;
			}

			await db.update(steamAccount).set(updates).where(eq(steamAccount.id, id));
		});

		client.on('refreshToken', async (key: string) => {
			console.log(`[SteamManager] Received refreshToken event for ${id}. Saving...`);
			const encrypted = encrypt(key);
			try {
				await db
					.update(steamAccount)
					.set({
						refreshToken: encrypted.content,
						iv: encrypted.iv,
						authTag: encrypted.authTag
					})
					.where(eq(steamAccount.id, id));
				console.log(`[SteamManager] Saved encrypted refresh token for account ${id}`);
			} catch (e) {
				console.error(`[SteamManager] Failed to save refresh token for ${id}`, e);
			}
		});

		client.on(
			'message',
			async (data: { steamId: string; message: string; direction?: 'incoming' | 'outgoing' }) => {
				try {
					await db.insert(steamChatMessage).values({
						accountId: id,
						steamIdOther: data.steamId,
						content: data.message,
						senderName: data.steamId, // TODO: Get actual name
						direction: data.direction ?? 'incoming'
					});
					console.log(
						`[SteamManager] Saved ${data.direction || 'incoming'} message for account ${id}`
					);
				} catch (e) {
					console.error(`[SteamManager] Failed to save message for ${id}`, e);
				}
			}
		);
	}

	public async startAccount(id: string, accountData?: any, ephemeralPassword?: string) {
		let account = accountData;
		if (!account) {
			const accounts = await db.select().from(steamAccount).where(eq(steamAccount.id, id));
			account = accounts[0];
		}
		if (!account) return;

		let client = this.clients.get(id);
		if (!client) {
			client = new SteamClient(account.accountName, { dataDirectory: null });
			this.setupClientListeners(id, client);
			this.clients.set(id, client);
		}

		await db.update(steamAccount).set({ status: 'CONNECTING' }).where(eq(steamAccount.id, id));

		try {
			let refreshToken: string | null = null;
			if (account.refreshToken && account.iv && account.authTag) {
				console.log(
					`[SteamManager] Found encrypted refresh token for ${account.accountName}. Decrypting...`
				);
				try {
					refreshToken = decrypt({
						content: account.refreshToken,
						iv: account.iv,
						authTag: account.authTag
					});
					console.log(`[SteamManager] Decryption successful.`);
				} catch (e) {
					console.error('[SteamManager] Failed to decrypt refresh token', e);
				}
			} else {
				console.log(
					`[SteamManager] No refresh token found for ${account.accountName} (or missing IV/Tag).`
				);
			}

			const passwordToUse = ephemeralPassword || null;

			if (refreshToken) {
				console.log(`[SteamManager] Logging in with Refresh Token...`);
			} else if (passwordToUse) {
				console.log(`[SteamManager] Logging in with Ephemeral Password...`);
			} else {
				console.error(`[SteamManager] No credentials available for ${account.accountName}.`);
				await db
					.update(steamAccount)
					.set({ status: 'LOGIN_REQUIRED' })
					.where(eq(steamAccount.id, id));
				return;
			}

			await client.login(passwordToUse, refreshToken, account.sharedSecret);

			if (account.personaState !== undefined) {
				client.setPersonaState(account.personaState);
			}

			if (account.autoReplyMessage) {
				client.setAutoReply(account.autoReplyMessage);
			}

			if (account.customTitle || (account.games && account.games.length > 0)) {
				client.setGames(account.games || [], account.customTitle || undefined);
			}
		} catch (error) {
			console.error(`[SteamManager] Failed to start account ${id}:`, error);
			await db.update(steamAccount).set({ status: 'ERROR' }).where(eq(steamAccount.id, id));
		}
	}

	public async stopAccount(id: string) {
		const client = this.clients.get(id);
		if (client) {
			client.logOff();
		}
	}

	public async stopAll() {
		console.log('[SteamManager] Stopping all accounts...');
		for (const [id, client] of this.clients.entries()) {
			console.log(`[SteamManager] Stopping account ${id}`);
			client.logOff();
		}
	}

	public async submitCode(id: string, code: string) {
		const client = this.clients.get(id);
		if (client) {
			client.provideGuardCode(code);
		}
	}

	public async updateConfig(
		id: string,
		config: {
			games: number[];
			customTitle?: string;
			personaState?: number;
			autoReplyMessage?: string | null;
		}
	) {
		const client = this.clients.get(id);

		await db
			.update(steamAccount)
			.set({
				games: config.games,
				customTitle: config.customTitle,
				personaState: config.personaState,
				autoReplyMessage: config.autoReplyMessage
			})
			.where(eq(steamAccount.id, id));

		if (client && client.status !== 'DISCONNECTED' && client.status !== 'ERROR') {
			console.log(`[SteamManager] Updating live config for ${id}`);
			if (config.personaState !== undefined) client.setPersonaState(config.personaState);
			if (config.autoReplyMessage !== undefined)
				client.setAutoReply(config.autoReplyMessage || null);
			client.setGames(config.games, config.customTitle);
		}
	}

	public getClientStatus(id: string): SteamClientStatus {
		return this.clients.get(id)?.getStatus() ?? 'DISCONNECTED';
	}

	public async getAllStatuses(): Promise<Record<string, SteamClientStatus>> {
		const statuses: Record<string, SteamClientStatus> = {};
		for (const [id, client] of this.clients.entries()) {
			statuses[id] = client.getStatus();
		}
		return statuses;
	}
}

export const steamManager = new SteamManager();
