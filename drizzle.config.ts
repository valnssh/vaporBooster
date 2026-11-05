import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	dialect: 'postgresql',
	schema: ['./src/lib/schema.ts', './src/lib/server/steam/schema.ts'],
	out: './drizzle/postgresql',
	dbCredentials: {
		url: process.env.DATABASE_URL || ''
	}
});
