import { config } from '$lib/server/config';

export const createMockUser = () => ({
	name: config.general.localAccountName,
	email: 'vaporbooster@local',
	emailVerified: true,
	image: null,
	createdAt: new Date(),
	updatedAt: new Date(),
	id: 'mock-userid'
});

export const createMockSession = () => ({
	expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
	token: 'mock-token',
	createdAt: new Date(),
	updatedAt: new Date(),
	ipAddress: '127.0.0.1',
	userAgent: 'MockAgent',
	userId: 'mock-userid',
	id: 'mock-id'
});
