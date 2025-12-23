<script lang="ts">
	import Modal from '$lib/components/ui/Modal.svelte';

	let {
		title = 'Are you sure?',
		message,
		confirmText = 'Confirm',
		variant = 'danger' as 'danger' | 'primary',
		onConfirm,
		onCancel
	}: {
		title?: string;
		message: string;
		confirmText?: string;
		variant?: 'danger' | 'primary';
		onConfirm: () => void;
		onCancel: () => void;
	} = $props();
</script>

<Modal
	{title}
	onClose={onCancel}
	size="sm"
	gradientColors={variant === 'danger'
		? ['var(--error)', 'var(--error-light)']
		: ['var(--secondary)', 'var(--primary)']}
>
	<p class="message">{message}</p>

	<button
		class="btn-confirm"
		class:btn-danger={variant === 'danger'}
		class:btn-primary={variant === 'primary'}
		onclick={onConfirm}
	>
		{confirmText}
	</button>
</Modal>

<style>
	.message {
		color: var(--text-secondary);
		margin-bottom: 1.5rem;
		line-height: 1.5;
	}

	.btn-confirm {
		width: 100%;
		padding: 12px 20px;
		border-radius: 10px;
		font-weight: 600;
		font-size: 0.95rem;
		cursor: pointer;
		border: 1px solid transparent;
	}

	.btn-danger {
		background: linear-gradient(135deg, var(--error) 0%, var(--error-light) 100%);
		background-size: 200% 200%;
		background-position: 0% 50%;
		color: var(--text-primary);
		box-shadow:
			0 4px 15px rgba(112, 47, 62, 0.4),
			0 0 20px rgba(145, 68, 68, 0.15);
		transition: all 0.4s ease;
	}

	.btn-danger:hover {
		background-position: 100% 50%;
		box-shadow:
			0 4px 20px rgba(112, 47, 62, 0.6),
			0 0 35px rgba(145, 68, 68, 0.3);
	}

	.btn-primary {
		background: linear-gradient(135deg, var(--secondary) 0%, var(--secondary-light) 100%);
		background-size: 200% 200%;
		background-position: 0% 50%;
		color: var(--bg-darkest);
		box-shadow:
			0 4px 15px rgba(204, 161, 98, 0.4),
			0 0 20px rgba(204, 161, 98, 0.15);
		transition: all 0.4s ease;
	}

	.btn-primary:hover {
		background-position: 100% 50%;
		box-shadow:
			0 4px 20px rgba(204, 161, 98, 0.6),
			0 0 35px rgba(204, 161, 98, 0.3);
	}
</style>
