import SteamUser from 'steam-user';
import SteamTotp from 'steam-totp';
import { EventEmitter } from 'node:events';
import { jwtDecode } from 'jwt-decode';

export type SteamClientStatus =
	| 'DISCONNECTED'
	| 'CONNECTING'
	| 'LOGGING_IN'
	| 'ONLINE'
	| 'BOOSTING'
	| 'ERROR'
	| 'WAITING_FOR_CODE';

export class SteamClient extends EventEmitter {
	public client: InstanceType<typeof SteamUser>;
	public status: SteamClientStatus = 'DISCONNECTED';
	private accountName: string;
	private games: number[] = [];
	private steamGuardCallback: ((code: string) => void) | null = null;
	private loginActive = false;
	private stopping = false;

	constructor(accountName: string, options?: { dataDirectory?: string | null }) {
		super();
		this.accountName = accountName;

		const steamUserOptions: any = {
			dataDirectory: null,
			// Also filter discovered CMs: protocol alone can still select raw TCP.
			webCompatibilityMode: true
		};
		if (options?.dataDirectory !== undefined) {
			steamUserOptions.dataDirectory = options.dataDirectory;
		}

		this.client = new SteamUser(steamUserOptions);

		this.setupListeners();
	}

	private setupListeners() {
		this.client.on('loggedOn', () => {
			if (!this.loginActive) return;
			console.log('[SteamClient] Logged on');
			this.status = 'ONLINE';
			this.client.setPersona(this.personaState);
			this.emit('status', 'ONLINE');
			this.setGames(this.games, this.customTitle);
		});

		this.client.on('refreshToken', (token: string) => {
			console.log('[SteamClient] Received new refresh token');
			this.emit('refreshToken', token);
		});

		this.client.on('error', () => {
			console.error('[SteamClient] Steam connection failed');
			this.loginActive = false;
			this.steamGuardCallback = null;
			this.status = 'ERROR';
			this.emit('status', 'ERROR');
		});

		this.client.on('disconnected', () => {
			this.steamGuardCallback = null;
			if (this.stopping) return;
			if (this.status !== 'ERROR') {
				// steam-user owns reconnect attempts after a transient disconnection.
				this.status = this.loginActive ? 'CONNECTING' : 'DISCONNECTED';
				this.emit('status', this.status);
			}
		});

		this.client.on('steamGuard', (_domain: string | null, callback: (code: string) => void) => {
			if (!this.loginActive) return;
			console.log('[SteamClient] Waiting for Steam Guard code');
			this.status = 'WAITING_FOR_CODE';
			this.steamGuardCallback = callback;
			this.emit('status', 'WAITING_FOR_CODE');
		});

		this.client.chat.on('friendMessage', async (incoming: any) => {
			if (!this.loginActive) return;
			const senderID = incoming.steamid_friend;
			const message = incoming.message;
			const steamId = senderID.getSteamID64();

			this.emit('message', { steamId, message });

			if (this.autoReplyMessage) {
				const reply = this.autoReplyMessage;
				try {
					const sent = await this.client.chat.sendFriendMessage(senderID, reply);
					this.emit('message', {
						steamId,
						message: sent.modified_message,
						direction: 'outgoing'
					});
				} catch {
					console.error('[SteamClient] Auto-reply was not accepted by Steam');
				}
			}
		});
	}

	public autoReplyMessage: string | null = null;
	public setAutoReply(message: string | null) {
		this.autoReplyMessage = message;
	}

	public async login(
		password?: string | null,
		refreshToken?: string | null,
		sharedSecret?: string | null
	) {
		if (this.isActive) return;

		const logOnOptions: any = {};

		if (refreshToken) {
			// Validate format here: steam-user parses it in an async nextTick that cannot be caught.
			const claims = jwtDecode<{ iss?: string; aud?: unknown; sub?: unknown }>(refreshToken);
			if (
				refreshToken.split('.').length !== 3 ||
				claims?.iss !== 'steam' ||
				!Array.isArray(claims.aud) ||
				!claims.aud.includes('client') ||
				typeof claims.sub !== 'string' ||
				!/^\d{17}$/.test(claims.sub)
			) {
				throw new Error('Invalid Steam client refresh token');
			}
			logOnOptions.refreshToken = refreshToken;
		} else {
			logOnOptions.accountName = this.accountName;
			if (password) {
				logOnOptions.password = password;
			}
		}

		if (sharedSecret && !refreshToken) {
			logOnOptions.twoFactorCode = SteamTotp.generateAuthCode(sharedSecret);
		}

		// Reserve synchronously: steam-user defers logOn until the next tick.
		this.loginActive = true;
		this.status = 'CONNECTING';
		this.emit('status', 'CONNECTING');
		try {
			this.client.logOn(logOnOptions);
		} catch (failure) {
			this.loginActive = false;
			throw failure;
		}
	}

	public get isActive() {
		return this.loginActive || this.stopping || !!this.client.steamID;
	}

	public provideGuardCode(code: string) {
		if (this.steamGuardCallback) {
			const callback = this.steamGuardCallback;
			this.steamGuardCallback = null;
			this.status = 'CONNECTING';
			this.emit('status', 'CONNECTING');
			callback(code);
		} else {
			console.warn('[SteamClient] Received code but no callback available');
		}
	}

	public async logOff() {
		this.stopping = true;
		this.loginActive = false;
		this.steamGuardCallback = null;
		// Let a queued logOn execute before cancelling it.
		await new Promise<void>((resolve) => setImmediate(resolve));
		if (this.client.steamID) {
			await new Promise<void>((resolve) => {
				this.client.once('disconnected', () => setImmediate(resolve));
				this.client.logOff();
			});
		} else {
			// Connecting logins do not emit disconnected when cancelled.
			this.client.logOff();
		}
		this.stopping = false;
		this.status = 'DISCONNECTED';
		this.emit('status', 'DISCONNECTED');
	}

	private customTitle?: string;
	private personaState: number = 7; // Invisible

	public setPersonaState(state: number) {
		this.personaState = state;
		if (this.client.steamID) {
			this.client.setPersona(state);
		}
	}

	public setGames(appIds: number[], customTitle?: string) {
		this.games = appIds;
		this.customTitle = customTitle;

		if (this.client.steamID) {
			const gamesToPlay: (number | string)[] = [...appIds];
			if (customTitle) {
				gamesToPlay.unshift(customTitle);
			}

			this.client.gamesPlayed(gamesToPlay);
			this.client.setPersona(this.personaState);

			if (gamesToPlay.length > 0) {
				this.status = 'BOOSTING';
				console.log('[SteamClient] Boosting started');
			} else {
				this.status = 'ONLINE';
				console.log('[SteamClient] Boosting stopped');
			}
			this.emit('status', this.status);
		}
	}

	public getStatus() {
		return this.status;
	}
}
