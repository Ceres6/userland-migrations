/// <reference types="@codemod.com/jssg-types/runtime" />
/**
 * Runs in JSSG, which provides a subset of Node.js' APIs: https://github.com/awslabs/llrt/blob/main/API.md
 */
import { spawn } from 'node:child_process';
import { accessSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { warn } from 'codemod:runtime';
import type { SgRoot, TransformOptions } from '@codemod.com/jssg-types/main';
import type Json from '@codemod.com/jssg-types/langs/json';
import type { JestConfig } from './project/jest-config.ts';
import { migratePackage, type ProjectIO } from './project/migrate.ts';

const SKIPPED_DIRECTORIES = new Set(['.git', '.next', 'build', 'coverage', 'dist', 'node_modules', 'out']);
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const ASSERTION_COUNT = /expect\.(hasAssertions|assertions)\(/;

const decoder = new TextDecoder();

const exists = (path: string) => {
	try {
		accessSync(path);
		return true;
	} catch {
		return false;
	}
};

const read = (path: string) => {
	try {
		return readFileSync(path, 'utf8');
	} catch {
		return undefined;
	}
};

/** Evaluates the configuration with the project's Node.js, so it behaves as it did for jest. */
const EVALUATE = `
const { pathToFileURL } = await import('node:url');
const file = process.argv.at(-1);
let config = (await import(pathToFileURL(file).href, file.endsWith('.json') ? { with: { type: 'json' } } : undefined)).default;
if (typeof config === 'function') config = await config();
process.stdout.write(JSON.stringify(config ?? {}, (key, value) => (value instanceof RegExp ? value.source : value)));
`;

function loadConfig(path: string): Promise<JestConfig> {
	return new Promise((resolve, reject) => {
		const child = spawn('node', ['--input-type=module', '--eval', EVALUATE, path], { cwd: join(path, '..') });
		let output = '';
		let errors = '';
		const text = (chunk: unknown) => (typeof chunk === 'string' ? chunk : decoder.decode(chunk as Uint8Array));
		child.stdout?.on('data', (chunk: unknown) => {
			output += text(chunk);
		});
		child.stderr?.on('data', (chunk: unknown) => {
			errors += text(chunk);
		});
		child.on('error', reject);
		child.on('close', (code: number) => {
			if (code === 0) resolve(JSON.parse(output || '{}'));
			else reject(new Error(`Could not evaluate ${path}: ${errors.trim()}`));
		});
	});
}

function usesAssertionCounts(directory: string): boolean {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			if (!SKIPPED_DIRECTORIES.has(entry.name) && usesAssertionCounts(path)) return true;
		} else if (SOURCE_FILE.test(entry.name) && ASSERTION_COUNT.test(read(path) ?? '')) {
			return true;
		}
	}
	return false;
}

const io: ProjectIO = {
	exists,
	read,
	list: (directory) => readdirSync(directory),
	loadConfig,
	installedVersion: (directory, name) => {
		const manifest = read(join(directory, 'node_modules', name, 'package.json'));
		return manifest ? (JSON.parse(manifest).version as string) : undefined;
	},
	usesAssertionCounts,
};

/**
 * Moves a package from jest to node --test: scripts, jest's configuration and dependencies.
 */
export default async function transform(root: SgRoot<Json>, options?: TransformOptions<Json>): Promise<string | null> {
	const path = root.filename();
	if (path.split(/[\\/]/).includes('node_modules')) return null;

	let migration: Awaited<ReturnType<typeof migratePackage>>;
	try {
		migration = await migratePackage(path, root.root().text(), io, (message) => warn(`${root.relativeFilename()}: ${message}`));
	} catch (error) {
		warn(`${root.relativeFilename()}: not migrated, ${(error as Error).message}`);
		return null;
	}
	if (!migration) return null;

	if (!options?.dryRun) {
		for (const file of migration.remove) rmSync(file);
		for (const [file, content] of migration.write) writeFileSync(file, content);
	}
	return migration.packageJson;
}
