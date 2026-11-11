import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanUpPackage, type ProjectIO, SETUP_CONTENT } from './cleanup.ts';

const PACKAGE_JSON = `${JSON.stringify(
	{
		scripts: { test: 'node --import tsx --import ./expect.setup.mjs --test' },
		devDependencies: { expect: '^30.0.0', tsx: '^4.21.0' },
	},
	null,
	2,
)}\n`;

const project = (files: Record<string, string>, users: string[] = []): ProjectIO => ({
	read: (path) => files[path],
	filesUsingExpect: (_, except) => users.filter((user) => !except.includes(user)),
});

describe('cleanUpPackage', () => {
	it('removes expect, its setup file and its --import once unused', async () => {
		const warnings: string[] = [];
		const cleanup = await cleanUpPackage('/app/package.json', PACKAGE_JSON, project({ '/app/expect.setup.mjs': SETUP_CONTENT }), (message) => warnings.push(message));

		assert.deepEqual(cleanup?.remove, ['/app/expect.setup.mjs']);
		assert.deepEqual(JSON.parse(cleanup?.packageJson ?? ''), {
			scripts: { test: 'node --import tsx --test' },
			devDependencies: { tsx: '^4.21.0' },
		});
		assert.ok(cleanup?.packageJson.endsWith('}\n'));
		assert.deepEqual(warnings, []);
	});

	it('keeps expect while files use it', async () => {
		const warnings: string[] = [];
		const cleanup = await cleanUpPackage('/app/package.json', PACKAGE_JSON, project({}, ['/app/a.test.ts', '/app/b.test.ts']), (message) => warnings.push(message));

		assert.equal(cleanup, null);
		assert.deepEqual(warnings, ['kept `expect`: 2 files still use it (see the warnings above).']);
	});

	it('ignores its own setup file, which imports expect', async () => {
		const files = { '/app/expect.setup.mjs': SETUP_CONTENT };
		const cleanup = await cleanUpPackage('/app/package.json', PACKAGE_JSON, project(files, ['/app/expect.setup.mjs']), () => {});

		assert.deepEqual(cleanup?.remove, ['/app/expect.setup.mjs']);
	});

	it('keeps a setup file that was changed', async () => {
		const warnings: string[] = [];
		const files = { '/app/expect.setup.mjs': `${SETUP_CONTENT}\nexpect.extend({});\n` };
		const cleanup = await cleanUpPackage('/app/package.json', PACKAGE_JSON, project(files, ['/app/expect.setup.mjs']), (message) => warnings.push(message));

		assert.equal(cleanup, null);
		assert.equal(warnings.length, 1);
	});

	it('leaves packages without expect alone', async () => {
		const cleanup = await cleanUpPackage('/app/package.json', '{ "scripts": { "test": "node --test" } }', project({}), () => {});

		assert.equal(cleanup, null);
	});
});
