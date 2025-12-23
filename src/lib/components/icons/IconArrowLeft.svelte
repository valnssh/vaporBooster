<script lang="ts">
	let { class: className = '' } = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width="18"
	height="18"
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	class={className}
>
	<line x1="19" y1="12" x2="5" y2="12"></line>
	<polyline points="12 19 5 12 12 5"></polyline>
</svg>
