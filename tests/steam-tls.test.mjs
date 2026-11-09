import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { SteamClient } from '../src/lib/server/steam/client.ts';

test('Steam discovery selects only TLS WebSockets on initial and repeated connections', async () => {
	const require = createRequire(import.meta.resolve('steam-user'));
	const websocket = require('websocket13');
	const original = websocket.WebSocket;
	const urls = [];
	class Socket extends EventEmitter {
		state = websocket.State.Connecting;
		constructor(url) {
			super();
			urls.push(url);
		}
		setTimeout() {}
		disconnect() {
			this.state = websocket.State.Disconnected;
		}
	}
	websocket.WebSocket = Socket;
	const wrapper = new SteamClient('synthetic-transport-test');
	const client = wrapper.client;
	const servers = [
		{ type: 'netfilter', endpoint: 'tcp.invalid:27017', realm: 'steamglobal', wtd_load: 0 },
		{ type: 'websockets', endpoint: 'other-port.invalid:27024', realm: 'steamglobal', wtd_load: 1 },
		{ type: 'websockets', endpoint: 'tls.invalid:443', realm: 'steamglobal', wtd_load: 2 }
	];
	client._logOnDetails = {};
	client._apiRequest = async (method, service, action, version, query) => {
		assert.equal(query.cmtype, 'websockets');
		return { response: { serverlist: servers } };
	};
	try {
		assert.equal(client.options.webCompatibilityMode, true);
		await client._doConnection();
		client._connection.end(true);
		await client._doConnection();
		assert.deepEqual(urls, ['wss://tls.invalid:443/cmsocket/', 'wss://tls.invalid:443/cmsocket/']);
		client._connection.end(true);
		servers.pop();
		await client._doConnection();
		assert.equal(wrapper.status, 'ERROR');
		assert.equal(urls.length, 2, 'No TCP or other-port fallback when a TLS CM is unavailable');
	} finally {
		client._connection?.end(true);
		websocket.WebSocket = original;
	}
});
