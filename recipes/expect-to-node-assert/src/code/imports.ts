import type { Edit, SgNode, SgRoot } from '@codemod.com/jssg-types/main';
import type JS from '@codemod.com/jssg-types/langs/javascript';
import { getDefaultImportIdentifier } from '@nodejs/codemod-utils/ast-grep/import-statement';
import { getModuleDependencies } from '@nodejs/codemod-utils/ast-grep/module-dependencies';
import { getRequireNamespaceIdentifier } from '@nodejs/codemod-utils/ast-grep/require-call';
import { removeBinding } from '@nodejs/codemod-utils/ast-grep/remove-binding';
import { declaredIn, isShadowed, patternNames } from './scope.ts';
import type { Source } from './source.ts';

/** An import of the `expect` package: the statement, and the local names it binds `expect` to. */
export interface ExpectImport {
	statement: SgNode;
	/** The `require()` declarator, for CommonJS. */
	declarator?: SgNode;
	names: string[];
	esm: boolean;
}

const asRoot = (root: SgRoot) => root as unknown as SgRoot<JS>;

/** `import { expect } from 'expect'`, `import expect from 'expect'`, `const { expect } = require('expect')`. */
export function expectImports(root: SgRoot): ExpectImport[] {
	const topLevel = new Set(root.root().children().map((statement) => statement.range().start.index));
	return getModuleDependencies(asRoot(root), 'expect').flatMap((found): ExpectImport[] => {
		const node = found as unknown as SgNode;
		if (node.kind() === 'import_statement') {
			const named = node
				.findAll({ rule: { kind: 'import_specifier', has: { field: 'name', regex: '^expect$' } } })
				.map((specifier) => (specifier.field('alias') ?? specifier.field('name'))?.text() ?? 'expect');
			const fallback = getDefaultImportIdentifier(found)?.text();
			const names = [...named, ...(fallback ? [fallback] : [])];
			return topLevel.has(node.range().start.index) && names.length ? [{ statement: node, names, esm: true }] : [];
		}
		// `const { expect } = require('expect')`; a whole `require('expect')` is the module, not the function
		const statement = node.parent();
		const pattern = node.field('name');
		if (!statement || !topLevel.has(statement.range().start.index) || pattern?.kind() !== 'object_pattern') return [];
		const names = pattern
			.children()
			.flatMap((property) => {
				if (property.kind() === 'shorthand_property_identifier_pattern') return property.text() === 'expect' ? ['expect'] : [];
				if (property.kind() === 'pair_pattern' && property.field('key')?.text() === 'expect') {
					const value = property.field('value');
					return value?.kind() === 'identifier' ? [value.text()] : [];
				}
				return [];
			});
		return names.length ? [{ statement, declarator: node, names, esm: false }] : [];
	});
}

const ASSERT_MODULES = ['assert', 'assert/strict'];

/** A default (or namespace) binding of node:assert the file already has, to reuse. */
export function existingAssert(root: SgRoot): { name: string; strict: boolean } | undefined {
	for (const module of ASSERT_MODULES) {
		for (const found of getModuleDependencies(asRoot(root), module)) {
			const node = found as unknown as SgNode;
			const identifier =
				node.kind() === 'import_statement'
					? (getDefaultImportIdentifier(found) ?? node.find({ rule: { kind: 'identifier', inside: { kind: 'namespace_import' } } }))
					: getRequireNamespaceIdentifier(found);
			if (identifier) return { name: identifier.text(), strict: module.endsWith('strict') };
		}
	}
	return undefined;
}

/** `isDeepStrictEqual` imported from node:util. */
function existingIsDeepStrictEqual(root: SgRoot): string | undefined {
	for (const found of getModuleDependencies(asRoot(root), 'util')) {
		const node = found as unknown as SgNode;
		const specifier = node.find({
			rule: {
				any: [
					{ kind: 'import_specifier', has: { field: 'name', regex: '^isDeepStrictEqual$' } },
					{ kind: 'shorthand_property_identifier_pattern', regex: '^isDeepStrictEqual$' },
				],
			},
		});
		if (specifier) return (specifier.field('alias') ?? specifier.field('name') ?? specifier).text();
	}
	return undefined;
}

/** Every name the file declares, at any level: a new import must not clash with (or be shadowed by) any. */
const allNames = (root: SgNode) =>
	new Set([
		...declaredIn(root),
		...root
			.findAll({ rule: { any: [{ kind: 'statement_block' }, { kind: 'class_body' }] } })
			.flatMap(declaredIn),
		...root
			.findAll({ rule: { any: [{ kind: 'formal_parameters' }, { kind: 'catch_clause' }] } })
			.flatMap((node) => node.children().filter((child) => child.isNamed()).flatMap(patternNames)),
		...root.findAll({ rule: { kind: 'identifier', inside: { kind: 'arrow_function', field: 'parameter' } } }).map((node) => node.text()),
	]);

const freeName = (names: Set<string>, preferred: string, fallback: string) => (names.has(preferred) ? fallback : preferred);

export interface Bindings {
	assert: string;
	strict: boolean;
	/** Whether node:assert still has to be imported. */
	importAssert: boolean;
	isDeepStrictEqual: string;
	importIsDeepStrictEqual: boolean;
}

/** The names the migrated assertions will use. */
export function bindings(root: SgRoot): Bindings {
	const names = allNames(root.root());
	const assert = existingAssert(root);
	const isDeepStrictEqual = existingIsDeepStrictEqual(root);
	return {
		assert: assert?.name ?? freeName(names, 'assert', 'nodeAssert'),
		strict: assert?.strict ?? true,
		importAssert: !assert,
		isDeepStrictEqual: isDeepStrictEqual ?? freeName(names, 'isDeepStrictEqual', 'isDeepStrictEqualTo'),
		importIsDeepStrictEqual: !isDeepStrictEqual,
	};
}

/** Whether the file still uses `expect` (outside of its import). */
const usesExpect = (root: SgNode, names: string[]) =>
	root
		.findAll({ rule: { kind: 'identifier', regex: `^(${names.map((name) => name.replaceAll('$', '\\$')).join('|')})$` } })
		.some((node) => !node.inside({ rule: { any: [{ kind: 'import_statement' }, { kind: 'variable_declarator', has: { field: 'value', pattern: "require('expect')" } }] } }) && !isShadowed(node));

/**
 * Imports node:assert (and node:util's `isDeepStrictEqual`) where `expect` was imported, and removes `expect`'s
 * import once nothing uses it.
 */
export function importEdits(root: SgRoot, source: Source, imports: ExpectImport[], needs: { assert: boolean; isDeepStrictEqual: boolean }, names: Bindings): Edit[] {
	const [first] = imports;
	if (!first) return [];
	const lines: string[] = [];
	if (needs.assert && names.importAssert) {
		lines.push(first.esm ? `import ${names.assert} from 'node:assert/strict';` : `const ${names.assert} = require('node:assert/strict');`);
	}
	if (needs.isDeepStrictEqual && names.importIsDeepStrictEqual) {
		const specifier = names.isDeepStrictEqual === 'isDeepStrictEqual' ? 'isDeepStrictEqual' : `isDeepStrictEqual${first.esm ? ' as ' : ': '}${names.isDeepStrictEqual}`;
		lines.push(first.esm ? `import { ${specifier} } from 'node:util';` : `const { ${specifier} } = require('node:util');`);
	}

	const lineEnd = (statement: SgNode) => {
		const end = statement.range().end.index;
		return source.bytes[end] === 0x0a ? end + 1 : end;
	};
	const unused = !usesExpect(root.root(), imports.flatMap((found) => found.names));
	const edits: Edit[] = [];
	let inserted = !lines.length;

	for (const found of imports) {
		const { start } = found.statement.range();
		const insertion = inserted ? '' : `${lines.join('\n')}\n`;
		if (!unused) {
			if (!inserted) edits.push({ startPos: start.index, endPos: start.index, insertedText: insertion });
			inserted = true;
			continue;
		}
		const bindsOnlyExpect = found.esm
			? found.statement.findAll({ rule: { kind: 'identifier', inside: { kind: 'import_clause' } } }).every((node) => node.text() === 'expect' || found.names.includes(node.text()))
			: (found.declarator?.field('name') && patternNames(found.declarator.field('name') as SgNode).every((name) => found.names.includes(name)) &&
					found.statement.findAll({ rule: { kind: 'variable_declarator' } }).length === 1);
		if (bindsOnlyExpect) {
			edits.push({ startPos: start.index, endPos: lineEnd(found.statement), insertedText: insertion });
		} else {
			for (const name of found.names) {
				const edit = removeBinding((found.declarator ?? found.statement) as never, name)?.edit;
				if (edit) edits.push(edit as Edit);
			}
			if (insertion) edits.push({ startPos: start.index, endPos: start.index, insertedText: insertion });
		}
		inserted = true;
	}
	return edits;
}
