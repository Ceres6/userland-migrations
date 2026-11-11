/// <reference types="@codemod.com/jssg-types/runtime" />
/**
 * Runs in JSSG, which provides a subset of Node.js' APIs: https://github.com/awslabs/llrt/blob/main/API.md
 */
// A namespace: dry runs provide other functions (no `rmSync`), and a missing named import fails the whole step
import * as fs from 'node:fs';
import { join } from 'node:path';
import { warn } from 'codemod:runtime';
import type { SgRoot, TransformOptions } from '@codemod.com/jssg-types/main';
import type Json from '@codemod.com/jssg-types/langs/json';
import { cleanUpPackage, type ProjectIO } from './project/cleanup.ts';
import { migrateFile } from './workflow.ts';

const SKIPPED_DIRECTORIES = new Set(['.git', '.next', 'build', 'coverage', 'dist', 'node_modules', 'out']);
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const IMPORTS_EXPECT = /\bfrom\s*['"]expect['"]|\b(?:require|import)\(\s*['"]expect['"]\s*\)/;

const read = (path: string) => {
	try {
		return fs.readFileSync(path, 'utf8');
	} catch {
		return undefined;
	}
};

/**
 * Source files under `directory` that import `expect`. A dry run doesn't write the code step's changes, so
 * there it looks at the files as that step would leave them.
 */
function filesUsingExpect(directory: string, except: string[], dryRun: boolean): string[] {
	const found: string[] = [];
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			if (!SKIPPED_DIRECTORIES.has(entry.name)) found.push(...filesUsingExpect(path, except, dryRun));
			continue;
		}
		if (!SOURCE_FILE.test(entry.name) || except.includes(path)) continue;
		const text = read(path) ?? '';
		if (!IMPORTS_EXPECT.test(text)) continue;
		const migrated = dryRun ? (migrateFile(path, path, text)?.text ?? text) : text;
		if (IMPORTS_EXPECT.test(migrated)) found.push(path);
	}
	return found;
}

/**
 * Removes `expect` from a package whose files no longer use it.
 */
export default async function transform(root: SgRoot<Json>, options?: TransformOptions<Json>): Promise<string | null> {
	const path = root.filename();
	if (path.split(/[\\/]/).includes('node_modules')) return null;

	const dryRun = !!options?.dryRun;
	const io: ProjectIO = { read, filesUsingExpect: (directory, except) => filesUsingExpect(directory, except, dryRun) };
	const cleanup = await cleanUpPackage(path, root.root().text(), io, (message) => warn(`${root.relativeFilename()}: ${message}`));
	if (!cleanup) return null;
	if (!dryRun) for (const file of cleanup.remove) fs.rmSync(file);
	return cleanup.packageJson;
}
