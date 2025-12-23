<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { deserialize, enhance } from '$app/forms';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import QRCode from 'qrcode';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';

	let { onClose } = $props();

	let qrUrl = $state('');
	let sessionId = $state('');
	let qrCanvas = $state<HTMLCanvasElement>();
	let qrError = $state('');
	let qrLoading = $state(true);
	let polling = false;
	let mounted = false;
	let showAdvanced = $state(false);

	$effect(() => {
		if (qrUrl && qrCanvas) {
			QRCode.toCanvas(qrCanvas, qrUrl, { width: 180, margin: 1 }, (error) => {
				if (error) console.error('QR render error:', error);
				else console.log('QR code rendered successfully');
			});
		}
	});

	onMount(() => {
		mounted = true;
		startQr();
		return () => {
			mounted = false;
			polling = false;
		};
	});

	async function startQr() {
		qrError = '';
		qrLoading = true;
		qrUrl = '';

		try {
			const response = await fetch('?/startQrLogin', {
				method: 'POST',
				body: new FormData()
			});

			const result = deserialize(await response.text());
			console.log('startQrLogin result:', result);

			if (result.type === 'success' && result.data) {
				qrUrl = result.data.qrUrl as string;
				sessionId = result.data.sessionId as string;
				console.log('QR URL received:', qrUrl);
				poll();
			} else if (result.type === 'failure') {
				qrError = (result.data as any)?.error || 'Failed to start QR login';
			} else {
				qrError = 'Unexpected response from server';
			}
		} catch (e) {
			qrError = 'Connection error. Please try again.';
			console.error('QR login error:', e);
		} finally {
			qrLoading = false;
		}
	}

	async function poll() {
		polling = true;
		while (polling && mounted) {
			const formData = new FormData();
			formData.append('sessionId', sessionId);

			const response = await fetch('?/pollQrLogin', {
				method: 'POST',
				body: formData
			});

			const result = deserialize(await response.text());

			if (result.type === 'success') {
				if (result.data?.pending) {
				} else if (result.data?.success) {
					polling = false;
					await invalidateAll();
					onClose();
					return;
				}
			} else if (result.type === 'failure') {
				if (result.status === 408) {
					await startQr();
					return;
				} else {
					polling = false;
				}
			}
			await new Promise((r) => setTimeout(r, 500));
		}
	}
</script>

<Modal
	title="Add Steam Account"
	{onClose}
	size="xl"
	gradientColors={['var(--primary-dark)', 'var(--secondary-dark)']}
>
	<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
		<div class="space-y-4">
			<form
				method="POST"
				action="?/addAccount"
				use:enhance={() => {
					return async ({ result }: { result: any }) => {
						if (result.type === 'success') {
							await invalidateAll();
							onClose();
						}
					};
				}}
			>
				<div class="space-y-4">
					<div>
						<label for="accountName" class="block text-sm text-gray-400 mb-1">Account Name</label>
						<input type="text" name="accountName" required class="input" placeholder="rabscuttle" />
					</div>

					<div>
						<label for="password" class="block text-sm text-gray-400 mb-1">Password</label>
						<input type="password" name="password" required class="input" placeholder="••••••••" />
					</div>

					<div>
						<button
							type="button"
							class="text-xs text-gray-400 hover:text-[var(--primary)] transition-colors flex items-center gap-1"
							onclick={() => (showAdvanced = !showAdvanced)}
						>
							{#if showAdvanced}▼{:else}▶{/if} Advanced features
						</button>

						{#if showAdvanced}
							<div class="mt-3" transition:slide>
								<label for="sharedSecret" class="block text-sm text-gray-400 mb-1"
									>Shared Secret (for 2FA)</label
								>
								<input
									type="text"
									name="sharedSecret"
									class="input border-dashed border-white/10 bg-white/5 text-gray-400 placeholder:text-gray-600 focus:border-dashed focus:border-[var(--primary)]/50"
									placeholder="Optional, leave it empty if unknown"
								/>
							</div>
						{/if}
					</div>

					<Button type="submit" class="w-full mt-6">Login</Button>
				</div>
			</form>
		</div>

		<div
			class="flex flex-col items-center justify-center border-t md:border-t-0 md:border-l border-white/10 pt-6 md:pt-0 md:pl-6"
		>
			<h3 class="text-sm font-semibold text-[var(--secondary)] uppercase tracking-wider mb-4">
				Sign In with QR Code
			</h3>

			<div
				class="bg-white p-2 rounded-lg shadow-lg relative min-h-[200px] min-w-[200px] flex items-center justify-center"
			>
				{#if qrLoading}
					<div class="absolute inset-0 flex items-center justify-center">
						<Spinner size="36px" class="!border-gray-200 !border-t-[var(--secondary)]" />
					</div>
				{:else if qrError}
					<div class="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
						<span class="text-red-500 text-3xl mb-2">⚠</span>
						<p class="text-gray-600 text-xs mb-3">{qrError}</p>
						<button
							type="button"
							class="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded transition-colors"
							onclick={startQr}
						>
							Retry
						</button>
					</div>
				{:else if qrUrl}
					<canvas bind:this={qrCanvas}></canvas>
				{/if}
			</div>

			<p class="text-xs text-gray-500 text-center max-w-xs mt-4">
				Use the <a
					href="https://store.steampowered.com/mobile"
					target="_blank"
					rel="noopener noreferrer"><strong>Steam Mobile App</strong></a
				>, <br /> to sign in via QR Code.
			</p>
		</div>
	</div>
</Modal>
