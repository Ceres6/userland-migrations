import { isAbsolute, relative, resolve } from 'node:path';
import { quote } from './jest-cli.ts';

export type JestConfig = Record<string, unknown>;

/** jest 30's default `testMatch`, which node --test's globs understand as is. */
export const DEFAULT_TEST_MATCH = ['**/__tests__/**/*.?([mc])[jt]s?(x)', '**/?(*.)+(spec|test).?([mc])[jt]s?(x)'];

/** Settings that only matter to jest itself (caching, transforms, module formats…). */
const IRRELEVANT = new Set([
	'automock',
	'cacheDirectory',
	'collectCoverage',
	'collectCoverageFrom',
	'coverageDirectory',
	'coverageProvider',
	'coverageReporters',
	'coverageThreshold',
	'displayName',
	'extensionsToTreatAsEsm',
	'globals',
	'haste',
	'injectGlobals',
	'moduleFileExtensions',
	'preset',
	'rootDir',
	'roots',
	'setupFiles',
	'setupFilesAfterEnv',
	'testEnvironment',
	'testMatch',
	'testPathIgnorePatterns',
	'testRegex',
	'testTimeout',
	'transform',
	'transformIgnorePatterns',
	'verbose',
	'watchPathIgnorePatterns',
	'watchPlugins',
	'workerIdleMemoryLimit',
	'maxWorkers',
	'coveragePathIgnorePatterns',
]);

const HINTS: Record<string, string> = {
	clearMocks: 'clear the mocks in an `afterEach` hook',
	fakeTimers: 'enable them with `mock.timers.enable()` where needed',
	globalSetup: 'node --test runs a module exporting `globalSetup`/`globalTeardown` with `--test-global-setup`',
	globalTeardown: 'node --test runs a module exporting `globalSetup`/`globalTeardown` with `--test-global-setup`',
	moduleNameMapper: 'map modules with package.json "imports" or a module customization hook',
	projects: 'run each project with its own node --test command',
	reporters: 'node --test reporters are set with `--test-reporter`',
	resetMocks: 'reset the mocks in an `afterEach` hook',
	restoreMocks: 'call `mock.restoreAll()` in an `afterEach` hook',
	snapshotSerializers: 'serialize snapshots with `snapshot.setDefaultSnapshotSerializers()`',
};

const DEFAULT_IGNORE = /^\/?node_modules\/?$/;

export interface TestCommand {
	/** Modules to `--import`, after the TypeScript loader. */
	imports: string[];
	options: string[];
	patterns: string[];
}

export interface TranslateOptions {
	config: JestConfig;
	/** Directory jest resolves `<rootDir>` and relative paths from. */
	configDirectory: string;
	/** Directory the script runs in. */
	packageDirectory: string;
	coverage: boolean;
	warn: (message: string) => void;
}

const asArray = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : typeof value === 'string' ? [value] : [];

/** Translates a jest configuration to the parts of a node --test command. */
export function translateConfig({ config, configDirectory, packageDirectory, coverage, warn }: TranslateOptions): TestCommand {
	const rootDir = resolve(configDirectory, typeof config.rootDir === 'string' ? config.rootDir : '.');
	const fromPackage = (path: string) => {
		const absolute = resolve(rootDir, path.replaceAll('<rootDir>', rootDir));
		return relative(packageDirectory, absolute) || '.';
	};
	const asModule = (path: string) => {
		// A package name, like `@testing-library/jest-dom`
		if (!path.startsWith('<rootDir>') && !path.startsWith('.') && !isAbsolute(path)) return path;
		const relativePath = fromPackage(path);
		return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
	};

	const command: TestCommand = { imports: [], options: [], patterns: [] };

	for (const key of Object.keys(config)) {
		if (IRRELEVANT.has(key)) continue;
		if (key in HINTS) warn(`jest's \`${key}\` was not migrated: ${HINTS[key]}.`);
		else if (config[key] !== undefined) warn(`jest's \`${key}\` has no node --test equivalent and was dropped.`);
	}

	if (typeof config.preset === 'string' && !config.preset.startsWith('ts-jest')) {
		warn(`jest's \`preset: ${config.preset}\` was not migrated: review the settings it provided.`);
	}

	const environment = config.testEnvironment;
	if (typeof environment === 'string' && !['node', 'jest-environment-node'].includes(environment)) {
		warn(`jest's \`testEnvironment: ${environment}\` has no node --test equivalent: set the environment up with \`--import\` (e.g. global-jsdom/register).`);
	}

	if (config.testRegex !== undefined) {
		warn("jest's `testRegex` can't be expressed as globs: node --test's default patterns are used, pass globs to restrict them.");
	} else {
		const roots = asArray(config.roots).length ? asArray(config.roots) : ['<rootDir>'];
		const testMatch = asArray(config.testMatch).length ? asArray(config.testMatch) : DEFAULT_TEST_MATCH;
		for (const pattern of testMatch) {
			if (pattern.startsWith('!')) {
				warn(`jest's negated \`testMatch\` \`${pattern}\` can't be expressed as a node --test glob and was dropped.`);
			} else if (pattern.startsWith('<rootDir>') || isAbsolute(pattern)) {
				command.patterns.push(fromPackage(pattern));
			} else {
				// jest matches relative globs anywhere under its roots
				for (const root of roots) {
					const base = fromPackage(root);
					command.patterns.push(base === '.' ? pattern : `${base}/${pattern}`);
				}
			}
		}
	}

	const ignored = asArray(config.testPathIgnorePatterns).filter((pattern) => !DEFAULT_IGNORE.test(pattern));
	if (ignored.length) {
		warn(
			`jest's \`testPathIgnorePatterns\` (${ignored.map((pattern) => `\`${pattern}\``).join(', ')}) can't be expressed as node --test globs: narrow the globs or rename the ignored files so they don't match.`,
		);
	}

	for (const file of [...asArray(config.setupFiles), ...asArray(config.setupFilesAfterEnv)]) {
		command.imports.push(asModule(file));
	}

	if (typeof config.testTimeout === 'number') command.options.push(`--test-timeout=${config.testTimeout}`);
	if (typeof config.maxWorkers === 'number') command.options.push(`--test-concurrency=${config.maxWorkers}`);

	if (coverage || config.collectCoverage === true) {
		command.options.push('--experimental-test-coverage');
		for (const pattern of asArray(config.collectCoverageFrom)) {
			const negated = pattern.startsWith('!');
			const glob = fromPackage(negated ? pattern.slice(1) : pattern);
			command.options.push(`--test-coverage-${negated ? 'exclude' : 'include'}=${quote(glob)}`);
		}
		const thresholds = (config.coverageThreshold as { global?: Record<string, unknown> } | undefined)?.global ?? {};
		for (const metric of ['lines', 'branches', 'functions']) {
			if (typeof thresholds[metric] === 'number') command.options.push(`--test-coverage-${metric}=${thresholds[metric]}`);
		}
		if (thresholds.statements !== undefined) warn("node --test has no statements coverage threshold: jest's was dropped.");
		if (asArray(config.coverageReporters).includes('lcov')) {
			const directory = fromPackage(typeof config.coverageDirectory === 'string' ? config.coverageDirectory : 'coverage');
			command.options.push(
				'--test-reporter=spec',
				'--test-reporter-destination=stdout',
				'--test-reporter=lcov',
				`--test-reporter-destination=${quote(`${directory}/lcov.info`)}`,
			);
		}
	}

	return command;
}

/** Whether jest's configuration transforms TypeScript or JSX test files. */
export const transformsTypeScript = (config: JestConfig) =>
	/ts-jest|@swc\/jest|babel-jest|esbuild-jest|sucrase/.test(JSON.stringify(config.transform ?? config.preset ?? ''));
