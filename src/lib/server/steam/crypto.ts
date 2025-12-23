import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '$lib/server/config';

const ALGORITHM = 'aes-256-gcm';
// Ensure key is 32 bytes. If config.auth.secret is short, we pad or hash it.
// For simplicity assuming reasonably strong secret or hashing it.
// Ideally use a stretched key or specific separate secret.
const KEY = Buffer.from((config.auth.secret ?? '').padEnd(32).slice(0, 32)); // Simple padding for safety

export const encrypt = (text: string) => {
	const iv = randomBytes(16);
	const cipher = createCipheriv(ALGORITHM, KEY, iv);
	let encrypted = cipher.update(text, 'utf8', 'hex');
	encrypted += cipher.final('hex');
	const authTag = cipher.getAuthTag().toString('hex');

	return {
		iv: iv.toString('hex'),
		content: encrypted,
		authTag
	};
};

export const decrypt = (hash: { iv: string; content: string; authTag: string }) => {
	const decipher = createDecipheriv(ALGORITHM, KEY, Buffer.from(hash.iv, 'hex'));
	decipher.setAuthTag(Buffer.from(hash.authTag, 'hex'));
	let decrypted = decipher.update(hash.content, 'hex', 'utf8');
	decrypted += decipher.final('utf8');
	return decrypted;
};
