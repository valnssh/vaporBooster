import { error } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '#lib/database.ts';
import { steamAccount } from './steam/schema';
import { config, isAuthEnabled } from './config';

export function requestOwnerId(locals: App.Locals): string | null {
	if (isAuthEnabled()) {
		if (!locals.user || !locals.session) error(401, 'Authentication required');
		return locals.user.id;
	}
	if (!config.general.allowAnonymous) error(503, 'Authentication is not configured');
	return null;
}

export function ownerFilter(ownerId: string | null) {
	return ownerId === null ? isNull(steamAccount.userId) : eq(steamAccount.userId, ownerId);
}

export async function requireAccount(locals: App.Locals, id: string) {
	const ownerId = requestOwnerId(locals);
	const account = await db.query.steamAccount.findFirst({
		where: and(eq(steamAccount.id, id), ownerFilter(ownerId))
	});
	if (!account) error(404, 'Account not found');
	return account;
}

export function formText(form: FormData, key: string, max: number, required = true) {
	const value = form.get(key);
	if (value === null && !required) return '';
	if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
		error(400, `Invalid ${key}`);
	}
	return value;
}
