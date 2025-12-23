<script lang="ts">
	import { type Snippet } from 'svelte';

	interface Props {
		children: Snippet;
		class?: string;
	}

	let { children, class: className = '' }: Props = $props();
</script>

<div class="card {className}">
	{@render children()}
</div>

<style>
	.card {
		background: rgba(31, 24, 51, 0.75);
		backdrop-filter: blur(24px);
		-webkit-backdrop-filter: blur(24px);
		border: 1px solid rgba(154, 106, 156, 0.25);
		border-radius: 28px;
		padding: 48px;
		box-shadow:
			0 25px 50px rgba(28, 7, 26, 0.7),
			0 0 80px rgba(154, 106, 156, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	@media (max-width: 480px) {
		.card {
			padding: 40px 24px;
		}
	}
</style>
