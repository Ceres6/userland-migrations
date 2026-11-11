/// <reference types="@codemod.com/jssg-types/runtime" />
/**
 * Runs in JSSG, which provides a subset of Node.js' APIs: https://github.com/awslabs/llrt/blob/main/API.md
 */
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { warn } from 'codemod:runtime';
import type { SgRoot, TransformOptions } from '@codemod.com/jssg-types/main';
import type Json from '@codemod.com/jssg-types/langs/json';
import { cleanUpPackage, type ProjectIO } from './project/cleanup.ts';

const SKIPPED_DIRECTORIES = new Set(['.git', '.next', 'build', 'coverage', 'dist', 'node_modules', 'out']);
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const IMPORTS_EXPECT = /\bfrom\s*['"]expect['"]|\b(?:require|import)\(\s*['"]expect['"]\s*\)/;

const read = (path: string) => {
	try {
		return readFileSync(path, 'utf8');
	} catch {
		return undefined;
	}
};

function filesUsingExpect(directory: string, except: string[]): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			if (!SKIPPED_DIRECTORIES.has(entry.name)) found.push(...filesUsingExpect(path, except));
		} else if (SOURCE_FILE.test(entry.name) && !except.includes(path) && IMPORTS_EXPECT.test(read(path) ?? '')) {
			found.push(path);
		}
	}
	return found;
}

const io: ProjectIO = { read, filesUsingExpect };

/**
 * Removes `expect` from a package whose files no longer use it.
 */
export default async function transform(root: SgRoot<Json>, options?: TransformOptions<Json>): Promise<string | null> {
	const path = root.filename();
	if (path.split(/[\\/]/).includes('node_modules')) return null;

	const cleanup = await cleanUpPackage(path, root.root().text(), io, (message) => warn(`${root.relativeFilename()}: ${message}`));
	if (!cleanup) return null;
	if (!options?.dryRun) for (const file of cleanup.remove) rmSync(file);
	return cleanup.packageJson;
}
