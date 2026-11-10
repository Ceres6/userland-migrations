/// <reference types="@codemod.com/jssg-types/runtime" />
import { parse } from 'codemod:ast-grep';
import { warn } from 'codemod:runtime';
import type { Edit, SgNode, SgRoot } from '@codemod.com/jssg-types/main';
import type JS from '@codemod.com/jssg-types/langs/javascript';
import type TS from '@codemod.com/jssg-types/langs/typescript';
import isESM from '@nodejs/codemod-utils/is-esm';
import { detectIndentUnit } from '@nodejs/codemod-utils/ast-grep/indent';
import { type Context, type Detection, detect, patternNames, usesJest } from './code/context.ts';
import { convertEach } from './code/each.ts';
import { importEdits } from './code/imports.ts';
import { jestObjectRules } from './code/jest-object.ts';
import { matcherRules } from './code/matchers.ts';
import { knownMocks, mockRules } from './code/mocks.ts';
import { createRewriter } from './code/rewriter.ts';
import { Source } from './code/source.ts';
import { testRules } from './code/tests.ts';

const languageOf = (filename: string) => (/\.[cm]?ts$/.test(filename) ? 'typescript' : 'tsx');

/** Keeps the outermost of overlapping edits; the others are applied on the next round. */
function outermost(edits: Edit[]): Edit[] {
	const sorted = [...edits].sort((a, b) => a.startPos - b.startPos || b.endPos - a.endPos);
	const kept: Edit[] = [];
	for (const edit of sorted) {
		const last = kept.at(-1);
		if (!last || edit.startPos >= last.endPos) kept.push(edit);
	}
	return kept;
}

/** Maps lines of the text `edits` produce back to lines of `text`, so warnings point at the original file. */
function lineMap(text: string, edits: Edit[]): (line: number) => number {
	const { bytes } = new Source(text);
	const lineAt = (index: number) => {
		let line = 0;
		for (let i = 0; i < index; i++) if (bytes[i] === 0x0a) line++;
		return line;
	};
	let delta = 0;
	const segments = [...edits]
		.sort((a, b) => a.startPos - b.startPos)
		.map((edit) => {
			const oldStart = lineAt(edit.startPos);
			const oldEnd = lineAt(edit.endPos);
			const newStart = oldStart + delta;
			const newEnd = newStart + edit.insertedText.split('\n').length - 1;
			delta += newEnd - newStart - (oldEnd - oldStart);
			return { oldStart, oldEnd, newStart, newEnd, delta };
		});

	return (line) => {
		let before = 0;
		for (const segment of segments) {
			if (line < segment.newStart) return line - before;
			// The loop header is a new line, the test inside it is the original one shifted down by one
			if (line <= segment.newEnd) return Math.min(Math.max(line - 1, segment.oldStart), segment.oldEnd);
			before = segment.delta;
		}
		return line - before;
	};
}

/**
 * node:test's `mock` tracker can't be imported as `mock` where the file has a `mock` of its own around the
 * code that will use it (e.g. `const { mock } = jest.fn()` in a function that also creates mocks).
 */
function trackerName(root: SgNode, detection: Detection): string {
	if (detection.bindings.has('mock')) return 'nodeMock';
	const clashes = root
		.findAll({ rule: { kind: 'variable_declarator' } })
		.filter((declarator) => {
			const name = declarator.field('name');
			return name && patternNames(name).includes('mock');
		})
		.some((declarator) => {
			const scope = declarator.ancestors().find((node) => node.kind() === 'statement_block');
			return scope?.has({ rule: { pattern: 'jest.$METHOD($$$)' } });
		});
	return clashes ? 'nodeMock' : 'mock';
}

/**
 * Migrates a jest test file (or a helper using jest's globals) to node:test, keeping jest's `expect`.
 */
export default async function transform(root: SgRoot<TS>): Promise<string | null> {
	const filename = root.filename();
	const language = languageOf(filename);
	const original = root.root().text();

	// Parsed again by extension: .tsx and JSX need the tsx grammar
	const initial = parse(language, original).root();
	const detection = detect(initial);
	if (!detection || !usesJest(initial, detection)) return null;

	const warnings: string[] = [];
	const isTypeScript = /\.[cm]?tsx?$/.test(filename);
	const tracker = trackerName(initial, detection);
	const indentUnit = detectIndentUnit(original);

	// Lines of the text being rewritten back to lines of the original file
	const lineMaps: Array<(line: number) => number> = [];
	const originalLine = (line: number) => lineMaps.reduceRight((current, map) => map(current), line);

	const contextFor = (source: Source, collect = warnings): Context => ({
		source,
		isTypeScript,
		importsJestGlobals: detection.importsJestGlobals,
		indentUnit,
		tracker,
		knownMocks: new Set(),
		needsMockType: false,
		isJestGlobal: (name) => !detection.bindings.has(name),
		warn: (node, message) =>
			collect.push(`${root.relativeFilename()}:${originalLine(node.range().start.line) + 1}: ${message}`),
	});

	if (/@jest-environment\s/.test(original)) {
		warnings.push(`${root.relativeFilename()}: \`@jest-environment\` docblocks have no node:test equivalent: set up the environment with \`--import\`.`);
	}

	// 1. `.each` tables become loops (re-indenting their tests, so before anything else changes)
	// The first round sees every `.each` call (nested ones too), so its warnings are the ones kept.
	let text = original;
	for (let round = 0; round < 10; round++) {
		const node = parse(language, text).root();
		const edits = outermost(convertEach(node, contextFor(new Source(text), round === 0 ? warnings : [])));
		if (!edits.length) break;
		lineMaps.push(lineMap(text, edits));
		text = node.commitEdits(edits);
	}

	// 2. Mocks, matchers, timers and test functions, in a single traversal
	const rewritten = parse(language, text).root();
	const context = contextFor(new Source(text));
	context.knownMocks = knownMocks(rewritten, context);
	text = createRewriter(context.source, [
		...matcherRules(context),
		...mockRules(context),
		...jestObjectRules(context),
		...testRules(context),
	])(rewritten);

	// 3. Imports
	const finalRoot = parse(language, text);
	const final = finalRoot.root();
	const esm = /\.m[jt]s$/.test(filename)
		? true
		: /\.c[jt]s$/.test(filename)
			? false
			: isTypeScript
				? !!final.find({ rule: { kind: 'import_statement' } }) || !final.find({ rule: { pattern: 'require($_)' } })
				: isESM(final as unknown as SgNode<JS>);
	text = final.commitEdits(
		importEdits(finalRoot, new Source(text), detection, {
			esm,
			tracker,
			needsMockType: context.needsMockType,
			isTypeScript,
		}),
	);

	for (const message of warnings) warn(message);

	return text === original ? null : text;
}
