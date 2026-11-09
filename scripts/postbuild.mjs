import { rm } from 'node:fs/promises';

// The adapter's generated launcher uses plaintext HTTP. Ship only scripts/start.ts.
await rm(new URL('../.deno-deploy/server.ts', import.meta.url), { force: true });
