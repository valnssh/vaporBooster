<script lang="ts">
	import { onMount } from 'svelte';
	import AnimatedBackground from '$lib/components/ui/AnimatedBackground.svelte';
	import Logo from '$lib/components/ui/Logo.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import Icon from '$lib/components/icons/Icon.svelte';
	import { authClient } from '$lib/client';

	let { data } = $props();
	let loading = $state(false);
	let error = $state<string | null>(null);

	async function handleOidcLogin() {
		loading = true;
		error = null;
		try {
			await authClient.signIn.oauth2({
				providerId: data.oidcProviderId!
			});
		} catch (err: any) {
			console.error('OIDC Login error:', err);
			error = err.message || 'Failed to start OIDC login';
			loading = false;
		}
	}

	onMount(() => {
		if (data.oidcEnabled) {
			handleOidcLogin();
		}
	});
</script>

<svelte:head>
	<title>vaporBooster :: Authentication</title>
</svelte:head>

<div class="login-container">
	<AnimatedBackground />

	<Card class="login-card-override animate-slide-up">
		<div class="login-header">
			<Logo size="large" />
		</div>

		{#if error}
			<div class="error-message animate-fade-in">
				<Icon name="error" size={20} />
				{error}
			</div>

			<div class="auth-actions">
				<Button onclick={handleOidcLogin} variant="secondary" class="oidc-btn">Retry Login</Button>
			</div>
		{:else if data.oidcEnabled}
			<div class="redirect-state animate-fade-in">
				<Spinner />
				<p class="redirect-text">
					Redirecting to {data.oidcProviderName || 'OIDC provider'}...
				</p>
			</div>
		{:else if !data.oidcEnabled}
			<div class="auth-actions">
				<div class="anonymous-login animate-fade-in stagger-1">
					<div class="loading-state">Redirecting to the dashboard...</div>
				</div>
			</div>
		{/if}
	</Card>
</div>

<style>
	.login-container {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		position: relative;
		overflow: hidden;
		background: var(--bg-darkest);
	}

	:global(.login-card-override) {
		width: 100%;
		max-width: 420px;
		position: relative;
		z-index: 10;
	}

	.login-header {
		text-align: center;
		margin-bottom: 32px;
	}

	.error-message {
		display: flex;
		align-items: center;
		gap: 10px;
		background: rgba(112, 47, 62, 0.3);
		border: 1px solid rgba(145, 68, 68, 0.5);
		color: #e8a0a0;
		padding: 12px 16px;
		border-radius: 12px;
		margin-bottom: 24px;
		font-size: 0.9rem;
	}

	.auth-actions {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	:global(.oidc-btn) {
		width: 100%;
	}

	.redirect-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 20px;
		text-align: center;
	}

	.redirect-text {
		color: var(--text-muted);
		font-size: 1rem;
		font-weight: 400;
	}

	.anonymous-login {
		text-align: center;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.loading-state {
		color: var(--text-muted);
	}
</style>
