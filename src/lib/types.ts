/**
 * Shared type definitions for vaporBooster
 */

export type SteamAccountStatus =
	| 'IDLE'
	| 'DISCONNECTED'
	| 'CONNECTING'
	| 'LOGGING_IN'
	| 'ONLINE'
	| 'BOOSTING'
	| 'ERROR'
	| 'LOGIN_REQUIRED'
	| 'WAITING_FOR_CODE';

export interface SteamAccount {
	id: string;
	accountName: string;
	refreshToken?: string | null;
	iv?: string | null;
	authTag?: string | null;
	sharedSecret?: string | null;
	customTitle?: string | null;
	personaState?: number | null;
	autoReplyMessage?: string | null;
	games?: number[] | null;
	latestBoostStartedAt?: Date | number | null;
	status: SteamAccountStatus;
	userId?: string | null;
	createdAt: Date;
	updatedAt: Date;
	/** Runtime status from the SteamManager (may differ from DB status) */
	runtimeStatus?: SteamAccountStatus;
}

export interface ChatMessage {
	id: number;
	accountId: string;
	steamIdOther: string;
	senderName?: string | null;
	content: string;
	direction: 'incoming' | 'outgoing';
	timestamp: Date | number;
}

export interface ChatContact {
	steamIdOther: string;
	name: string;
	lastMessage: ChatMessage;
}
