<script lang="ts">
	interface Props {
		size?: string;
		class?: string;
	}

	let { size = '48px', class: className = '' }: Props = $props();
</script>

<div class="spinner-container {className}" style="width: {size}; height: {size};">
	<div class="spinner"></div>
</div>

<style>
	.spinner-container {
		position: relative;
	}

	.spinner {
		width: 100%;
		height: 100%;
		border: 3px solid rgba(154, 106, 156, 0.1);
		border-top-color: var(--accent-primary, #9a6a9c);
		border-radius: 50%;
		animation: spin 1s cubic-bezier(0.55, 0.15, 0.45, 0.85) infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
