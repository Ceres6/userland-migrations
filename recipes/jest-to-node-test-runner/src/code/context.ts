import type { SgNode } from '@codemod.com/jssg-types/main';
import type { Source } from './source.ts';

export const TEST_FUNCTIONS = new Set(['it', 'test', 'fit', 'xit', 'xtest']);
export const SUITE_FUNCTIONS = new Set(['describe', 'fdescribe', 'xdescribe']);
export const HOOKS = new Set(['beforeAll', 'afterAll', 'beforeEach', 'afterEach']);
const JEST_GLOBALS = new Set([...TEST_FUNCTIONS, ...SUITE_FUNCTIONS, ...HOOKS, 'expect', 'jest']);

/** Test frameworks whose files share jest's globals but must be left alone. */
const OTHER_FRAMEWORKS = new Set(['vitest', 'mocha', 'chai', '@playwright/test', 'bun:test', 'cypress', 'node:test', 'test']);

export interface Context {
	source: Source;
	isTypeScript: boolean;
	/** Whether the file imported jest's APIs from `@jest/globals` (whose `jest.fn<T>()` takes a function type). */
	importsJestGlobals: boolean;
	indentUnit: string;
	/** Local name of node:test's `mock` tracker. */
	tracker: string;
	/** Expressions the file declares as mocks (`const fn = jest.fn()`, `private save = jest.fn()` as `this.save`). */
	knownMocks: Set<string>;
	/** Whether the output needs node:test's `Mock` type. */
	needsMockType: boolean;
	isJestGlobal(name: string): boolean;
	warn(node: SgNode, message: string): void;
}

export interface Detection {
	/** Names bound at module level (imports and declarations), other than those imported from `@jest/globals`. */
	bindings: Set<string>;
	importsJestGlobals: boolean;
}

const unquote = (text: string) => text.slice(1, -1);

const importSource = (statement: SgNode) => {
	const source = statement.field('source');
	return source ? unquote(source.text()) : undefined;
};

const requireSource = (declarator: SgNode) => {
	const value = declarator.field('value');
	if (value?.kind() !== 'call_expression' || value.field('function')?.text() !== 'require') return undefined;
	const argument = value.field('arguments')?.find({ rule: { kind: 'string' } });
	return argument ? unquote(argument.text()) : undefined;
};

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

/**
 * What the file binds itself, so jest globals can be told apart from local declarations with the same name.
 * Returns `null` when the file belongs to another test framework.
 */
export function detect(root: SgNode): Detection | null {
	const bindings = new Set<string>();
	let importsJestGlobals = false;

	for (const statement of root.children()) {
		const kind = statement.kind() as string;

		if (kind === 'import_statement') {
			const from = importSource(statement);
			if (from && OTHER_FRAMEWORKS.has(from)) return null;
			if (from === '@jest/globals') {
				importsJestGlobals = true;
				continue;
			}
			for (const specifier of statement.findAll({ rule: { kind: 'import_specifier' } })) {
				const local = specifier.field('alias') ?? specifier.field('name');
				if (local) bindings.add(local.text());
			}
			for (const name of statement.findAll({
				rule: {
					kind: 'identifier',
					any: [
						{ inside: { kind: 'import_clause', stopBy: 'neighbor' } },
						{ inside: { kind: 'namespace_import', stopBy: 'neighbor' } },
					],
				},
			})) {
				bindings.add(name.text());
			}
		} else if (kind === 'lexical_declaration' || kind === 'variable_declaration') {
			for (const declarator of statement.findAll({ rule: { kind: 'variable_declarator' } })) {
				const from = requireSource(declarator);
				if (from && OTHER_FRAMEWORKS.has(from)) return null;
				if (from === '@jest/globals') {
					importsJestGlobals = true;
					continue;
				}
				const name = declarator.field('name');
				if (name) for (const bound of patternNames(name)) bindings.add(bound);
			}
		} else if (['function_declaration', 'class_declaration', 'generator_function_declaration'].includes(kind)) {
			const name = statement.field('name');
			if (name) bindings.add(name.text());
		}
	}

	return { bindings, importsJestGlobals };
}

const FUNCTIONS = new Set(['arrow_function', 'function_expression', 'function_declaration', 'generator_function', 'generator_function_declaration', 'method_definition']);
const DECLARATIONS = new Set(['lexical_declaration', 'variable_declaration']);

/** Names a block (or the file) declares directly. */
function declaredIn(block: SgNode): string[] {
	return block.children().flatMap((statement) => {
		if (DECLARATIONS.has(statement.kind() as string)) {
			return statement
				.findAll({ rule: { kind: 'variable_declarator' } })
				.flatMap((declarator) => (declarator.field('name') ? patternNames(declarator.field('name')!) : []));
		}
		if (['function_declaration', 'class_declaration', 'generator_function_declaration'].includes(statement.kind() as string)) {
			return [statement.field('name')?.text() ?? ''];
		}
		return [];
	});
}

/**
 * Whether `identifier` refers to a local declaration (a parameter, a variable…) rather than a global,
 * e.g. `it` in `items.some((it) => it.equals(other))`.
 */
export function isShadowed(identifier: SgNode): boolean {
	const name = identifier.text();
	for (const scope of identifier.ancestors()) {
		const kind = scope.kind() as string;
		if (FUNCTIONS.has(kind) && parametersOf(scope).some((param) => patternNames(param).includes(name))) return true;
		if ((kind === 'statement_block' || kind === 'class_body') && declaredIn(scope).includes(name)) return true;
		if (kind === 'catch_clause' && scope.field('parameter')?.text() === name) return true;
		if (['for_in_statement', 'for_statement'].includes(kind)) {
			const left = scope.field('left') ?? scope.field('initializer');
			if (left && patternNames(left).includes(name)) return true;
		}
	}
	return false;
}

/** Whether the file uses jest: its globals, the `jest` object, or `@jest/globals`. */
export function usesJest(root: SgNode, detection: Detection): boolean {
	const isGlobal = (name: string) => !detection.bindings.has(name);

	// Cypress specs use describe/it/expect globals too
	const cypress = root.find({ rule: { kind: 'identifier', regex: '^(cy|Cypress)$' } });
	if (cypress && isGlobal(cypress.text())) return false;

	if (detection.importsJestGlobals) return true;

	return root
		.findAll({
			rule: {
				any: [
					{ kind: 'identifier', regex: '^jest$', inside: { kind: 'member_expression', field: 'object' } },
					{ kind: 'identifier', regex: '^jest$', inside: { kind: 'nested_type_identifier' } },
					{ kind: 'identifier', inside: { kind: 'call_expression', field: 'function' } },
					{
						kind: 'identifier',
						inside: { kind: 'member_expression', field: 'object', inside: { kind: 'call_expression', field: 'function' } },
					},
				],
			},
		})
		.some((node) => JEST_GLOBALS.has(node.text()) && isGlobal(node.text()) && !isShadowed(node));
}

export interface TestCallee {
	/** `it`, `describe`, `beforeEach`… */
	base: string;
	modifiers: string[];
	kind: 'test' | 'suite' | 'hook';
}

/** Recognises `it`, `it.only`, `describe.skip`, `beforeEach`… as the callee of a call. */
export function testCallee(callee: SgNode | null, context: Context): TestCallee | null {
	if (!callee) return null;
	const modifiers: string[] = [];
	let node = callee;
	while (node.kind() === 'member_expression') {
		const property = node.field('property');
		const object = node.field('object');
		if (!property || !object) return null;
		modifiers.unshift(property.text());
		node = object;
	}
	if (node.kind() !== 'identifier') return null;

	const base = node.text();
	if (!context.isJestGlobal(base) || isShadowed(node)) return null;
	if (TEST_FUNCTIONS.has(base)) return { base, modifiers, kind: 'test' };
	if (SUITE_FUNCTIONS.has(base)) return { base, modifiers, kind: 'suite' };
	if (HOOKS.has(base) && !modifiers.length) return { base, modifiers, kind: 'hook' };
	return null;
}

/** The functions jest passes the callback to, by argument position. */
export const callbackOf = (call: SgNode, callee: TestCallee) => {
	const args = argumentsOf(call);
	return callee.kind === 'hook' ? args[0] : args[1];
};

export const isFunction = (node: SgNode | undefined) =>
	node?.kind() === 'arrow_function' || node?.kind() === 'function_expression' || node?.kind() === 'function';

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

/** A parameter's binding pattern, without its type annotation (`(a: string = 'x')` → `a = 'x'`). */
export function parameterPattern(param: SgNode): { text: string; identifier?: string } {
	if (param.kind() === 'required_parameter' || param.kind() === 'optional_parameter') {
		const pattern = param.field('pattern');
		const value = param.field('value');
		if (!pattern) return { text: param.text() };
		const identifier = pattern.kind() === 'identifier' ? pattern.text() : undefined;
		return { text: value ? `${pattern.text()} = ${value.text()}` : pattern.text(), identifier };
	}
	return { text: param.text(), identifier: param.kind() === 'identifier' ? param.text() : undefined };
}

/** Whether `name` is referenced as a variable inside `node`. */
export const references = (node: SgNode, name: string) =>
	node.has({
		rule: {
			any: [{ kind: 'identifier' }, { kind: 'shorthand_property_identifier' }],
			regex: `^${name.replaceAll('$', '\\$')}$`,
		},
	});

/** A name for the test context parameter that doesn't shadow anything the callback uses. */
export const contextName = (fn: SgNode) => (references(fn, 't') ? 'context' : 't');
