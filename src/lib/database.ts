import { drizzle } from 'drizzle-orm/node-postgres';
import { building } from '$app/env';
import { createDatabasePool } from '../../scripts/postgres.mjs';
import * as schema from './schema';
import * as steamSchema from './server/steam/schema';
import { config } from '#lib/server/config.ts';

export const pool = createDatabasePool(
	{
		DATABASE_URL: config.database.url,
		DATABASE_CA_FILE: config.database.caFile
	},
	building
);
export const db = drizzle(pool, { schema: { ...schema, ...steamSchema } });
