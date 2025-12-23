import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	dialect: 'sqlite',
	schema: ['./src/lib/schema.ts', './src/lib/server/steam/schema.ts'],
	out: './drizzle',
	dbCredentials: {
		url: 'sqlite.db'
	}
});
