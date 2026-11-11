import { dirname, join } from 'node:path';
import removeDependencies from '@nodejs/codemod-utils/remove-dependencies';

/** The setup file jest-to-node-test-runner adds to keep `expect.hasAssertions()` working. */
export const SETUP_FILE = 'expect.setup.mjs';

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

/** `--import ./expect.setup.mjs` (or `--import=…`) in a script. */
const SETUP_IMPORT = /\s+--import(?:=|\s+)(['"]?)(?:\.\/)?expect\.setup\.mjs\1(?=\s|$)/g;

export interface ProjectIO {
	read(path: string): string | undefined;
	/** Source files under `directory` that still import `expect`, other than `except`. */
	filesUsingExpect(directory: string, except: string[]): string[];
}

export interface Cleanup {
	packageJson: string;
	remove: string[];
}

interface PackageJson {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	scripts?: Record<string, string>;
}

const normalize = (text: string) => text.replace(/\r\n/g, '\n').trim();
const indentOf = (text: string) => /^([ \t]+)"/m.exec(text)?.[1] ?? '  ';

/**
 * Once no file of the package uses `expect`, removes it: from the dependencies, and the setup file
 * jest-to-node-test-runner added with its `--import` in the scripts.
 */
export async function cleanUpPackage(packageJsonPath: string, text: string, io: ProjectIO, warn: (message: string) => void): Promise<Cleanup | null> {
	const pkg = JSON.parse(text) as PackageJson;
	const directory = dirname(packageJsonPath);
	const setupPath = join(directory, SETUP_FILE);
	const setup = io.read(setupPath);
	const generatedSetup = setup !== undefined && normalize(setup) === normalize(SETUP_CONTENT);
	const scripts = Object.entries(pkg.scripts ?? {});
	const importsSetup = scripts.some(([, script]) => new RegExp(SETUP_IMPORT.source).test(script));
	const dependsOnExpect = !!(pkg.dependencies?.expect ?? pkg.devDependencies?.expect);
	if (!dependsOnExpect && !importsSetup && setup === undefined) return null;

	const users = io.filesUsingExpect(directory, generatedSetup ? [setupPath] : []);
	if (users.length) {
		warn(`kept \`expect\`: ${users.length} file${users.length === 1 ? '' : 's'} still use${users.length === 1 ? 's' : ''} it (see the warnings above).`);
		return null;
	}
	if (setup !== undefined && !generatedSetup) {
		warn(`kept \`expect\`: ${SETUP_FILE} was changed after the migration to node:test, remove it (and its \`--import\`) by hand.`);
		return null;
	}

	if (pkg.scripts) {
		for (const [name, script] of scripts) pkg.scripts[name] = script.replace(SETUP_IMPORT, '');
	}
	const edited = `${JSON.stringify(pkg, null, indentOf(text))}${text.endsWith('\n') ? '\n' : ''}`;
	const packageJson = dependsOnExpect
		? ((await removeDependencies('expect', { packageJsonPath, packageJsonContent: edited, runInstall: false, persistFileWrite: false })) ?? edited)
		: edited;
	return { packageJson, remove: generatedSetup ? [setupPath] : [] };
}
