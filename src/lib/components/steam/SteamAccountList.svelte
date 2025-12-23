<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/icons/Icon.svelte';
	import type { SteamAccount } from '$lib/types';

	interface Props {
		accounts: SteamAccount[];
		onOpenSettings?: (account: SteamAccount) => void;
		onOpenMessages?: (account: SteamAccount) => void;
		onDeleteRequest?: (account: SteamAccount) => void;
		onAuthRequest?: (id: string) => void;
	}

	let { accounts, onOpenSettings, onOpenMessages, onDeleteRequest, onAuthRequest }: Props =
		$props();

	const getStatusStyle = (status: string) => {
		switch (status) {
			case 'BOOSTING':
				return {
					color: 'text-[var(--success-light)]',
					bg: 'bg-[var(--success)]/20',
					dotColor: 'var(--success-light)'
				};
			case 'ONLINE':
				return {
					color: 'text-[var(--secondary)]',
					bg: 'bg-[var(--secondary)]/20',
					dotColor: 'var(--secondary)'
				};
			case 'ERROR':
				return {
					color: 'text-[var(--error-light)]',
					bg: 'bg-[var(--error)]/20',
					dotColor: 'var(--error-light)'
				};
			case 'CONNECTING':
				return {
					color: 'text-[var(--primary-light)]',
					bg: 'bg-[var(--primary)]/20',
					dotColor: 'var(--primary-light)'
				};
			case 'WAITING_FOR_CODE':
				return {
					color: 'text-[var(--warning)]',
					bg: 'bg-[var(--warning)]/20',
					dotColor: 'var(--warning)'
				};
			default:
				return {
					color: 'text-[var(--text-muted)]',
					bg: 'bg-[var(--surface-dark)]/20',
					dotColor: 'var(--text-muted)'
				};
		}
	};

	let now = $state(new Date());

	$effect(() => {
		const interval = setInterval(() => {
			now = new Date();
		}, 1000);
		return () => clearInterval(interval);
	});

	function getBoostDuration(startDate: string | Date | number | null) {
		if (!startDate) return '00:00:00';
		const start = new Date(startDate).getTime();
		const current = now.getTime();
		const diff = Math.max(0, current - start);

		const seconds = Math.floor((diff / 1000) % 60);
		const minutes = Math.floor((diff / (1000 * 60)) % 60);
		const hours = Math.floor(diff / (1000 * 60 * 60));

		return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
	}
</script>

<div class="steam-account-list flex flex-col gap-3">
	{#each accounts as account, i (account.id)}
		{@const status = account.runtimeStatus ?? 'IDLE'}
		{@const statusStyle = getStatusStyle(status)}

		<div
			class="account-card rounded-xl border border-[var(--primary)]/20 hover:border-[var(--primary)]/40 transition-all animate-slide-up"
			style="animation-delay: {i * 50}ms; background: var(--bg-dark);"
		>
			<div class="flex items-center justify-between p-4 gap-4">
				<div class="flex items-center gap-4 min-w-0 flex-1">
					<div class="relative group/status flex items-center justify-center">
						<div
							class="w-3 h-3 rounded-full cursor-help transition-all duration-300 group-hover/status:scale-110"
							style="background-color: {statusStyle.dotColor}; box-shadow: 0 0 10px {statusStyle.dotColor};"
						></div>
						<div
							class="absolute right-full mr-3 px-2 py-1 bg-[#1a141d] border border-[var(--primary)]/30 rounded text-[10px] font-bold tracking-wider z-50 whitespace-nowrap opacity-0 invisible group-hover/status:opacity-100 group-hover/status:visible transition-all duration-200 pointer-events-none translate-x-[10px] group-hover/status:translate-x-0 {statusStyle.color} shadow-lg top-1/2 -translate-y-1/2"
						>
							{status}
						</div>
					</div>

					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<h3 class="font-bold text-[var(--text-primary)] truncate" title={account.accountName}>
								{account.accountName}
							</h3>
						</div>
						{#if status === 'WAITING_FOR_CODE'}
							<p class="text-sm text-[var(--warning)]">Steam Guard Required</p>
						{:else if status === 'BOOSTING' && account.latestBoostStartedAt}
							<p class="text-sm text-[var(--success-light)] font-mono">
								{getBoostDuration(account.latestBoostStartedAt)}
							</p>
						{:else if account.customTitle || (account.games && account.games.length > 0)}
							<p class="text-sm text-[var(--text-muted)] truncate">
								{#if account.customTitle}
									{account.customTitle}
								{:else if (account.games?.length ?? 0) === 1}
									1 game
								{:else if (account.games?.length ?? 0) > 1}
									{account.games?.length ?? 0} games
								{/if}
							</p>
						{/if}
					</div>
				</div>

				<div class="flex items-center gap-2 flex-shrink-0">
					{#if status === 'WAITING_FOR_CODE'}
						<button
							class="icon-btn icon-btn-warning"
							onclick={() => onAuthRequest?.(account.id)}
							title="Enter Code"
						>
							<Icon name="key" />
						</button>
					{:else}
						<form method="POST" action="?/startAccount" use:enhance class="contents">
							<input type="hidden" name="id" value={account.id} />
							<button
								class="icon-btn icon-btn-success"
								disabled={status === 'BOOSTING' ||
									status === 'ONLINE' ||
									status === 'ERROR' ||
									status === 'LOGIN_REQUIRED'}
								title="Run"
							>
								<Icon name="play" />
							</button>
						</form>
						<form method="POST" action="?/stopAccount" use:enhance class="contents">
							<input type="hidden" name="id" value={account.id} />
							<button
								class="icon-btn icon-btn-muted"
								disabled={status === 'IDLE' ||
									status === 'DISCONNECTED' ||
									status === 'ERROR' ||
									status === 'LOGIN_REQUIRED'}
								title="Stop"
							>
								<Icon name="stop" />
							</button>
						</form>
					{/if}

					<button
						class="icon-btn icon-btn-default"
						onclick={() => onOpenSettings?.(account)}
						title="Settings"
						disabled={status === 'ERROR' || status === 'LOGIN_REQUIRED'}
					>
						<Icon name="settings" />
					</button>

					<button
						class="icon-btn icon-btn-default relative"
						onclick={() => onOpenMessages?.(account)}
						title="Messages"
						disabled={status === 'ERROR' || status === 'LOGIN_REQUIRED'}
					>
						<Icon name="message" />
					</button>

					<button
						type="button"
						class="icon-btn icon-btn-danger"
						title="Delete"
						onclick={() => onDeleteRequest?.(account)}
					>
						<Icon name="trash" />
					</button>
				</div>
			</div>
		</div>
	{/each}
</div>

<style>
	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 8px;
		transition: all 0.2s ease;
		border: 1px solid transparent;
	}

	.icon-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.icon-btn-default {
		background: rgba(154, 106, 156, 0.1);
		color: var(--text-muted);
		border-color: rgba(154, 106, 156, 0.2);
	}
	.icon-btn-default:not(:disabled):hover {
		background: rgba(154, 106, 156, 0.2);
		color: var(--text-primary);
		border-color: rgba(154, 106, 156, 0.4);
	}

	.icon-btn-success {
		background: rgba(87, 102, 76, 0.2);
		color: var(--success-light);
		border-color: rgba(87, 102, 76, 0.3);
	}
	.icon-btn-success:not(:disabled):hover {
		background: rgba(87, 102, 76, 0.35);
		border-color: rgba(87, 102, 76, 0.5);
	}

	.icon-btn-muted {
		background: rgba(107, 104, 106, 0.2);
		color: var(--text-muted);
		border-color: rgba(107, 104, 106, 0.3);
	}
	.icon-btn-muted:not(:disabled):hover {
		background: rgba(107, 104, 106, 0.35);
		color: var(--text-primary);
		border-color: rgba(107, 104, 106, 0.5);
	}

	.icon-btn-warning {
		background: rgba(156, 96, 65, 0.2);
		color: var(--warning);
		border-color: rgba(156, 96, 65, 0.3);
	}
	.icon-btn-warning:not(:disabled):hover {
		background: rgba(156, 96, 65, 0.35);
		border-color: rgba(156, 96, 65, 0.5);
	}

	.icon-btn-danger {
		background: rgba(112, 47, 62, 0.15);
		color: var(--error-light);
		border-color: rgba(112, 47, 62, 0.2);
	}
	.icon-btn-danger:not(:disabled):hover {
		background: rgba(112, 47, 62, 0.3);
		border-color: rgba(112, 47, 62, 0.4);
	}
</style>
