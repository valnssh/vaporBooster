<script lang="ts">
	import { enhance } from '$app/forms';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';

	let { account, onClose } = $props();
	let errorMessage = $state('');
</script>

<Modal title="Account Settings" {onClose} size="md">
	<div class="mb-4 text-gray-400 text-sm">
		Configure boosting options for <span class="text-white font-semibold"
			>{account.accountName}</span
		>.
	</div>

	<form
		method="POST"
		action="?/updateAccountConfig"
		use:enhance={() => {
			return async ({ result }) => {
				if (result.type === 'success') {
					onClose();
				} else if (result.type === 'failure') {
					// @ts-ignore
					errorMessage = result.data?.error || 'Failed to update settings';
				}
			};
		}}
	>
		<input type="hidden" name="id" value={account.id} />
		<div class="space-y-4">
			{#if errorMessage}
				<div class="p-3 bg-red-500/10 border border-red-500/20 text-red-500 text-sm rounded-lg">
					{errorMessage}
				</div>
			{/if}
			<div>
				<div class="flex items-center justify-between">
					<div>
						<label for="visibleToggle" class="block text-sm text-gray-400 mb-1"
							>Online Visibility</label
						>
						<p class="text-xs text-gray-500">Show as "Online" to friends.</p>
					</div>
					<label class="relative inline-flex items-center cursor-pointer">
						<input
							type="checkbox"
							id="visibleToggle"
							class="sr-only peer"
							checked={account.personaState === 1}
							onchange={(e) => {
								const val = e.currentTarget.checked ? 1 : 7;
								const input = document.getElementById(
									'personaStateInput'
								) as HTMLInputElement | null;
								if (input) input.value = val.toString();
							}}
						/>
						<div
							class="toggle-track w-11 h-6 rounded-full peer peer-checked:toggle-active peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all"
						></div>
					</label>
				</div>
				<input
					type="hidden"
					name="personaState"
					id="personaStateInput"
					value={account.personaState === 1 ? '1' : '7'}
				/>
			</div>

			<div>
				<label for="autoReplyMessage" class="block text-sm text-gray-400 mb-1"
					>Auto-Reply Message</label
				>
				<p class="text-xs text-gray-500 mb-2">Automatically reply to incoming Steam chats.</p>
				<textarea
					name="autoReplyMessage"
					value={account.autoReplyMessage || ''}
					class="input resize-none"
					rows="3"
					placeholder="e.g. I'm AFK, boosting games."
				></textarea>
			</div>

			<div>
				<label for="customTitle" class="block text-sm text-gray-400 mb-1">Boosting Message</label>
				<p class="text-xs text-gray-500 mb-2">Displayed as "Non-Steam Game" on your profile.</p>
				<input
					type="text"
					name="customTitle"
					value={account.customTitle || ''}
					class="input"
					placeholder="e.g. Idling in vaporBooster"
				/>
			</div>

			<div>
				<label for="games" class="block text-sm text-gray-400 mb-1">Game IDs</label>
				<p class="text-xs text-gray-500 mb-2">Comma separated list of App IDs.</p>
				<input
					type="text"
					name="games"
					value={JSON.stringify(account.games || [])}
					class="input font-mono"
					placeholder="[730, 440]"
				/>
			</div>

			<Button type="submit" class="w-full mt-6">Save Changes</Button>
		</div>
	</form>
</Modal>

<style>
	.toggle-track {
		background: var(--bg-medium);
		transition: all 0.3s ease;
	}

	:global(.peer:checked ~ .toggle-track) {
		background: var(--primary) !important;
		box-shadow: 0 0 12px rgba(154, 106, 156, 0.5);
	}
</style>
