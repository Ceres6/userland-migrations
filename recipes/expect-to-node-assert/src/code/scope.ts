import type { SgNode } from '@codemod.com/jssg-types/main';

export const FUNCTIONS = new Set([
	'arrow_function',
	'function_expression',
	'function_declaration',
	'generator_function',
	'generator_function_declaration',
	'method_definition',
]);

const DECLARATIONS = new Set(['lexical_declaration', 'variable_declaration']);
const NAMED_DECLARATIONS = new Set(['function_declaration', 'class_declaration', 'generator_function_declaration']);

/** The argument nodes of a call, without punctuation and comments. */
export function argumentsOf(call: SgNode): SgNode[] {
	const args = call.field('arguments');
	if (args?.kind() !== 'arguments') return [];
	return args.children().filter((child) => child.isNamed() && child.kind() !== 'comment');
}

/** The parameter nodes of a function, without punctuation. */
export function parametersOf(fn: SgNode): SgNode[] {
	const single = fn.field('parameter');
	if (single) return [single];
	const params = fn.field('parameters');
	if (!params) return [];
	return params.children().filter((child) => child.isNamed() && child.kind() !== 'comment');
}

/** Identifiers a declaration's name or destructuring pattern binds. */
export function patternNames(pattern: SgNode): string[] {
	if (pattern.kind() === 'identifier') return [pattern.text()];
	return pattern
		.findAll({
			rule: {
				any: [{ kind: 'identifier' }, { kind: 'shorthand_property_identifier_pattern' }],
				not: { inside: { kind: 'assignment_pattern', field: 'right' } },
			},
		})
		.map((node) => node.text());
}

/** Names a block (or the file) declares directly. */
export function declaredIn(block: SgNode): string[] {
	return block.children().flatMap((statement) => {
		const kind = statement.kind() as string;
		if (DECLARATIONS.has(kind)) {
			return statement
				.findAll({ rule: { kind: 'variable_declarator' } })
				.flatMap((declarator) => {
					const name = declarator.field('name');
					return name ? patternNames(name) : [];
				});
		}
		if (NAMED_DECLARATIONS.has(kind)) return [statement.field('name')?.text() ?? ''];
		if (kind === 'import_statement') {
			const specifiers = statement
				.findAll({ rule: { kind: 'import_specifier' } })
				.map((specifier) => (specifier.field('alias') ?? specifier.field('name'))?.text() ?? '');
			const others = statement
				.findAll({
					rule: {
						kind: 'identifier',
						any: [
							{ inside: { kind: 'import_clause', stopBy: 'neighbor' } },
							{ inside: { kind: 'namespace_import', stopBy: 'neighbor' } },
						],
					},
				})
				.map((node) => node.text());
			return [...specifiers, ...others];
		}
		return [];
	});
}

/** Whether `identifier` refers to a local declaration (a parameter, a variable…) rather than the module's. */
export function isShadowed(identifier: SgNode): boolean {
	const name = identifier.text();
	for (const scope of identifier.ancestors()) {
		const kind = scope.kind() as string;
		if (FUNCTIONS.has(kind) && parametersOf(scope).some((param) => patternNames(param).includes(name))) return true;
		if ((kind === 'statement_block' || kind === 'class_body') && declaredIn(scope).includes(name)) return true;
		if (kind === 'catch_clause' && scope.field('parameter')?.text() === name) return true;
		if (kind === 'for_in_statement' || kind === 'for_statement') {
			const left = scope.field('left') ?? scope.field('initializer');
			if (left && patternNames(left).includes(name)) return true;
		}
	}
	return false;
}

/** Whether `name` is referenced as a variable inside `node`. */
export const references = (node: SgNode, name: string) =>
	node.has({
		rule: {
			any: [{ kind: 'identifier' }, { kind: 'shorthand_property_identifier' }],
			regex: `^${name.replaceAll('$', '\\$')}$`,
		},
	});

/** The function `node` runs in, if any. */
export const ownerFunction = (node: SgNode) => node.ancestors().find((ancestor) => FUNCTIONS.has(ancestor.kind() as string));

export const sameNode = (a: SgNode | undefined, b: SgNode | undefined) =>
	!!a && !!b && a.range().start.index === b.range().start.index && a.range().end.index === b.range().end.index;

export const isFunction = (node: SgNode | undefined) =>
	node?.kind() === 'arrow_function' || node?.kind() === 'function_expression' || node?.kind() === 'function';
