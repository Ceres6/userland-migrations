import type { Edit, SgNode, SgRoot } from '@codemod.com/jssg-types/main';
import type JS from '@codemod.com/jssg-types/langs/javascript';
import { getModuleDependencies } from '@nodejs/codemod-utils/ast-grep/module-dependencies';
import { type Detection, isShadowed } from './context.ts';
import type { Source } from './source.ts';

const NODE_TEST_FUNCTIONS = new Set(['after', 'afterEach', 'before', 'beforeEach', 'describe', 'it', 'test']);
const TRACKER_METHODS = new Set(['fn', 'getter', 'method', 'property', 'reset', 'restoreAll', 'setter', 'timers']);

const isRequireStatement = (statement: SgNode) =>
	(statement.kind() === 'lexical_declaration' || statement.kind() === 'variable_declaration') &&
	statement.has({ rule: { kind: 'call_expression', has: { field: 'function', regex: '^require$' } } });

/** node:test's functions modifiers, to tell `it.only(…)` from a local `it.equals(…)`. */
const MODIFIERS = new Set(['only', 'skip', 'todo']);

/** node:test functions the file calls: `describe(…)`, `it.only(…)`. */
const calledNames = (root: SgNode) =>
	new Set(
		root
			.findAll({
				rule: {
					kind: 'identifier',
					any: [
						{ inside: { kind: 'call_expression', field: 'function' } },
						{ inside: { kind: 'member_expression', field: 'object', inside: { kind: 'call_expression', field: 'function' } } },
					],
				},
			})
			.filter((node) => {
				const parent = node.parent();
				const isModifier = parent?.kind() !== 'member_expression' || MODIFIERS.has(parent.field('property')?.text() ?? '');
				return isModifier && !isShadowed(node);
			})
			.map((node) => node.text()),
	);

const usesTracker = (root: SgNode, tracker: string) =>
	root
		.findAll({ rule: { kind: 'member_expression', has: { field: 'object', kind: 'identifier', regex: `^${tracker}$` } } })
		.some((member) => TRACKER_METHODS.has(member.field('property')?.text() ?? ''));

const usesExpect = (root: SgNode) =>
	root
		.findAll({
			rule: {
				kind: 'identifier',
				regex: '^expect$',
				any: [
					{ inside: { kind: 'call_expression', field: 'function' } },
					{ inside: { kind: 'member_expression', field: 'object' } },
				],
			},
		})
		.some((node) => !isShadowed(node));

export interface ImportOptions {
	esm: boolean;
	tracker: string;
	needsMockType: boolean;
	isTypeScript: boolean;
}

/**
 * Replaces `@jest/globals` imports with imports of what the migrated file uses: node:test's functions and
 * `mock`, and `expect` from the `expect` package (the one jest uses).
 */
export function importEdits(sgRoot: SgRoot, source: Source, detection: Detection, options: ImportOptions): Edit[] {
	const edits: Edit[] = [];
	const root = sgRoot.root();
	const statements = root.children();
	// `import … from '@jest/globals'`, or the declaration of `const … = require('@jest/globals')`
	const topLevel = new Set(statements.map((statement) => statement.range().start.index));
	const jestGlobals = getModuleDependencies(sgRoot as unknown as SgRoot<JS>, '@jest/globals')
		.map((node) => (node.kind() === 'variable_declarator' ? node.parent() : node) as unknown as SgNode)
		.filter((statement) => statement && topLevel.has(statement.range().start.index));
	const isFree = (name: string) => !detection.bindings.has(name);

	const called = calledNames(root);
	const testNames = [...NODE_TEST_FUNCTIONS].filter((name) => called.has(name) && isFree(name));
	if (usesTracker(root, options.tracker)) {
		testNames.push(options.tracker === 'mock' ? 'mock' : `mock as ${options.tracker}`);
	}
	testNames.sort((a, b) => a.localeCompare(b));
	const mockType = options.needsMockType && options.isTypeScript;
	const lines: string[] = [];

	if (options.esm) {
		if (testNames.length || mockType) {
			lines.push(
				testNames.length
					? `import { ${[...testNames, ...(mockType ? ['type Mock'] : [])].join(', ')} } from 'node:test';`
					: `import type { Mock } from 'node:test';`,
			);
		}
		if (usesExpect(root) && isFree('expect')) lines.push(`import { expect } from 'expect';`);
	} else {
		if (testNames.length) {
			lines.push(`const { ${testNames.map((name) => name.replace(' as ', ': ')).join(', ')} } = require('node:test');`);
		}
		if (usesExpect(root) && isFree('expect')) lines.push(`const { expect } = require('expect');`);
	}

	// Each import goes on its own line: removing one removes its line break too
	const lineEnd = (statement: SgNode) => {
		const end = statement.range().end.index;
		return source.bytes[end] === 0x0a ? end + 1 : end;
	};

	jestGlobals.forEach((statement, index) => {
		const { start } = statement.range();
		edits.push({
			startPos: start.index,
			endPos: lineEnd(statement),
			insertedText: index === 0 && lines.length ? `${lines.join('\n')}\n` : '',
		});
	});
	if (jestGlobals.length || !lines.length) return edits;

	const anchor =
		statements.find((statement) => (options.esm ? statement.kind() === 'import_statement' : isRequireStatement(statement))) ??
		statements.find((statement) => !['comment', 'hash_bang_line'].includes(statement.kind() as string) && !isDirective(statement));
	const isImport = anchor && (anchor.kind() === 'import_statement' || isRequireStatement(anchor));
	const position = anchor ? anchor.range().start.index : source.bytes.length;

	edits.push({
		startPos: position,
		endPos: position,
		insertedText: `${lines.join('\n')}\n${isImport || !anchor ? '' : '\n'}`,
	});
	return edits;
}

const isDirective = (statement: SgNode) =>
	statement.kind() === 'expression_statement' && statement.children()[0]?.kind() === 'string';
