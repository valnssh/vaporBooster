<script lang="ts">
	const ORB_COUNT = 5;
	const SHAPE_COUNT = 3;

	function r(min: number, max: number) {
		return Math.random() * (max - min) + min;
	}

	let orbs = $state<any[]>([]);
	let shapes = $state<any[]>([]);

	$effect(() => {
		orbs = Array.from({ length: ORB_COUNT }).map((_, i) => {
			const colors = [
				'var(--primary)',
				'var(--secondary)',
				'var(--primary-light)',
				'var(--secondary-light)',
				'var(--primary-dark)'
			];
			const color = colors[i % colors.length];

			return {
				id: i,
				style: `
					--orb-color: ${color}; 
					--size: ${r(200, 450)}px;
					--start-x: ${r(-20, 120)}vw;
					--start-y: ${r(-20, 120)}vh;
					--end-x: ${r(-20, 120)}vw;
					--end-y: ${r(-20, 120)}vh;
					--duration: ${r(15, 30)}s;
					--delay: ${r(-10, 0)}s;
					--scale-min: ${r(0.8, 0.9)};
					--scale-max: ${r(1.1, 1.3)};
				`
			};
		});

		shapes = Array.from({ length: SHAPE_COUNT }).map((_, i) => {
			return {
				id: i,
				style: `
					--size: ${r(50, 120)}px;
					--start-x: ${r(10, 90)}%;
					--start-y: ${r(10, 90)}%;
					--move-y: ${r(-50, 50)}px;
					--duration-float: ${r(8, 15)}s;
					--duration-rotate: ${r(15, 30)}s;
					--delay: ${r(-5, 0)}s;
					--border-color: ${i % 2 === 0 ? 'rgba(154, 106, 156, 0.2)' : 'rgba(204, 161, 98, 0.25)'};
					--border-radius: ${r(20, 50)}%;
				`
			};
		});
	});
</script>

<div class="animated-bg" aria-hidden="true">
	<div class="gradient-mesh"></div>

	{#each orbs as orb (orb.id)}
		<div class="orb" style={orb.style}></div>
	{/each}

	<div class="grid-overlay"></div>

	{#each shapes as shape (shape.id)}
		<div class="shape" style={shape.style}></div>
	{/each}
</div>

<style>
	.animated-bg {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: hidden;
	}

	.gradient-mesh {
		position: absolute;
		inset: -50%;
		background:
			radial-gradient(ellipse at 20% 20%, rgba(154, 106, 156, 0.3) 0%, transparent 50%),
			radial-gradient(ellipse at 80% 80%, rgba(204, 161, 98, 0.25) 0%, transparent 50%),
			radial-gradient(ellipse at 40% 80%, rgba(103, 82, 122, 0.2) 0%, transparent 40%),
			radial-gradient(ellipse at 80% 20%, rgba(227, 213, 136, 0.15) 0%, transparent 40%);
		animation: meshMove 20s ease-in-out infinite;
	}

	@keyframes meshMove {
		0%,
		100% {
			transform: translate(0, 0) rotate(0deg) scale(1);
		}
		25% {
			transform: translate(5%, 5%) rotate(2deg) scale(1.05);
		}
		50% {
			transform: translate(-5%, 10%) rotate(-1deg) scale(1.1);
		}
		75% {
			transform: translate(10%, -5%) rotate(1deg) scale(1.03);
		}
	}

	.orb {
		position: absolute;
		border-radius: 50%;
		filter: blur(60px);
		width: var(--size);
		height: var(--size);
		background: radial-gradient(circle, var(--orb-color) 0%, transparent 70%);
		left: 0;
		top: 0;
		transform: translate3d(var(--start-x), var(--start-y), 0);
		animation: randomFloat var(--duration) ease-in-out infinite alternate;
		animation-delay: var(--delay);
	}

	@keyframes randomFloat {
		0% {
			transform: translate3d(var(--start-x), var(--start-y), 0) scale(var(--scale-min));
			opacity: 0.7;
		}
		100% {
			transform: translate3d(var(--end-x), var(--end-y), 0) scale(var(--scale-max));
			opacity: 1;
		}
	}

	.grid-overlay {
		position: absolute;
		inset: 0;
		background-image:
			linear-gradient(rgba(154, 106, 156, 0.03) 1px, transparent 1px),
			linear-gradient(90deg, rgba(154, 106, 156, 0.03) 1px, transparent 1px);
		background-size: 60px 60px;
		animation: gridPulse 8s ease-in-out infinite;
	}

	@keyframes gridPulse {
		0%,
		100% {
			opacity: 0.3;
		}
		50% {
			opacity: 0.6;
		}
	}

	.shape {
		position: absolute;
		border: 1px solid var(--border-color);
		opacity: 0.4;
		width: var(--size);
		height: var(--size);
		border-radius: var(--border-radius);
		left: var(--start-x);
		top: var(--start-y);

		animation:
			shapeFloat var(--duration-float) ease-in-out infinite alternate,
			shapeRotate var(--duration-rotate) linear infinite;
		animation-delay: var(--delay);
	}

	@keyframes shapeFloat {
		0% {
			transform: translateY(0);
		}
		100% {
			transform: translateY(var(--move-y));
		}
	}

	@keyframes shapeRotate {
		from {
			rotate: 0deg;
		}
		to {
			rotate: 360deg;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.orb,
		.shape,
		.gradient-mesh,
		.grid-overlay {
			animation: none !important;
		}
	}
</style>
