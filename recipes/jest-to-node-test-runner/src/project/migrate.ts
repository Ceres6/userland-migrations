import { dirname, join, resolve } from 'node:path';
import removeDependencies from '@nodejs/codemod-utils/remove-dependencies';
import { JEST_TOOLING, type PackageJson, addTestDependencies, jestTooling } from './dependencies.ts';
import { quote, translateArguments } from './jest-cli.ts';
import { type JestConfig, transformsTypeScript, translateConfig } from './jest-config.ts';
import { findJestCommands, replaceJestCommands } from './scripts.ts';

/** jest's default configuration files, in the order it looks for them. */
const DEFAULT_CONFIGS = ['jest.config.js', 'jest.config.ts', 'jest.config.mjs', 'jest.config.cjs', 'jest.config.mts', 'jest.config.cts', 'jest.config.json'];

export const SETUP_FILE = 'expect.setup.mjs';

/**
 * jest checks `expect.assertions()` / `expect.hasAssertions()` after each test; node:test doesn't know about
 * them. Imported in every test process, these hooks do what jest did.
 */
export const SETUP_CONTENT = `// Checks expect.assertions() and expect.hasAssertions() after each test, as jest did.
import { afterEach, beforeEach } from 'node:test';
import { expect } from 'expect';

beforeEach(() => {
	expect.setState({ assertionCalls: 0, expectedAssertionsNumber: null, isExpectingAssertions: false });
});

afterEach((t) => {
	const [failure] = expect.extractExpectedAssertionsErrors();
	// A failed test already reports its own error
	if (failure && t.passed) throw failure.error;
});
`;

const FALLBACK_VERSIONS = { expect: '^30.0.0', tsx: '^4.21.0' };

export interface ProjectIO {
	exists(path: string): boolean;
	read(path: string): string | undefined;
	/** Files in a directory (names only). */
	list(directory: string): string[];
	/** Evaluates a jest configuration file, as jest would. */
	loadConfig(path: string): Promise<JestConfig>;
	/** Version of a package installed for `directory`. */
	installedVersion(directory: string, name: string): string | undefined;
	/** Whether the tests use `expect.assertions()` or `expect.hasAssertions()`. */
	usesAssertionCounts(directory: string): boolean;
}

export interface Migration {
	packageJson: string;
	remove: string[];
	write: Array<[path: string, content: string]>;
}

interface LoadedConfig {
	config: JestConfig;
	directory: string;
	file?: string;
}

const indentOf = (text: string) => /^([ \t]+)"/m.exec(text)?.[1] ?? '  ';

/**
 * Which TypeScript support the tests need: none, Node.js' own type stripping (when the project sticks to
 * erasable syntax), or the tsx loader (enums, parameter properties, JSX…).
 */
function typeScriptSupport(directory: string, pkg: PackageJson, configs: JestConfig[], io: ProjectIO) {
	const tsconfig = io.read(join(directory, 'tsconfig.json'));
	const usesTypeScript =
		tsconfig !== undefined ||
		!!pkg.devDependencies?.typescript ||
		!!pkg.dependencies?.typescript ||
		configs.some(transformsTypeScript);
	if (!usesTypeScript) return 'none';
	return tsconfig && /"erasableSyntaxOnly"\s*:\s*true/.test(tsconfig) ? 'native' : 'tsx';
}

/**
 * Migrates a package's jest setup: scripts run node --test, jest's configuration goes, and its tooling is
 * swapped for `expect` (and a TypeScript loader if the tests need one).
 */
export async function migratePackage(
	packageJsonPath: string,
	text: string,
	io: ProjectIO,
	warn: (message: string) => void,
): Promise<Migration | null> {
	const pkg = JSON.parse(text) as PackageJson;
	const directory = dirname(resolve(packageJsonPath));
	const scripts = Object.entries(pkg.scripts ?? {}).filter(
		([, script]) => typeof script === 'string' && findJestCommands(script).length,
	);
	const hasJest = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some((name) => JEST_TOOLING.has(name));
	if (!scripts.length && !hasJest && pkg.jest === undefined) return null;

	const defaultConfig = DEFAULT_CONFIGS.map((name) => join(directory, name)).find((path) => io.exists(path));
	const loaded = new Map<string, Promise<LoadedConfig>>();
	const load = (configArgument?: string): Promise<LoadedConfig> => {
		const key = configArgument ?? '';
		if (!loaded.has(key)) {
			loaded.set(
				key,
				(async () => {
					if (configArgument?.trim().startsWith('{')) return { config: JSON.parse(configArgument), directory };
					const file = configArgument ? resolve(directory, configArgument) : defaultConfig;
					if (file) return { config: await io.loadConfig(file), directory: dirname(file), file };
					return { config: (pkg.jest as JestConfig) ?? {}, directory };
				})(),
			);
		}
		return loaded.get(key)!;
	};

	// Configurations first: the TypeScript decision depends on all of them
	const invocations = scripts.map(([name, script]) => ({
		name,
		script,
		commands: findJestCommands(script).map((command) => translateArguments(command.args, (message) => warn(`"${name}": ${message}`))),
	}));
	const configs = new Map<string, LoadedConfig>();
	for (const { commands } of invocations) {
		for (const command of commands) configs.set(command.config ?? '', await load(command.config));
	}
	if (!configs.size) configs.set('', await load());

	const typeScript = typeScriptSupport(directory, pkg, [...configs.values()].map(({ config }) => config), io);
	const write: Migration['write'] = [];

	let setupImport: string | undefined;
	if (io.usesAssertionCounts(directory)) {
		const setupPath = join(directory, SETUP_FILE);
		const existing = io.read(setupPath);
		if (existing === undefined) write.push([setupPath, SETUP_CONTENT]);
		if (existing === undefined || existing === SETUP_CONTENT) setupImport = `./${SETUP_FILE}`;
		else warn(`${SETUP_FILE} exists already: import the hooks checking expect.assertions() from your own setup file.`);
	}

	let usesLoader = false;
	for (const { name, script, commands } of invocations) {
		let index = 0;
		pkg.scripts![name] = replaceJestCommands(script, () => {
			const invocation = commands[index++];
			const { config, directory: configDirectory } = configs.get(invocation.config ?? '')!;
			const test = translateConfig({
				config,
				configDirectory,
				packageDirectory: directory,
				coverage: invocation.coverage,
				warn: (message) => warn(`"${name}": ${message}`),
			});
			const usesJsx = test.patterns.some((pattern) => /tsx|jsx|\?\(x\)/.test(pattern));
			const loader = typeScript === 'tsx' || (typeScript === 'native' && usesJsx) ? ['tsx'] : [];
			if (loader.length) usesLoader = true;
			const imports = [...loader, ...test.imports, ...(setupImport ? [setupImport] : [])];
			return [
				'node',
				...imports.flatMap((module) => ['--import', module]),
				'--test',
				...test.options,
				...invocation.options,
				...test.patterns.map(quote),
			].join(' ');
		});
	}

	if (!scripts.length) {
		warn('No script runs jest: run the tests with `node --test` (see the codemod README for the options).');
	}

	const installed = (name: string) => {
		const version = io.installedVersion(directory, name);
		return version ? `^${version}` : undefined;
	};
	addTestDependencies(pkg, {
		// `expect` is released with jest, under the same version
		expect: installed('expect') ?? pkg.devDependencies?.jest ?? pkg.dependencies?.jest ?? FALLBACK_VERSIONS.expect,
		tsx: usesLoader || (typeScript === 'tsx' && !scripts.length) ? (installed('tsx') ?? FALLBACK_VERSIONS.tsx) : undefined,
		warn,
	});
	delete pkg.jest;

	// jest's configuration files go with it; others named like them are reported
	const used = new Set([...configs.values()].map(({ file }) => file).filter((file): file is string => !!file));
	if (defaultConfig) used.add(defaultConfig);
	for (const file of io.list(directory)) {
		if (/^jest\.config\./.test(file) && !used.has(join(directory, file))) {
			warn(`${file} isn't used by any script and was left in place: delete it if it's jest's.`);
		}
	}

	const edited = `${JSON.stringify(pkg, null, indentOf(text))}${text.endsWith('\n') ? '\n' : ''}`;
	const tooling = jestTooling(pkg);
	const packageJson = tooling.length
		? ((await removeDependencies(tooling, {
				packageJsonPath,
				packageJsonContent: edited,
				runInstall: false,
				persistFileWrite: false,
			})) ?? edited)
		: edited;

	return {
		packageJson,
		remove: [...used],
		write,
	};
}

