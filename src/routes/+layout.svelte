<script lang="ts">
	import '../app.css';
	import AnimatedBackground from '$lib/components/ui/AnimatedBackground.svelte';

	let { children, data } = $props();
</script>

<svelte:head>
	<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
</svelte:head>

{#if data.user}
	<div class="app-container">
		<AnimatedBackground light shapeCount={6} />
		<main class="app-main">
			{@render children()}
		</main>
	</div>
{:else}
	<div class="unauthenticated">
		{@render children()}
	</div>
{/if}

<style>
	.app-container {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	.app-main {
		flex: 1;
		padding: 32px 24px;
	}

	.unauthenticated {
		font-family: 'Space Grotesk', system-ui, sans-serif;
	}
</style>
