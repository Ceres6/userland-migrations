import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_TEST_MATCH, type JestConfig, translateConfig } from './jest-config.ts';

const translate = (config: JestConfig, { coverage = false, configDirectory = '/repo' } = {}) => {
	const warnings: string[] = [];
	const command = translateConfig({
		config,
		configDirectory,
		packageDirectory: '/repo',
		coverage,
		warn: (message) => warnings.push(message),
	});
	return { ...command, warnings };
};

describe('translateConfig', () => {
	it("uses jest's default patterns", () => {
		assert.deepEqual(translate({}).patterns, DEFAULT_TEST_MATCH);
	});

	it('resolves <rootDir> and roots', () => {
		assert.deepEqual(translate({ testMatch: ['<rootDir>/src/**/*.test.ts'] }).patterns, ['src/**/*.test.ts']);
		assert.deepEqual(translate({ roots: ['<rootDir>/src', '<rootDir>/lib'], testMatch: ['**/*.test.js'] }).patterns, [
			'src/**/*.test.js',
			'lib/**/*.test.js',
		]);
		assert.deepEqual(translate({ testMatch: ['<rootDir>/**/*.test.ts'] }, { configDirectory: '/repo/packages/a' }).patterns, [
			'packages/a/**/*.test.ts',
		]);
	});

	it('imports the setup files', () => {
		assert.deepEqual(
			translate({ setupFiles: ['<rootDir>/tests/env.ts'], setupFilesAfterEnv: ['@testing-library/jest-dom', './tests/setup.ts'] }).imports,
			['./tests/env.ts', '@testing-library/jest-dom', './tests/setup.ts'],
		);
	});

	it('maps the timeout and the workers', () => {
		assert.deepEqual(translate({ testTimeout: 20000, maxWorkers: 2 }).options, ['--test-timeout=20000', '--test-concurrency=2']);
	});

	it("warns about what globs can't express", () => {
		const { warnings } = translate({ testPathIgnorePatterns: ['/node_modules/', '<rootDir>/(.*)/infrastructure/(.*)'] });
		assert.equal(warnings.length, 1);
		assert.match(warnings[0], /infrastructure/);
	});

	it('ignores what only matters to jest', () => {
		const { warnings } = translate({
			testEnvironment: 'node',
			cacheDirectory: '.tmp/jestCache',
			transform: { '^.+\\.ts?$': ['@swc/jest', {}] },
			transformIgnorePatterns: [],
			extensionsToTreatAsEsm: ['.ts'],
			coverageDirectory: './reports/coverage',
		});
		assert.deepEqual(warnings, []);
	});

	it('warns about the environment, the module mapper and the mocks settings', () => {
		const { warnings } = translate({ testEnvironment: 'jsdom', moduleNameMapper: {}, restoreMocks: true });
		assert.equal(warnings.length, 3);
	});

	it('maps coverage when it is collected', () => {
		const config = {
			collectCoverageFrom: ['src/**/*.ts', '!**/*.test.ts'],
			coverageThreshold: { global: { lines: 95, branches: 90, statements: 95 } },
		};
		assert.deepEqual(translate(config).options, []);
		const { options, warnings } = translate(config, { coverage: true });
		assert.deepEqual(options, [
			'--experimental-test-coverage',
			'--test-coverage-include="src/**/*.ts"',
			'--test-coverage-exclude="**/*.test.ts"',
			'--test-coverage-lines=95',
			'--test-coverage-branches=90',
		]);
		assert.equal(warnings.length, 1);
	});
});
