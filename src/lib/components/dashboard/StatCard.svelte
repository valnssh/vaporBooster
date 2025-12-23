<script lang="ts">
	import Card from '$lib/components/ui/Card.svelte';
	let { label, value, staggerIndex = 1, icon } = $props();
</script>

<Card class="stat-card card-glow animate-slide-up stagger-{staggerIndex}">
	<div class="stat-icon-wrapper">
		{@render icon()}
	</div>
	<div class="stat-content">
		<span class="stat-label">{label}</span>
		<span class="stat-value">{value}</span>
	</div>
</Card>

<style>
	:global(.stat-card) {
		display: flex;
		align-items: center;
		gap: 20px;
	}

	.stat-icon-wrapper {
		width: 56px;
		height: 56px;
		border-radius: 16px;
		flex-shrink: 0;
		overflow: hidden;
	}

	.stat-content {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.stat-label {
		color: var(--text-muted);
		font-size: 0.9rem;
	}

	.stat-value {
		font-size: 2rem;
		font-weight: 700;
		color: var(--text-primary);
		letter-spacing: -0.02em;
	}
</style>
