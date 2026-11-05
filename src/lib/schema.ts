import { relations, sql } from 'drizzle-orm';
import {
	pgTable,
	text,
	boolean,
	timestamp,
	integer,
	jsonb,
	index,
	uniqueIndex
} from 'drizzle-orm/pg-core';

export const sqliteImport = pgTable('_hoursbooster_sqlite_import', {
	id: integer('id').primaryKey(),
	report: jsonb('report').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).defaultNow().notNull()
});

export const user = pgTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: boolean('email_verified').default(false).notNull(),
	image: text('image'),
	createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull()
});

export const session = pgTable(
	'session',
	{
		id: text('id').primaryKey(),
		expiresAt: timestamp('expires_at', { withTimezone: true, precision: 3 }).notNull(),
		token: text('token').notNull().unique(),
		createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 })
			.$onUpdate(() => new Date())
			.notNull(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' })
	},
	(table) => [index('session_userId_idx').on(table.userId)]
);

export const account = pgTable(
	'account',
	{
		id: text('id').primaryKey(),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: timestamp('access_token_expires_at', {
			withTimezone: true,
			precision: 3
		}),
		refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
			withTimezone: true,
			precision: 3
		}),
		scope: text('scope'),
		password: text('password'),
		createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 })
			.$onUpdate(() => new Date())
			.notNull()
	},
	(table) => [
		index('account_userId_idx').on(table.userId),
		uniqueIndex('account_steam_identity_idx')
			.on(table.providerId, table.accountId)
			.where(sql`${table.providerId} = 'steam'`)
	]
);

export const verification = pgTable(
	'verification',
	{
		id: text('id').primaryKey(),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true, precision: 3 }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull()
	},
	(table) => [index('verification_identifier_idx').on(table.identifier)]
);

export const userRelations = relations(user, ({ many }) => ({
	sessions: many(session),
	accounts: many(account)
}));

export const sessionRelations = relations(session, ({ one }) => ({
	user: one(user, {
		fields: [session.userId],
		references: [user.id]
	})
}));

export const accountRelations = relations(account, ({ one }) => ({
	user: one(user, {
		fields: [account.userId],
		references: [user.id]
	})
}));
