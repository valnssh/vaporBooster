<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { slide } from 'svelte/transition';
	import Modal from '$lib/components/ui/Modal.svelte';
	import ConfirmModal from '$lib/components/ui/ConfirmModal.svelte';
	import Icon from '$lib/components/icons/Icon.svelte';

	let { account, messages = [], onClose } = $props();

	let selectedContact: string | null = $state(null);
	let openMenu: string | null = $state(null);
	let contactToDelete: { steamIdOther: string; name: string } | null = $state(null);

	const getContacts = () => {
		const contactMap = new Map<string, { steamIdOther: string; name: string; lastMessage: any }>();

		for (const msg of messages) {
			const existing = contactMap.get(msg.steamIdOther);
			if (!existing) {
				contactMap.set(msg.steamIdOther, {
					steamIdOther: msg.steamIdOther,
					name: msg.senderName || msg.steamIdOther,
					lastMessage: msg
				});
			} else {
				if (msg.timestamp > existing.lastMessage.timestamp) {
					existing.lastMessage = msg;
				}
			}
		}

		return Array.from(contactMap.values()).sort(
			(a, b) =>
				new Date(b.lastMessage.timestamp).getTime() - new Date(a.lastMessage.timestamp).getTime()
		);
	};

	const getContactMessages = (steamIdOther: string) => {
		return messages
			.filter((m: any) => m.steamIdOther === steamIdOther)
			.sort((a: any, b: any) => {
				const timeDiff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
				return timeDiff === 0 ? a.id - b.id : timeDiff;
			});
	};

	const formatTime = (timestamp: Date | number) => {
		const date = typeof timestamp === 'number' ? new Date(timestamp * 1000) : new Date(timestamp);
		const now = new Date();
		const isToday = date.toDateString() === now.toDateString();

		if (isToday) {
			return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		}
		return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
	};

	const formatFullTime = (timestamp: Date | number) => {
		const date = typeof timestamp === 'number' ? new Date(timestamp * 1000) : new Date(timestamp);
		return date.toLocaleString();
	};

	function openSteamDB(steamIdOther: string) {
		window.open(`https://steamdb.info/calculator/${steamIdOther}/`, '_blank');
		openMenu = null;
	}

	function requestDeleteChat(contact: { steamIdOther: string; name: string }) {
		contactToDelete = contact;
		openMenu = null;
	}

	async function confirmDeleteChat() {
		if (!contactToDelete) return;

		const steamIdToDelete = contactToDelete.steamIdOther;
		const formData = new FormData();
		formData.append('accountId', account.id);
		formData.append('steamIdOther', steamIdToDelete);

		await fetch('?/deleteChat', {
			method: 'POST',
			body: formData
		});

		await invalidateAll();

		if (selectedContact === steamIdToDelete) {
			selectedContact = null;
		}

		contactToDelete = null;
	}

	function toggleMenu(steamIdOther: string, e: Event) {
		e.stopPropagation();
		openMenu = openMenu === steamIdOther ? null : steamIdOther;
	}

	function handleBackdropClick() {
		if (openMenu) openMenu = null;
	}
</script>

<Modal
	title={selectedContact
		? getContacts().find((c) => c.steamIdOther === selectedContact)?.name || 'Chat'
		: `Messages - ${account.accountName}`}
	{onClose}
	size="lg"
	scrollable
>
	{#if selectedContact}
		{@const contact = getContacts().find((c) => c.steamIdOther === selectedContact)}
		<div class="chat-header">
			<button class="back-btn" onclick={() => (selectedContact = null)}>
				<Icon name="arrowLeft" />
			</button>
			<div class="flex-1"></div>
			<div class="menu-wrapper">
				<button class="menu-btn" onclick={(e) => toggleMenu(selectedContact!, e)}>
					<Icon name="moreVertical" />
				</button>
				{#if openMenu === selectedContact}
					<div class="dropdown-menu" transition:slide={{ duration: 150 }}>
						<button onclick={() => openSteamDB(selectedContact!)}>Open SteamDB</button>
						<button
							class="danger"
							onclick={() =>
								requestDeleteChat({ steamIdOther: selectedContact!, name: contact?.name || '' })}
							>Delete chat</button
						>
					</div>
				{/if}
			</div>
		</div>

		<div
			class="messages-list view-container animate-fade-in"
			role="button"
			tabindex="0"
			onclick={handleBackdropClick}
			onkeydown={(e) => e.key === 'Enter' && handleBackdropClick()}
		>
			{#each getContactMessages(selectedContact) as message}
				{@const isOutgoing = message.direction === 'outgoing'}
				<div class="message-row {isOutgoing ? 'outgoing' : 'incoming'}">
					<div class="message-bubble {isOutgoing ? 'sent' : 'received'}">
						{#if isOutgoing}
							<div class="message-label">Auto-Reply</div>
						{/if}
						<div class="message-content">{message.content}</div>
						<div class="message-time">{formatFullTime(message.timestamp)}</div>
					</div>
				</div>
			{/each}
		</div>
	{:else if getContacts().length === 0}
		<div class="empty-state">No messages yet.</div>
	{:else}
		<div
			class="contacts-list view-container animate-fade-in"
			role="button"
			tabindex="0"
			onclick={handleBackdropClick}
			onkeydown={(e) => e.key === 'Enter' && handleBackdropClick()}
		>
			{#each getContacts() as contact}
				<button
					type="button"
					class="contact-item w-full text-left"
					onclick={() => (selectedContact = contact.steamIdOther)}
				>
					<div class="contact-avatar">
						{contact.name.charAt(0).toUpperCase()}
					</div>
					<div class="contact-info">
						<div class="contact-name">
							{contact.name}
						</div>
						<div class="contact-preview">
							{contact.lastMessage.direction === 'outgoing' ? 'You: ' : ''}
							{contact.lastMessage.content.slice(0, 50)}{contact.lastMessage.content.length > 50
								? '...'
								: ''}
						</div>
					</div>
					<div class="contact-meta">
						<div class="contact-time">{formatTime(contact.lastMessage.timestamp)}</div>
					</div>
				</button>
			{/each}
		</div>
	{/if}
</Modal>

{#if contactToDelete}
	<ConfirmModal
		title="Delete Chat"
		message="Are you sure you want to delete all messages with <strong>{contactToDelete.name}</strong>? This cannot be undone."
		confirmText="Delete"
		variant="danger"
		onConfirm={confirmDeleteChat}
		onCancel={() => (contactToDelete = null)}
	/>
{/if}

<style>
	.view-container {
		width: 100%;
		min-height: 200px;
	}

	.animate-fade-in {
		animation: fadeIn 0.15s ease-out;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.chat-header {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 16px;
		padding-bottom: 12px;
		border-bottom: 1px solid rgba(154, 106, 156, 0.2);
	}

	.back-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 8px;
		background: rgba(154, 106, 156, 0.1);
		color: var(--text-muted);
		border: none;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.back-btn:hover {
		background: rgba(154, 106, 156, 0.2);
		color: var(--text-primary);
	}

	.menu-wrapper {
		position: relative;
	}

	.menu-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 6px;
		background: transparent;
		color: var(--text-muted);
		border: none;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.menu-btn:hover {
		background: rgba(154, 106, 156, 0.15);
		color: var(--text-primary);
	}

	.dropdown-menu {
		position: absolute;
		right: 0;
		top: 100%;
		margin-top: 4px;
		background: var(--bg-dark);
		border: 1px solid rgba(154, 106, 156, 0.3);
		border-radius: 8px;
		overflow: hidden;
		min-width: 150px;
		z-index: 100;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
	}

	.dropdown-menu button {
		display: block;
		width: 100%;
		padding: 10px 14px;
		text-align: left;
		background: none;
		border: none;
		color: var(--text-primary);
		font-size: 0.875rem;
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.dropdown-menu button:hover {
		background: rgba(154, 106, 156, 0.15);
	}

	.dropdown-menu button.danger {
		color: var(--error-light);
	}

	.dropdown-menu button.danger:hover {
		background: rgba(112, 47, 62, 0.2);
	}

	.empty-state {
		text-align: center;
		padding: 48px 24px;
		color: var(--text-muted);
	}

	.contacts-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.contact-item {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px;
		border-radius: 10px;
		cursor: pointer;
		transition: background 0.2s ease;
	}

	.contact-item:hover {
		background: rgba(154, 106, 156, 0.1);
	}

	.contact-avatar {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%);
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 1.1rem;
		color: var(--text-primary);
		flex-shrink: 0;
	}

	.contact-info {
		flex: 1;
		min-width: 0;
	}

	.contact-name {
		font-weight: 600;
		color: var(--text-primary);
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.contact-preview {
		font-size: 0.85rem;
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.contact-meta {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 4px;
	}

	.contact-time {
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	.messages-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.message-row {
		display: flex;
	}

	.message-row.incoming {
		justify-content: flex-start;
	}

	.message-row.outgoing {
		justify-content: flex-end;
	}

	.message-bubble {
		max-width: 75%;
		padding: 12px 16px;
		border-radius: 16px;
	}

	.message-bubble.received {
		background: rgba(154, 106, 156, 0.15);
		border: 1px solid rgba(154, 106, 156, 0.25);
		border-bottom-left-radius: 4px;
	}

	.message-bubble.sent {
		background: rgba(204, 161, 98, 0.15);
		border: 1px solid rgba(204, 161, 98, 0.25);
		border-bottom-right-radius: 4px;
	}

	.message-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--secondary);
		margin-bottom: 4px;
	}

	.message-content {
		font-size: 0.9rem;
		color: var(--text-primary);
		white-space: pre-wrap;
		word-break: break-word;
	}

	.message-time {
		font-size: 0.7rem;
		color: var(--text-muted);
		text-align: right;
		margin-top: 6px;
	}
</style>
