<script lang="ts">
	import { icons, type IconName } from './icons';

	interface Props {
		name: IconName;
		size?: number;
		class?: string;
	}

	let { name, size = 18, class: className = '' }: Props = $props();

	const icon = $derived(icons[name]);
	const fill = $derived('fill' in icon ? (icon.fill as string) : 'none');
	const stroke = $derived('stroke' in icon ? (icon.stroke as string) : 'currentColor');
	const strokeWidth = $derived('strokeWidth' in icon ? (icon.strokeWidth as number) : 2);
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	{fill}
	{stroke}
	stroke-width={strokeWidth}
	stroke-linecap="round"
	stroke-linejoin="round"
	class={className}
>
	{@html icon.path}
</svg>
