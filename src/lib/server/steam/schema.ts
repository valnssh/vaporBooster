import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { relations } from 'drizzle-orm';
import { user } from '../../schema';

export const steamAccount = sqliteTable(
	'steam_account',
	{
		id: text('id').primaryKey(),
		accountName: text('account_name').notNull().unique(),
		refreshToken: text('refresh_token'),
		iv: text('iv'),
		authTag: text('auth_tag'),
		sharedSecret: text('shared_secret'),
		customTitle: text('custom_title'),
		personaState: integer('persona_state').default(7), // 1 = Online, 7 = Invisible
		autoReplyMessage: text('auto_reply_message'),
		games: text('games', { mode: 'json' }).$type<number[]>(),
		latestBoostStartedAt: integer('boost_started_at', { mode: 'timestamp_ms' }),
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
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.$defaultFn(() => new Date())
			.notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.$onUpdate(() => new Date())
			.notNull()
	},
	(table) => [index('steam_account_user_id_idx').on(table.userId)]
);

export const steamAccountRelations = relations(steamAccount, ({ one }) => ({
	user: one(user, {
		fields: [steamAccount.userId],
		references: [user.id]
	})
}));

export const steamChatMessage = sqliteTable('steam_chat_message', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	accountId: text('account_id')
		.notNull()
		.references(() => steamAccount.id, { onDelete: 'cascade' }),
	steamIdOther: text('steam_id_other').notNull(),
	senderName: text('sender_name'),
	content: text('content').notNull(),
	direction: text('direction', { enum: ['incoming', 'outgoing'] })
		.notNull()
		.default('incoming'),
	timestamp: integer('timestamp', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`)
});
