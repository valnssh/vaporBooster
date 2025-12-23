import SteamUser from 'steam-user';
import SteamTotp from 'steam-totp';
import { EventEmitter } from 'node:events';

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

	constructor(accountName: string, options?: { dataDirectory?: string | null }) {
		super();
		this.accountName = accountName;

		const steamUserOptions: any = {
			dataDirectory: null
		};
		if (options?.dataDirectory !== undefined) {
			steamUserOptions.dataDirectory = options.dataDirectory;
		}

		this.client = new SteamUser(steamUserOptions);

		this.setupListeners();
	}

	private setupListeners() {
		this.client.on('loggedOn', () => {
			console.log(`[SteamClient] ${this.accountName} logged on.`);
			this.status = 'ONLINE';
			this.client.setPersona(this.personaState);
			this.emit('status', 'ONLINE');
			this.setGames(this.games, this.customTitle);
		});

		this.client.on('refreshToken', (token: string) => {
			console.log(`[SteamClient] ${this.accountName} received new refresh token.`);
			this.emit('refreshToken', token);
		});

		this.client.on('error', (err: Error) => {
			console.error(`[SteamClient] ${this.accountName} error:`, err);
			this.status = 'ERROR';
			this.emit('status', 'ERROR');
		});

		this.client.on('disconnected', (eresult: number, msg: string) => {
			console.log(`[SteamClient] ${this.accountName} disconnected: ${msg} (${eresult})`);
			if (this.status !== 'ERROR') {
				this.status = 'DISCONNECTED';
				this.emit('status', 'DISCONNECTED');
			}
		});

		this.client.on('steamGuard', (domain: string | null, callback: (code: string) => void) => {
			console.log(
				`[SteamClient] ${this.accountName} waiting for Steam Guard code ${domain ? `(${domain})` : ''}`
			);
			this.status = 'WAITING_FOR_CODE';
			this.steamGuardCallback = callback;
			this.emit('status', 'WAITING_FOR_CODE');
		});

		this.client.on('friendMessage', (senderID: any, message: string) => {
			const steamId = senderID.getSteamID64();
			console.log(`[SteamClient] ${this.accountName} received message from ${steamId}: ${message}`);

			this.emit('message', { steamId, message });

			if (this.autoReplyMessage) {
				console.log(`[SteamClient] ${this.accountName} sending auto-reply to ${steamId}`);
				this.client.chatMessage(senderID, this.autoReplyMessage);
				this.emit('message', { steamId, message: this.autoReplyMessage, direction: 'outgoing' });
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
		this.status = 'CONNECTING';
		this.emit('status', 'CONNECTING');

		const logOnOptions: any = {};

		if (refreshToken) {
			logOnOptions.refreshToken = refreshToken;
		} else {
			logOnOptions.accountName = this.accountName;
			if (password) {
				logOnOptions.password = password;
			}
		}

		if (sharedSecret) {
			logOnOptions.twoFactorCode = SteamTotp.generateAuthCode(sharedSecret);
		}

		this.client.logOn(logOnOptions);
	}

	public provideGuardCode(code: string) {
		if (this.steamGuardCallback) {
			this.steamGuardCallback(code);
			this.steamGuardCallback = null;
			this.status = 'CONNECTING';
			this.emit('status', 'CONNECTING');
		} else {
			console.warn(`[SteamClient] ${this.accountName} received code but no callback available.`);
		}
	}

	public logOff() {
		this.client.logOff();
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
				console.log(
					`[SteamClient] ${this.accountName} started boosting: ${gamesToPlay.join(', ')}`
				);
			} else {
				this.status = 'ONLINE';
				console.log(`[SteamClient] ${this.accountName} stopped boosting.`);
			}
			this.emit('status', this.status);
		}
	}

	public getStatus() {
		return this.status;
	}
}
