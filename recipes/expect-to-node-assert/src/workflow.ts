/// <reference types="@codemod.com/jssg-types/runtime" />
import { parse } from 'codemod:ast-grep';
import { warn } from 'codemod:runtime';
import type { SgRoot } from '@codemod.com/jssg-types/main';
import type TS from '@codemod.com/jssg-types/langs/typescript';
import { assertionCountRules } from './code/assertion-counts.ts';
import { assertionRules } from './code/assertions.ts';
import type { Context } from './code/context.ts';
import { bindings, expectImports, importEdits } from './code/imports.ts';
import { createRewriter } from './code/rewriter.ts';
import { Source } from './code/source.ts';

const languageOf = (filename: string) => (/\.[cm]?ts$/.test(filename) ? 'typescript' : 'tsx');

/**
 * Migrates the assertions of a file using the `expect` package to node:assert, keeping on expect those that
 * node:assert can't check as strictly.
 */
export default function transform(root: SgRoot<TS>): string | null {
	const filename = root.filename();
	const language = languageOf(filename);
	const original = root.root().text();

	// Parsed again by extension: .tsx and JSX need the tsx grammar
	const parsed = parse(language, original) as SgRoot;
	const imports = expectImports(parsed);
	if (!imports.length) return null;

	const names = bindings(parsed);
	const warnings: string[] = [];
	const context: Context = {
		source: new Source(original),
		expectNames: new Set(imports.flatMap((found) => found.names)),
		assert: names.assert,
		strict: names.strict,
		isDeepStrictEqual: names.isDeepStrictEqual,
		needs: { assert: false, isDeepStrictEqual: false },
		pinned: [],
		warn: (node, message) => warnings.push(`${root.relativeFilename()}:${node.range().start.line + 1}: ${message}`),
	};

	const tree = parsed.root();
	const countRules = assertionCountRules(tree, context);
	let text = createRewriter(context.source, [...countRules, ...assertionRules(context)])(tree);

	const rewritten = parse(language, text) as SgRoot;
	text = rewritten.root().commitEdits(importEdits(rewritten, new Source(text), expectImports(rewritten), context.needs, names));

	for (const message of warnings) warn(message);
	return text === original ? null : text;
}
