import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

// This certificate is trusted only by test clients, never the operating system.
export async function createTlsFixture() {
	const tempRoot = await realpath(tmpdir());
	const directory = await mkdtemp(join(tempRoot, 'hoursbooster-test-tls-'));
	const certFile = join(directory, 'localhost-cert.pem');
	const keyFile = join(directory, 'localhost-key.pem');
	const cleanup = async () => {
		const child = relative(tempRoot, directory);
		if (!child || child.startsWith('..') || isAbsolute(child)) {
			throw new Error('Refusing to clean a TLS fixture outside its temporary directory');
		}
		await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	};
	try {
		await run(
			process.env.OPENSSL_BINARY || 'openssl',
			[
				'req',
				'-x509',
				'-newkey',
				'rsa:2048',
				'-sha256',
				'-nodes',
				'-days',
				'2',
				'-keyout',
				keyFile,
				'-out',
				certFile,
				'-subj',
				'/CN=localhost',
				'-addext',
				'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1',
				'-addext',
				'basicConstraints=critical,CA:TRUE',
				'-addext',
				'extendedKeyUsage=serverAuth'
			],
			{ windowsHide: true }
		);
		return {
			directory,
			certFile,
			keyFile,
			cert: await readFile(certFile),
			key: await readFile(keyFile),
			cleanup
		};
	} catch (failure) {
		await cleanup();
		throw failure;
	}
}
