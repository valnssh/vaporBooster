<script lang="ts">
	import StatCard from '$lib/components/dashboard/StatCard.svelte';
	import Icon from '$lib/components/icons/Icon.svelte';
	import SteamAccountList from '$lib/components/steam/SteamAccountList.svelte';
	import AddAccountModal from '$lib/components/steam/AddAccountModal.svelte';
	import AccountSettingsModal from '$lib/components/steam/AccountSettingsModal.svelte';
	import MessagesModal from '$lib/components/steam/MessagesModal.svelte';
	import ConfirmModal from '$lib/components/ui/ConfirmModal.svelte';
	import Logo from '$lib/components/ui/Logo.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { authClient } from '$lib/client';
	import { goto, invalidateAll } from '$app/navigation';

	import { onMount, onDestroy } from 'svelte';

	import SteamGuardModal from '$lib/components/steam/SteamGuardModal.svelte';

	let { data } = $props();
	let showAddModal = $state(false);
	let accountToConfigure: any | null = $state(null);
	let accountToViewMessages: any | null = $state(null);
	let accountToDelete: any | null = $state(null);
	let accountToAuth: string | null = $state(null);
	let interval: any;

	async function handleLogout() {
		await authClient.signOut();
		goto('/login');
	}

	function handleDeleteRequest(account: any) {
		accountToDelete = account;
	}

	async function confirmDelete() {
		if (accountToDelete) {
			const idToDelete = accountToDelete.id;
			try {
				// Optimistic update: remove locally immediately
				if (data.accounts) {
					data.accounts = data.accounts.filter((a: any) => a.id !== idToDelete);
				}

				const formData = new FormData();
				formData.append('id', idToDelete);
				await fetch('?/deleteAccount', {
					method: 'POST',
					body: formData
				});
				await invalidateAll();
			} finally {
				accountToDelete = null;
			}
		}
	}

	function cancelDelete() {
		accountToDelete = null;
	}

	onMount(() => {
		interval = setInterval(() => {
			invalidateAll();
		}, 1000);
	});

	onDestroy(() => {
		if (interval) clearInterval(interval);
	});
</script>

<svelte:head>
	<title>vaporBooster</title>
</svelte:head>

<div class="dashboard">
	<div class="welcome-section animate-fade-in flex justify-between items-center">
		<div class="welcome-logo-wrapper">
			<div style="transform: translateY(-2px);">
				<Logo interactive />
			</div>
			<h1 class="welcome-title">
				Welcome back, <span class="gradient-text">{data.user?.name || 'User'}</span>
			</h1>
		</div>
		{#if data.authEnabled}
			<Button onclick={handleLogout} variant="ghost" class="logout-btn-override">
				<Icon name="logout" />
				Sign Out
			</Button>
		{/if}
	</div>

	<div class="stats-grid">
		<StatCard label="Steam Accounts" value={data.accounts?.length || 0} staggerIndex={2}>
			{#snippet icon()}
				<div class="stat-icon stat-icon-accounts">
					<Icon name="accounts" />
				</div>
			{/snippet}
		</StatCard>

		<StatCard
			label="Active Now"
			value={data.accounts?.filter((a: any) => a.runtimeStatus === 'BOOSTING').length || 0}
			staggerIndex={2}
		>
			{#snippet icon()}
				<div class="stat-icon stat-icon-active">
					<Icon name="active" />
				</div>
			{/snippet}
		</StatCard>
	</div>

	<div class="mb-8 animate-fade-in" style="animation-delay: 0.4s; opacity: 0;">
		<div class="flex justify-between items-center mb-4">
			<h2 class="text-xl font-bold">Your Accounts</h2>
			<Button onclick={() => (showAddModal = true)} size="sm">+ Add Account</Button>
		</div>
		{#if data.accounts && data.accounts.length > 0}
			<SteamAccountList
				accounts={data.accounts}
				onOpenSettings={(account: any) => (accountToConfigure = account)}
				onOpenMessages={(account: any) => (accountToViewMessages = account)}
				onDeleteRequest={handleDeleteRequest}
				onAuthRequest={(id: string) => (accountToAuth = id)}
			/>
		{:else}
			<div class="text-center p-12 border border-white/10 rounded-xl bg-white/5 text-gray-400">
				No accounts added yet. <br /> Click "+ Add Account" to get started.
			</div>
		{/if}
	</div>

	{#if showAddModal}
		<AddAccountModal onClose={() => (showAddModal = false)} />
	{/if}

	{#if accountToAuth}
		<SteamGuardModal accountId={accountToAuth} onClose={() => (accountToAuth = null)} />
	{/if}

	{#if accountToConfigure}
		<AccountSettingsModal
			account={accountToConfigure}
			onClose={() => (accountToConfigure = null)}
		/>
	{/if}

	{#if accountToViewMessages}
		<MessagesModal
			account={accountToViewMessages}
			messages={data.messages?.[accountToViewMessages.id as string] || []}
			onClose={() => (accountToViewMessages = null)}
		/>
	{/if}

	{#if accountToDelete}
		<ConfirmModal
			title="Delete Account"
			message="Are you sure you want to delete <strong>{accountToDelete.accountName}</strong>? <br/> This action cannot be undone."
			confirmText="Delete"
			variant="danger"
			onConfirm={confirmDelete}
			onCancel={cancelDelete}
		/>
	{/if}
</div>

<style>
	.dashboard {
		max-width: 1200px;
		margin: 0 auto;
	}

	.welcome-section {
		margin-bottom: 40px;
	}

	.welcome-title {
		font-size: 2rem;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 4px;
		letter-spacing: -0.02em;
	}

	.welcome-logo-wrapper {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		margin-bottom: 8px;
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 24px;
		margin-bottom: 40px;
	}

	.stat-icon {
		width: 100%;
		height: 100%;
		padding: 14px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.stat-icon-accounts {
		background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
		color: var(--text-primary);
	}

	.stat-icon-active {
		background: linear-gradient(135deg, var(--success) 0%, var(--success-muted) 100%);
		color: var(--text-primary);
	}

	@media (max-width: 640px) {
		.welcome-title {
			font-size: 1.5rem;
		}

		.stats-grid {
			gap: 16px;
		}
	}
</style>
