import { readFile } from 'node:fs/promises';
import { Agent } from 'node:https';
import { createRequire } from 'node:module';

const { WebSocket, State } = createRequire(import.meta.resolve('steam-session'))('websocket13');
const [target, certificateFile] = Deno.args;
const url = new URL(target);
if (
	url.protocol !== 'wss:' ||
	url.hostname !== '127.0.0.1' ||
	!url.port ||
	url.username ||
	url.password ||
	url.pathname !== '/' ||
	url.search ||
	url.hash ||
	process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0'
)
	throw new Error('The TLS probe requires a verified, isolated loopback WSS target');
const ca = await readFile(certificateFile);

async function probe(trusted, servername) {
	const agent = new Agent({ ...(trusted ? { ca } : {}), keepAlive: false });
	return new Promise((done) => {
		let settled = false;
		let socket;
		const finish = (result) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			agent.destroy();
			if (socket?.state === State.Connecting) socket.disconnect();
			done(result);
		};
		const timer = setTimeout(
			() => finish({ code: 'PROBE_TIMEOUT', message: 'TLS probe timed out', status: null }),
			10_000
		);
		const rejected = (failure) =>
			finish({
				code:
					typeof failure.code === 'string' && /^[A-Z0-9_]+$/i.test(failure.code)
						? failure.code
						: 'CONNECTION_REJECTED',
				// Never serialize the response body, headers, certificate or error object.
				message: String(failure.message || 'Connection rejected')
					.replace(/[^\x20-\x7e]/g, ' ')
					.slice(0, 300),
				status: Number.isInteger(failure.responseCode) ? failure.responseCode : null
			});
		try {
			socket = new WebSocket(target, {
				connection: { agent, servername },
				permessageDeflate: false
			});
			socket.on('error', rejected);
			socket.on('connected', () =>
				finish({
					code: 'UNEXPECTED_UPGRADE',
					message: 'Server unexpectedly upgraded the probe',
					status: 101
				})
			);
		} catch (failure) {
			rejected(failure);
		}
	});
}

console.log(
	JSON.stringify([
		await probe(false, 'localhost'),
		await probe(true, 'wrong.example.invalid'),
		await probe(true, 'localhost')
	])
);
