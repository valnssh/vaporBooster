import { db } from '#lib/database.ts';
import { steamAccount, steamChatMessage } from '#lib/server/steam/schema.ts';
import { SteamClient, type SteamClientStatus } from './client';
import { eq } from 'drizzle-orm';
import { encrypt, decrypt, encryptSharedSecret, decryptSharedSecret } from './crypto';

class SteamManager {
	private clients: Map<string, SteamClient> = new Map();
	private operations = new Map<string, Promise<void>>();

	private async serialize(id: string, operation: () => Promise<void>) {
		const previous = this.operations.get(id) ?? Promise.resolve();
		const current = previous.catch(() => {}).then(operation);
		this.operations.set(id, current);
		try {
			await current;
		} finally {
			if (this.operations.get(id) === current) this.operations.delete(id);
		}
	}

	constructor() {}

	public async init() {
		console.log('[SteamManager] Initializing...');
		const accounts = await db.select().from(steamAccount);
		for (const account of accounts) {
			if (!account.sharedSecret) continue;
			let plaintext: string;
			try {
				plaintext = decryptSharedSecret(account.sharedSecret);
			} catch {
				// Reject the credential, without disabling login/deletion for every other account.
				account.status = 'LOGIN_REQUIRED';
				await db
					.update(steamAccount)
					.set({ status: 'LOGIN_REQUIRED' })
					.where(eq(steamAccount.id, account.id));
				continue;
			}
			if (!account.sharedSecret.startsWith('enc:')) {
				account.sharedSecret = encryptSharedSecret(plaintext);
				await db
					.update(steamAccount)
					.set({ sharedSecret: account.sharedSecret })
					.where(eq(steamAccount.id, account.id));
			}
		}

		for (const account of accounts) {
			if (account.status === 'BOOSTING' || account.status === 'ONLINE') {
				console.log('[SteamManager] Auto-starting Steam account');
				await this.startAccount(account.id, account);
			}
		}
	}

	private setupClientListeners(id: string, client: SteamClient) {
		client.on('status', async (status: SteamClientStatus) => {
			if (this.clients.get(id) !== client) return;
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

			try {
				await db.update(steamAccount).set(updates).where(eq(steamAccount.id, id));
			} catch {
				console.error('[SteamManager] Failed to save account status');
			}
		});

		client.on('refreshToken', async (key: string) => {
			if (this.clients.get(id) !== client) return;
			console.log('[SteamManager] Saving refreshed credentials');
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
				console.log('[SteamManager] Saved encrypted refresh token');
			} catch (e) {
				console.error('[SteamManager] Failed to save refresh token');
			}
		});

		client.on(
			'message',
			async (data: { steamId: string; message: string; direction?: 'incoming' | 'outgoing' }) => {
				if (this.clients.get(id) !== client) return;
				try {
					await db.insert(steamChatMessage).values({
						accountId: id,
						steamIdOther: data.steamId,
						content: data.message,
						senderName: data.steamId, // TODO: Get actual name
						direction: data.direction ?? 'incoming'
					});
					console.log('[SteamManager] Saved Steam chat message');
				} catch (e) {
					console.error('[SteamManager] Failed to save message');
				}
			}
		);
	}

	public async startAccount(id: string, accountData?: any, ephemeralPassword?: string) {
		return this.serialize(id, () => this.start(id, accountData, ephemeralPassword));
	}

	private async start(id: string, accountData?: any, ephemeralPassword?: string) {
		if (this.clients.get(id)?.isActive) return;
		let account = accountData;
		if (!account) {
			const accounts = await db.select().from(steamAccount).where(eq(steamAccount.id, id));
			account = accounts[0];
		}
		if (!account) return;

		const previous = this.clients.get(id);
		if (previous) {
			this.clients.delete(id);
			previous.removeAllListeners();
			await previous.logOff();
		}
		const client = new SteamClient(account.accountName, { dataDirectory: null });
		this.clients.set(id, client);
		this.setupClientListeners(id, client);

		await db.update(steamAccount).set({ status: 'CONNECTING' }).where(eq(steamAccount.id, id));

		try {
			let refreshToken: string | null = null;
			if (account.refreshToken && account.iv && account.authTag) {
				console.log('[SteamManager] Decrypting stored credentials');
				try {
					refreshToken = decrypt({
						content: account.refreshToken,
						iv: account.iv,
						authTag: account.authTag
					});
					console.log(`[SteamManager] Decryption successful.`);
				} catch (e) {
					console.error('[SteamManager] Failed to decrypt refresh token');
				}
			} else {
				console.log('[SteamManager] Stored credentials are unavailable');
			}

			const passwordToUse = ephemeralPassword || null;

			if (refreshToken) {
				console.log(`[SteamManager] Logging in with Refresh Token...`);
			} else if (passwordToUse) {
				console.log(`[SteamManager] Logging in with Ephemeral Password...`);
			} else {
				console.error('[SteamManager] Steam login requires credentials');
				await db
					.update(steamAccount)
					.set({ status: 'LOGIN_REQUIRED' })
					.where(eq(steamAccount.id, id));
				return;
			}

			await client.login(
				passwordToUse,
				refreshToken,
				!refreshToken && account.sharedSecret ? decryptSharedSecret(account.sharedSecret) : null
			);

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
			console.error('[SteamManager] Failed to start Steam account');
			await db.update(steamAccount).set({ status: 'ERROR' }).where(eq(steamAccount.id, id));
		}
	}

	public async stopAccount(id: string) {
		return this.serialize(id, async () => {
			await this.disconnect(id);
			await db
				.update(steamAccount)
				.set({ status: 'IDLE', latestBoostStartedAt: null })
				.where(eq(steamAccount.id, id));
		});
	}

	public async stopAll() {
		console.log('[SteamManager] Stopping all accounts...');
		// A process shutdown must preserve ONLINE/BOOSTING for automatic recovery.
		await Promise.all(
			[...this.clients.keys()].map((id) => this.serialize(id, () => this.disconnect(id)))
		);
	}

	private async disconnect(id: string) {
		const client = this.clients.get(id);
		this.clients.delete(id);
		if (client) {
			client.removeAllListeners();
			await client.logOff();
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
			console.log('[SteamManager] Updating Steam account configuration');
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
