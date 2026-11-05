import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '#lib/server/config.ts';

const ALGORITHM = 'aes-256-gcm';
function key(legacy = false) {
	const secret = config.auth.secret;
	if (!secret || secret.length < 32) throw new Error('A strong BETTER_AUTH_SECRET is required');
	// Preserve the exact original derivation only for reading existing token rows.
	return legacy ? Buffer.from(secret.slice(0, 32)) : createHash('sha256').update(secret).digest();
}

export const encrypt = (text: string) => {
	const iv = randomBytes(16);
	const cipher = createCipheriv(ALGORITHM, key(), iv);
	let encrypted = cipher.update(text, 'utf8', 'hex');
	encrypted += cipher.final('hex');
	const authTag = cipher.getAuthTag().toString('hex');

	return {
		iv: iv.toString('hex'),
		content: `v2:${encrypted}`,
		authTag
	};
};

export const decrypt = (hash: { iv: string; content: string; authTag: string }) => {
	const current = hash.content.startsWith('v2:');
	const content = current ? hash.content.slice(3) : hash.content;
	if (
		!/^[a-f0-9]+$/i.test(content) ||
		content.length % 2 ||
		!/^[a-f0-9]{32}$/i.test(hash.iv) ||
		!/^[a-f0-9]{32}$/i.test(hash.authTag)
	) {
		throw new Error('Invalid encrypted credential');
	}
	const decipher = createDecipheriv(ALGORITHM, key(!current), Buffer.from(hash.iv, 'hex'));
	decipher.setAuthTag(Buffer.from(hash.authTag, 'hex'));
	let decrypted = decipher.update(content, 'hex', 'utf8');
	decrypted += decipher.final('utf8');
	return decrypted;
};

export const encryptSharedSecret = (secret: string) => `enc:v1:${JSON.stringify(encrypt(secret))}`;

export function decryptSharedSecret(value: string): string {
	if (!value.startsWith('enc:')) return value; // Legacy plaintext is migrated during startup.
	if (!value.startsWith('enc:v1:')) throw new Error('Unsupported credential version');
	const data = JSON.parse(value.slice(7));
	if (
		!data ||
		typeof data.content !== 'string' ||
		typeof data.iv !== 'string' ||
		typeof data.authTag !== 'string'
	) {
		throw new Error('Invalid encrypted credential');
	}
	return decrypt(data);
}
