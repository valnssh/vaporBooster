<script lang="ts">
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';

	interface Props {
		title?: string;
		message: string;
		confirmText?: string;
		variant?: 'danger' | 'primary';
		onConfirm: () => void;
		onCancel: () => void;
	}

	let {
		title = 'Are you sure?',
		message,
		confirmText = 'Confirm',
		variant = 'danger',
		onConfirm,
		onCancel
	}: Props = $props();
</script>

<Modal
	{title}
	onClose={onCancel}
	size="sm"
	gradientColors={variant === 'danger'
		? ['var(--error)', 'var(--error-light)']
		: ['var(--secondary)', 'var(--primary)']}
>
	<p class="message">{@html message}</p>

	<Button {variant} onclick={onConfirm} class="w-full">
		{confirmText}
	</Button>
</Modal>

<style>
	.message {
		color: var(--text-secondary);
		margin-bottom: 1.5rem;
		line-height: 1.5;
	}
</style>
