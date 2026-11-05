export function privateEnvModule() {
	const declarations = Object.keys(process.env)
		.filter((name) => /^[A-Za-z_$][\w$]*$/.test(name))
		.map((name) => `export const ${name} = process.env[${JSON.stringify(name)}];`)
		.join('\n');
	return { url: `data:text/javascript,${encodeURIComponent(declarations)}`, shortCircuit: true };
}
