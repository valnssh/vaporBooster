import { error } from '@sveltejs/kit';
import { LoginSession, EAuthTokenPlatformType } from 'steam-session';
import { Agent } from 'node:https';

const TTL = 120_000;
const MAX_SESSIONS = 16;
const MAX_PER_OWNER = 2;

type Result =
	| { pending: true }
	| { accountName: string; refreshToken: string }
	| { status: 408 | 500; error: string };
type Entry = {
	ownerId: string | null;
	session: LoginSession;
	agent: Agent;
	result: Result;
	timer: ReturnType<typeof setTimeout>;
};
const sessions = new Map<string, Entry>();

function stopUpstream(entry: Entry) {
	try {
		entry.session.cancelLoginAttempt();
	} finally {
		entry.agent.destroy();
	}
}

function dispose(id: string) {
	const entry = sessions.get(id);
	if (!entry) return;
	sessions.delete(id);
	clearTimeout(entry.timer);
	stopUpstream(entry);
}

export async function startQrSession(ownerId: string | null) {
	if (
		sessions.size >= MAX_SESSIONS ||
		[...sessions.values()].filter((entry) => entry.ownerId === ownerId).length >= MAX_PER_OWNER
	) {
		error(429, 'Too many active QR logins');
	}
	const agent = new Agent({ keepAlive: true, minVersion: 'TLSv1.2', rejectUnauthorized: true });
	const session = new LoginSession(EAuthTokenPlatformType.SteamClient, { agent });
	session.loginTimeout = TTL;
	const id = crypto.randomUUID();
	const entry: Entry = {
		ownerId,
		session,
		agent,
		result: { pending: true },
		timer: setTimeout(() => dispose(id), TTL)
	};
	entry.timer.unref?.();
	// Reserve capacity and attach listeners before the upstream request starts.
	sessions.set(id, entry);
	session.on('authenticated', () => {
		if (sessions.get(id) !== entry || !('pending' in entry.result)) return;
		entry.result =
			session.refreshToken && session.accountName
				? { accountName: session.accountName, refreshToken: session.refreshToken }
				: { status: 500, error: 'Steam did not return login credentials' };
		stopUpstream(entry);
	});
	session.on('timeout', () => {
		if (sessions.get(id) === entry && 'pending' in entry.result) {
			entry.result = { status: 408, error: 'QR code expired' };
			stopUpstream(entry);
		}
	});
	// Keep a handler for late upstream errors after cancellation, without logging secrets.
	session.on('error', () => {
		if (sessions.get(id) === entry && 'pending' in entry.result) {
			entry.result = { status: 500, error: 'Steam QR login failed' };
			stopUpstream(entry);
		}
	});
	let challenge;
	try {
		challenge = await session.startWithQR();
	} catch {
		dispose(id);
		error(502, 'Unable to start Steam QR login');
	}
	if (sessions.get(id) !== entry) {
		stopUpstream(entry);
		error(408, 'QR login expired');
	}
	return { sessionId: id, qrUrl: challenge.qrChallengeUrl };
}

function ownedEntry(id: string, ownerId: string | null) {
	const entry = sessions.get(id);
	if (!entry || entry.ownerId !== ownerId) error(404, 'QR session not found or expired');
	return entry;
}

export function takeQrResult(id: string, ownerId: string | null): Result {
	const entry = ownedEntry(id, ownerId);
	const result = entry.result;
	// Consumption is synchronous: concurrent polls cannot save the same token twice.
	if (!('pending' in result)) dispose(id);
	return result;
}

export function cancelQrSession(id: string, ownerId: string | null) {
	ownedEntry(id, ownerId);
	dispose(id);
}

export function clearQrSessions() {
	for (const id of sessions.keys()) dispose(id);
}
