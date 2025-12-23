import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';
import * as steamSchema from './server/steam/schema';
import { config } from '$lib/server/config';

const client = createClient({ url: config.database.url });
export const db = drizzle(client, { schema: { ...schema, ...steamSchema } });
