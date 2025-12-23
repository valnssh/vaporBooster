<script lang="ts">
	import { enhance } from '$app/forms';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';

	let { accountId, onClose } = $props();
</script>

<Modal
	title="Steam Guard Required"
	{onClose}
	size="sm"
	gradientColors={['var(--warning)', 'var(--secondary)']}
>
	<p class="text-sm text-gray-400 text-center mb-6">
		Enter the code sent to your email or mobile app.
	</p>

	<form
		method="POST"
		action="?/submitSteamCode"
		use:enhance={() => {
			return async ({ result }) => {
				if (result.type === 'success') {
					onClose();
				}
			};
		}}
	>
		<input type="hidden" name="id" value={accountId} />
		<div class="space-y-4">
			<div class="flex justify-center">
				<input
					type="text"
					name="code"
					required
					maxlength="5"
					class="input text-center text-2xl font-mono tracking-widest uppercase w-40"
					placeholder="ABCDE"
				/>
			</div>

			<Button type="submit" class="w-full mt-6">Submit Code</Button>
		</div>
	</form>
</Modal>
