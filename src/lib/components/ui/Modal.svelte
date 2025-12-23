<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';
	import type { Snippet } from 'svelte';
	import { onMount, onDestroy } from 'svelte';

	type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

	let {
		title,
		onClose,
		size = 'md',
		gradientColors = ['var(--secondary)', 'var(--primary)'],
		scrollable = false,
		children
	}: {
		title: string;
		onClose: () => void;
		size?: ModalSize;
		gradientColors?: [string, string];
		scrollable?: boolean;
		children: Snippet;
	} = $props();

	const sizeClasses: Record<ModalSize, string> = {
		sm: 'max-w-sm',
		md: 'max-w-md',
		lg: 'max-w-2xl',
		xl: 'max-w-3xl'
	};

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
		}
	}

	onMount(() => {
		document.addEventListener('keydown', handleKeydown);
	});

	onDestroy(() => {
		document.removeEventListener('keydown', handleKeydown);
	});

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onClose();
		}
	}
</script>

<div
	class="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4"
	transition:fade={{ duration: 200 }}
	onclick={handleBackdropClick}
	onkeydown={(e) => e.key === 'Escape' && onClose()}
	role="dialog"
	aria-modal="true"
	aria-labelledby="modal-title"
	tabindex="-1"
>
	<div
		class="modal-container rounded-xl w-full {sizeClasses[size]} p-6 shadow-2xl relative {scrollable
			? 'max-h-[80vh] flex flex-col'
			: ''}"
		style="--gradient-start: {gradientColors[0]}; --gradient-end: {gradientColors[1]};"
		transition:scale={{ duration: 300, easing: quintOut, start: 0.95 }}
	>
		<button
			class="absolute top-4 right-4 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors z-10"
			onclick={onClose}
		>
			✕
		</button>

		<h2 id="modal-title" class="text-xl font-bold mb-4 text-[var(--text-primary)]">{title}</h2>

		{#if scrollable}
			<div class="flex-1 overflow-y-auto pr-2">
				{@render children()}
			</div>
		{:else}
			{@render children()}
		{/if}
	</div>
</div>

<style>
	.modal-container {
		position: relative;
		background: var(--bg-dark);
		border: 1px solid rgba(154, 106, 156, 0.2);
		z-index: 1;
	}
	.modal-container::before {
		content: '';
		position: absolute;
		inset: -1px;
		z-index: -1;
		border-radius: 13px;
		padding: 1px;
		background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
		-webkit-mask:
			linear-gradient(#fff 0 0) content-box,
			linear-gradient(#fff 0 0);
		mask:
			linear-gradient(#fff 0 0) content-box,
			linear-gradient(#fff 0 0);
		-webkit-mask-composite: xor;
		mask-composite: exclude;
		opacity: 0.5;
	}
</style>
