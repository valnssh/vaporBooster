<script lang="ts">
	let { size = 'small', interactive = false } = $props();
	let winking = $state(false);

	function playWinkSound() {
		if (typeof window === 'undefined') return;
		// @ts-ignore - Safari support
		const AudioContext = window.AudioContext || window.webkitAudioContext;
		if (!AudioContext) return;

		const ctx = new AudioContext();
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();

		osc.connect(gain);
		gain.connect(ctx.destination);

		osc.type = 'sine';
		osc.frequency.setValueAtTime(800, ctx.currentTime);
		osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
		osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.3);

		gain.gain.setValueAtTime(0.05, ctx.currentTime);
		gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

		osc.start();
		osc.stop(ctx.currentTime + 0.3);
	}

	function createSteam(x: number, y: number) {
		const steam = document.createElement('div');
		steam.className = 'steam-particle';
		steam.style.left = `${x}px`;
		steam.style.top = `${y}px`;
		document.body.appendChild(steam);

		setTimeout(() => steam.remove(), 2000);
	}

	function handleLogoClick(e: MouseEvent | KeyboardEvent) {
		if (!interactive) return;

		e.preventDefault();
		if (winking) return;

		winking = true;
		playWinkSound();

		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const centerX = rect.left + rect.width / 2;
		const centerY = rect.top + rect.height / 2;

		for (let i = 0; i < 12; i++) {
			setTimeout(() => {
				const offsetX = (Math.random() - 0.5) * 40;
				createSteam(centerX + offsetX, centerY - 10);
			}, i * 50);
		}

		setTimeout(() => (winking = false), 800);
	}
</script>

<button
	type="button"
	class="logo-link {winking ? 'wink' : ''} {size}"
	onclick={(e) => {
		e.preventDefault();
		handleLogoClick(e);
	}}
	class:interactive
>
	<div class="logo-icon">
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
			<polyline points="2 17 12 22 22 17"></polyline>
			<polyline points="2 12 12 17 22 12"></polyline>
		</svg>
	</div>
	{#if size === 'large'}
		<h1 class="logo-text gradient-text-animated">vaporBooster</h1>
	{/if}
</button>

<style>
	.logo-link {
		display: flex;
		align-items: center;
		justify-content: center;
		text-decoration: none;
		transition: transform 0.3s ease;
		background: none;
		border: none;
		padding: 0;
		margin: 0;
		cursor: default;
		color: inherit;
		font: inherit;
	}

	.logo-link.large {
		flex-direction: column;
		width: 100%;
	}

	.logo-link.large .logo-icon {
		width: 64px;
		height: 64px;
		margin: 0 auto 16px;
		padding: 16px;
		background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
		border-radius: 20px;
		color: var(--bg-darkest);
		animation: float 4s ease-in-out infinite;
		box-shadow: 0 10px 30px rgba(154, 106, 156, 0.3);
	}

	.logo-link.large .logo-text {
		font-size: 2rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		margin-bottom: 8px;
	}

	.logo-link.small .logo-icon {
		width: 36px;
		height: 36px;
		padding: 8px;
		background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
		border-radius: 10px;
		color: var(--bg-darkest);
	}

	.logo-icon svg {
		width: 100%;
		height: 100%;
	}

	.logo-link.wink .logo-icon {
		animation: winkAction 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275);
	}

	@keyframes winkAction {
		0% {
			transform: rotate(0deg);
		}
		50% {
			transform: rotate(10deg);
		}
		100% {
			transform: rotate(0deg);
		}
	}

	:global(.steam-particle) {
		position: fixed;
		width: 12px;
		height: 12px;
		background: radial-gradient(circle, rgba(255, 255, 255, 0.8) 0%, rgba(255, 255, 255, 0) 70%);
		border-radius: 50%;
		pointer-events: none;
		z-index: 9999;
		animation: steamRise 2s ease-out forwards;
		filter: blur(4px);
	}

	@keyframes steamRise {
		0% {
			transform: translateY(0) scale(0.5);
			opacity: 0.6;
		}
		50% {
			opacity: 0.4;
		}
		100% {
			transform: translateY(-80px) scale(4);
			opacity: 0;
		}
	}
</style>
