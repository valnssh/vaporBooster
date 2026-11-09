import assert from 'node:assert/strict';
import { test } from 'node:test';
import { httpsHandler, httpsOrigin, validateHttpsEnvironment } from '../scripts/https.mjs';

test('HTTPS configuration rejects insecure origins and ambiguous URL components', () => {
	assert.equal(
		httpsOrigin('https://hours.example.com:443/', 'ORIGIN'),
		'https://hours.example.com'
	);
	for (const value of [
		undefined,
		'',
		'http://localhost:8443',
		'http://127.0.0.1',
		'https://name:password@hours.example.com',
		'https://hours.example.com/path',
		'https://hours.example.com?query=1',
		'https://hours.example.com#fragment'
	])
		assert.throws(() => httpsOrigin(value, 'ORIGIN'), /HTTPS/);
	const environment = {
		ORIGIN: 'https://hours.example.com',
		BETTER_AUTH_URL: 'https://hours.example.com/'
	};
	assert.equal(validateHttpsEnvironment(environment), environment.ORIGIN);
	assert.throws(
		() => validateHttpsEnvironment({ ...environment, BETTER_AUTH_URL: 'https://other.invalid' }),
		/same HTTPS origin/
	);
	assert.throws(
		() => validateHttpsEnvironment({ ...environment, NODE_TLS_REJECT_UNAUTHORIZED: '0' }),
		/verification/
	);
});

test('HTTP and unexpected authority are rejected before application work, regardless of forwarded headers', async () => {
	let calls = 0;
	const handler = httpsHandler(() => {
		calls++;
		return new Response('application response');
	}, 'https://hours.example.com');
	for (const [url, status] of [
		['http://hours.example.com/', 400],
		['https://untrusted.invalid/', 421],
		['https://hours.example.com:8443/', 421],
		['https://hours.example.com/privkey.pem', 404],
		['https://hours.example.com/certs/private-material', 404],
		['https://hours.example.com/.private/full-stack/state.json', 404],
		['https://hours.example.com/%2eprivate/full-stack/compose.env', 404],
		['https://hours.example.com/privkey%2epem', 404]
	]) {
		const response = await handler(
			new Request(url, {
				headers: { 'X-Forwarded-Host': 'hours.example.com', 'X-Forwarded-Proto': 'https' }
			})
		);
		assert.equal(response.status, status);
		assert.match(response.headers.get('strict-transport-security'), /^max-age=[1-9]\d*/);
		assert.doesNotMatch(await response.text(), /application response/);
	}
	assert.equal(calls, 0);
	const response = await handler(
		new Request('https://hours.example.com/_app/immutable/test.js', {
			headers: { 'X-Forwarded-Host': 'untrusted.invalid', 'X-Forwarded-Proto': 'http' }
		})
	);
	assert.equal(calls, 1);
	assert.equal(await response.text(), 'application response');
	assert.match(response.headers.get('strict-transport-security'), /^max-age=[1-9]\d*/);
	assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('adapter errors retain HSTS and omit private error details', async () => {
	for (const [name, status] of [
		['NotFound', 404],
		['Error', 500]
	]) {
		const handler = httpsHandler(() => {
			const failure = new Error('private-key-or-path-must-not-leak');
			failure.name = name;
			throw failure;
		}, 'https://hours.example.com');
		const response = await handler(new Request('https://hours.example.com/missing'));
		assert.equal(response.status, status);
		assert.match(response.headers.get('strict-transport-security'), /^max-age=[1-9]\d*/);
		assert.doesNotMatch(await response.text(), /private-key-or-path-must-not-leak/);
	}
});
