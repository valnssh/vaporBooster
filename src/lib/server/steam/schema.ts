import {
	pgTable,
	text,
	integer,
	timestamp,
	jsonb,
	bigint,
	index,
	uniqueIndex
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { relations } from 'drizzle-orm';
import { user } from '../../schema';

export const steamAccount = pgTable(
	'steam_account',
	{
		id: text('id').primaryKey(),
		accountName: text('account_name').notNull(),
		refreshToken: text('refresh_token'),
		iv: text('iv'),
		authTag: text('auth_tag'),
		sharedSecret: text('shared_secret'),
		customTitle: text('custom_title'),
		personaState: integer('persona_state').default(7), // 1 = Online, 7 = Invisible
		autoReplyMessage: text('auto_reply_message'),
		games: jsonb('games').$type<number[]>(),
		latestBoostStartedAt: timestamp('boost_started_at', { withTimezone: true, precision: 3 }),
		status: text('status', {
			enum: [
				'IDLE',
				'CONNECTING',
				'ONLINE',
				'BOOSTING',
				'ERROR',
				'LOGIN_REQUIRED',
				'WAITING_FOR_CODE'
			]
		})
			.default('IDLE')
			.notNull(),
		userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true, precision: 3 })
			.$defaultFn(() => new Date())
			.notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 })
			.$onUpdate(() => new Date())
			.notNull()
	},
	(table) => [
		index('steam_account_user_id_idx').on(table.userId),
		uniqueIndex('steam_account_owner_name_unique')
			.on(table.userId, table.accountName)
			.where(sql`${table.userId} IS NOT NULL`),
		uniqueIndex('steam_account_local_name_unique')
			.on(table.accountName)
			.where(sql`${table.userId} IS NULL`)
	]
);

export const steamAccountRelations = relations(steamAccount, ({ one }) => ({
	user: one(user, {
		fields: [steamAccount.userId],
		references: [user.id]
	})
}));

export const steamChatMessage = pgTable(
	'steam_chat_message',
	{
		id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
		accountId: text('account_id')
			.notNull()
			.references(() => steamAccount.id, { onDelete: 'cascade' }),
		steamIdOther: text('steam_id_other').notNull(),
		senderName: text('sender_name'),
		content: text('content').notNull(),
		direction: text('direction', { enum: ['incoming', 'outgoing'] })
			.notNull()
			.default('incoming'),
		timestamp: timestamp('timestamp', { withTimezone: true, precision: 3 }).notNull().defaultNow()
	},
	(table) => [
		index('steam_chat_account_time_idx').on(
			table.accountId,
			table.timestamp.desc().nullsFirst(),
			table.id.desc().nullsFirst()
		),
		index('steam_chat_conversation_idx').on(table.accountId, table.steamIdOther)
	]
);
