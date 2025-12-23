<script lang="ts">
	import { type Snippet } from 'svelte';

	interface Props {
		children: Snippet;
		onclick?: () => void;
		type?: 'button' | 'submit' | 'reset';
		variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
		size?: 'sm' | 'md';
		class?: string;
		disabled?: boolean;
	}

	let {
		children,
		onclick,
		type = 'button',
		variant = 'primary',
		size = 'md',
		class: className = '',
		disabled = false
	}: Props = $props();
</script>

<button {type} {onclick} class="btn btn-{variant} btn-{size} {className}" {disabled}>
	<span class="btn-content">
		{@render children()}
	</span>
</button>

<style>
	.btn {
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 12px;
		font-weight: 600;
		cursor: pointer;
		border: 1px solid transparent;
		position: relative;
		overflow: hidden;
	}

	.btn-md {
		padding: 12px 24px;
		font-size: 1rem;
	}

	.btn-sm {
		padding: 8px 16px;
		font-size: 0.875rem;
		border-radius: 10px;
	}

	.btn-content {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.btn:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}

	.btn-primary {
		background: linear-gradient(
			135deg,
			var(--secondary) 0%,
			var(--secondary-light) 50%,
			var(--accent-tan) 100%
		);
		background-size: 200% 200%;
		background-position: 0% 50%;
		color: var(--bg-darkest);
		box-shadow:
			0 4px 15px rgba(204, 161, 98, 0.3),
			0 0 15px rgba(204, 161, 98, 0.1);
		font-weight: 700;
		transition: all 0.4s ease;
	}

	.btn-primary:not(:disabled):hover {
		background-position: 100% 50%;
		box-shadow:
			0 6px 20px rgba(204, 161, 98, 0.5),
			0 0 25px rgba(204, 161, 98, 0.2);
	}

	.btn-primary:not(:disabled):active {
		background-position: 50% 50%;
	}

	.btn-secondary {
		background: rgba(154, 106, 156, 0.15);
		border-color: rgba(154, 106, 156, 0.3);
		color: var(--text-primary);
		transition: all 0.3s ease;
	}

	.btn-secondary:not(:disabled):hover {
		background: rgba(154, 106, 156, 0.25);
		border-color: rgba(154, 106, 156, 0.5);
	}

	.btn-danger {
		background: linear-gradient(135deg, var(--error) 0%, var(--error-light) 50%, var(--error) 100%);
		background-size: 200% 200%;
		background-position: 0% 50%;
		color: var(--text-primary);
		box-shadow:
			0 4px 15px rgba(112, 47, 62, 0.3),
			0 0 15px rgba(112, 47, 62, 0.1);
		transition: all 0.4s ease;
	}

	.btn-danger:not(:disabled):hover {
		background-position: 100% 50%;
		box-shadow:
			0 6px 20px rgba(112, 47, 62, 0.5),
			0 0 25px rgba(112, 47, 62, 0.2);
	}

	.btn-ghost {
		background: transparent;
		color: var(--text-primary);
		border: 1px solid transparent;
		font-weight: 500;
		transition: all 0.3s ease;
	}

	.btn-ghost:not(:disabled):hover {
		background: rgba(154, 106, 156, 0.12);
		border-color: rgba(154, 106, 156, 0.25);
	}
</style>
