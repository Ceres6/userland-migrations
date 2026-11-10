import assert from 'node:assert/strict';
import { basename, join } from 'node:path';
import { describe, it } from 'node:test';
import type { JestConfig } from './jest-config.ts';
import { type ProjectIO, SETUP_CONTENT, migratePackage } from './migrate.ts';

const DIRECTORY = '/repo';

function project(files: Record<string, string>, configs: Record<string, JestConfig> = {}, assertionCounts = false) {
	const io: ProjectIO = {
		exists: (path) => basename(path) in files || basename(path) in configs,
		read: (path) => files[basename(path)],
		list: () => [...Object.keys(files), ...Object.keys(configs)],
		loadConfig: async (path) => configs[basename(path)],
		installedVersion: (_, name) => ({ expect: '30.5.2', tsx: '4.23.15' })[name],
		usesAssertionCounts: () => assertionCounts,
	};
	return io;
}

const migrate = async (pkg: object, io: ProjectIO) => {
	const warnings: string[] = [];
	const result = await migratePackage(
		join(DIRECTORY, 'package.json'),
		`${JSON.stringify(pkg, null, 4)}\n`,
		io,
		(message) => warnings.push(message),
	);
	return { result, pkg: result && JSON.parse(result.packageJson), warnings };
};

describe('migratePackage', () => {
	it('leaves packages without jest alone', async () => {
		const { result } = await migrate({ scripts: { test: 'node --test' } }, project({}));
		assert.equal(result, null);
	});

	it('migrates a TypeScript project like treasury', async () => {
		const io = project(
			{ 'tsconfig.json': '{ "compilerOptions": { "strict": true } }' },
			{
				'jest.config.js': {
					testEnvironment: 'node',
					testMatch: ['<rootDir>/src/**/*.test.ts'],
					transform: { '^.+\\.ts?$': ['@swc/jest', {}] },
				},
				'jest.config.integration.js': { testTimeout: 20000, testMatch: ['<rootDir>/src/**/infrastructure/**/*.test.ts'] },
			},
			true,
		);
		const { result, pkg, warnings } = await migrate(
			{
				scripts: {
					'test:unit': 'NODE_ENV=test jest --verbose',
					'test:integration': 'NODE_ENV=test jest --config=jest.config.integration.js --verbose --runInBand',
					lint: 'eslint .',
				},
				devDependencies: {
					'@swc/jest': '^0.2.36',
					'@types/jest': '^30.0.0',
					jest: '^30.5.2',
					'jest-when': '^4.0.3',
					typescript: '6.0.3',
				},
			},
			io,
		);

		assert.deepEqual(pkg.scripts, {
			'test:unit': 'NODE_ENV=test node --import tsx --import ./expect.setup.mjs --test "src/**/*.test.ts"',
			'test:integration':
				'NODE_ENV=test node --import tsx --import ./expect.setup.mjs --test --test-timeout=20000 --test-concurrency=1 "src/**/infrastructure/**/*.test.ts"',
			lint: 'eslint .',
		});
		assert.deepEqual(pkg.devDependencies, { expect: '^30.5.2', 'jest-when': '^4.0.3', tsx: '^4.23.15', typescript: '6.0.3' });
		assert.deepEqual(result?.remove.sort(), ['/repo/jest.config.integration.js', '/repo/jest.config.js']);
		assert.deepEqual(result?.write, [['/repo/expect.setup.mjs', SETUP_CONTENT]]);
		assert.ok(result?.packageJson.startsWith('{\n    "scripts"'), 'keeps the indentation');
		assert.ok(warnings.some((warning) => warning.includes('jest-when')));
	});

	it('reads the configuration from package.json', async () => {
		const { pkg } = await migrate(
			{ scripts: { test: 'jest' }, jest: { testMatch: ['**/*.spec.js'] }, devDependencies: { jest: '^30.0.0' } },
			project({}),
		);
		assert.equal(pkg.scripts.test, 'node --test "**/*.spec.js"');
		assert.equal(pkg.jest, undefined);
		assert.deepEqual(pkg.devDependencies, { expect: '^30.5.2' });
	});

	it("relies on Node.js' type stripping for erasable TypeScript", async () => {
		const { pkg } = await migrate(
			{ scripts: { test: 'jest' }, jest: { testMatch: ['**/*.test.ts'] }, devDependencies: { jest: '^30.0.0', typescript: '^6.0.0' } },
			project({ 'tsconfig.json': '{ "compilerOptions": { "erasableSyntaxOnly": true } }' }),
		);
		assert.equal(pkg.scripts.test, 'node --test "**/*.test.ts"');
		assert.equal(pkg.devDependencies.tsx, undefined);
	});

	it("doesn't overwrite a setup file of the user's", async () => {
		const { result, pkg, warnings } = await migrate(
			{ scripts: { test: 'jest' }, devDependencies: { jest: '^30.0.0' } },
			project({ 'expect.setup.mjs': '// mine' }, {}, true),
		);
		assert.deepEqual(result?.write, []);
		assert.ok(!pkg.scripts.test.includes('expect.setup.mjs'));
		assert.equal(warnings.length, 1);
	});

	it('reports jest configurations no script uses', async () => {
		const { result, warnings } = await migrate(
			{ scripts: { test: 'jest' }, devDependencies: { jest: '^30.0.0' } },
			project({}, { 'jest.config.js': {}, 'jest.config.e2e.js': {} }),
		);
		assert.deepEqual(result?.remove, ['/repo/jest.config.js']);
		assert.ok(warnings.some((warning) => warning.startsWith('jest.config.e2e.js')));
	});
});
