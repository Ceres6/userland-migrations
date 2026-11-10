/** Packages that only exist to run jest, removed with it. */
export const JEST_TOOLING = new Set([
	'@jest/globals',
	'@jest/types',
	'@sucrase/jest-plugin',
	'@swc/jest',
	'@types/jest',
	'babel-jest',
	'esbuild-jest',
	'jest',
	'jest-circus',
	'jest-cli',
	'jest-config',
	'jest-environment-jsdom',
	'jest-environment-node',
	'jest-transform-stub',
	'jest-watch-typeahead',
	'ts-jest',
]);

type Dependencies = Record<string, string>;

export interface PackageJson {
	dependencies?: Dependencies;
	devDependencies?: Dependencies;
	jest?: unknown;
	scripts?: Record<string, string>;
	[key: string]: unknown;
}

export interface DependencyUpdate {
	/** `expect`'s version range, matching the jest it replaces. */
	expect: string;
	/** The TypeScript loader to add, if the tests need one. */
	tsx?: string;
	warn: (message: string) => void;
}

const isSorted = (keys: string[]) => keys.every((key, index) => index === 0 || keys[index - 1].localeCompare(key) <= 0);

/** Adds `name`, keeping the dependencies sorted if they were. */
function add(dependencies: Dependencies, name: string, range: string): Dependencies {
	const keys = Object.keys(dependencies);
	if (!isSorted(keys)) return { ...dependencies, [name]: range };
	const entries = Object.entries(dependencies);
	const index = entries.findIndex(([key]) => key.localeCompare(name) > 0);
	entries.splice(index === -1 ? entries.length : index, 0, [name, range]);
	return Object.fromEntries(entries);
}

/** jest's tooling the package depends on, for `removeDependencies()` to remove. */
export const jestTooling = (pkg: PackageJson) =>
	Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) => JEST_TOOLING.has(name));

/**
 * Adds `expect` (and a TypeScript loader if needed) next to jest, and reports the libraries built for jest,
 * which the migrated tests can't use as they are.
 */
export function addTestDependencies(pkg: PackageJson, { expect, tsx, warn }: DependencyUpdate): void {
	const sections = (['dependencies', 'devDependencies'] as const).filter((section) => pkg[section]);
	const target = sections.find((section) => pkg[section]?.jest) ?? 'devDependencies';
	const has = (name: string) => sections.some((section) => pkg[section]?.[name] !== undefined);

	for (const section of sections) {
		for (const name of Object.keys(pkg[section] as Dependencies)) {
			if (!JEST_TOOLING.has(name) && /(^|[/-])jest($|[/-])/.test(name)) {
				warn(`\`${name}\` is built for jest: migrate its uses (or drop it) by hand.`);
			}
		}
	}

	const additions = [['expect', expect], ...(tsx ? [['tsx', tsx]] : [])].filter(([name]) => !has(name));
	for (const [name, range] of additions) pkg[target] = add(pkg[target] ?? {}, name, range);
}
