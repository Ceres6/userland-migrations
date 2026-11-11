import type { SgNode } from '@codemod.com/jssg-types/main';
import { type Context, isExpect, isPinned } from './context.ts';
import type { Rewrite, Rule } from './rewriter.ts';
import { argumentsOf, isFunction, parametersOf, references } from './scope.ts';

const MODIFIERS = new Set(['not', 'resolves', 'rejects']);
const THROW_MATCHERS = new Set(['toThrow', 'toThrowError']);

/** `expect(subject)[.resolves|.rejects][.not].matcher(...args)` */
export interface Assertion {
	call: SgNode;
	/** `expect(subject)` */
	expectCall: SgNode;
	subject: SgNode;
	not: boolean;
	promise?: 'resolves' | 'rejects';
	matcher: string;
	args: SgNode[];
}

export function parseAssertion(node: SgNode, context: Context): Assertion | null {
	if (node.kind() !== 'call_expression') return null;
	const callee = node.field('function');
	if (callee?.kind() !== 'member_expression') return null;
	const matcher = callee.field('property')?.text() ?? '';
	const modifiers: string[] = [];
	let object = callee.field('object');
	while (object?.kind() === 'member_expression') {
		const property = object.field('property')?.text() ?? '';
		if (!MODIFIERS.has(property)) return null;
		modifiers.unshift(property);
		object = object.field('object');
	}
	if (object?.kind() !== 'call_expression' || !isExpect(context, object.field('function'))) return null;
	const [subject, ...rest] = argumentsOf(object);
	if (!subject || rest.length) return null;

	const [first, second] = modifiers;
	const promise = first === 'resolves' || first === 'rejects' ? first : undefined;
	const not = (promise ? second : first) === 'not';
	if (modifiers.length !== (promise ? 1 : 0) + (not ? 1 : 0)) return null;
	return { call: node, expectCall: object, subject, not, promise, matcher, args: argumentsOf(node) };
}

/**
 * An expression's text, and how tightly it binds: 2 can be the object of a member access, 1 the operand of a
 * unary or binary operator, 0 needs parentheses for either.
 */
interface Operand {
	text: string;
	level: 0 | 1 | 2;
	/** A binary expression's operator. */
	operator?: string;
}

const PRIMARY = new Set([
	'identifier',
	'member_expression',
	'subscript_expression',
	'call_expression',
	'this',
	'super',
	'parenthesized_expression',
	'string',
	'template_string',
	'array',
	'object',
	'true',
	'false',
	'null',
	'undefined',
	'regex',
	'non_null_expression',
]);

const levelOf = (node: SgNode): Operand['level'] => {
	const kind = node.kind() as string;
	if (PRIMARY.has(kind)) return 2;
	return kind === 'number' || kind === 'new_expression' || kind === 'unary_expression' || kind === 'await_expression' ? 1 : 0;
};

const operand = (node: SgNode, rewrite: Rewrite): Operand => ({
	text: rewrite(node),
	level: levelOf(node),
	operator: node.kind() === 'binary_expression' ? node.field('operator')?.text() : undefined,
});
const asObject = ({ text, level }: Operand) => (level === 2 ? text : `(${text})`);
const asOperand = ({ text, level }: Operand) => (level >= 1 ? text : `(${text})`);

const MULTIPLICATIVE = new Set(['*', '/', '%', '**']);
const ARITHMETIC = new Set([...MULTIPLICATIVE, '+', '-']);

/** An operand of `<`, `instanceof`, `in`… and of `-` (on its left, or its right). */
const asRelational = (value: Operand) => (ARITHMETIC.has(value.operator ?? '') ? value.text : asOperand(value));
const asSubtrahend = (value: Operand) => (MULTIPLICATIVE.has(value.operator ?? '') ? value.text : asOperand(value));

/** Why an assertion can't be migrated, or how to build its replacement from the rewritten children. */
type Plan = { reason: string } | { build: (rewrite: Rewrite) => string };

const unsupported = (reason: string): Plan => ({ reason });

/** `expect.any()`, `expect.objectContaining()`… anywhere in the assertion. */
function asymmetricMatcher(assertion: Assertion, context: Context): SgNode | undefined {
	for (const node of [assertion.subject, ...assertion.args]) {
		const nodes = [node, ...node.findAll({ rule: { kind: 'member_expression' } })];
		const found = nodes.find((member) => member.kind() === 'member_expression' && isExpect(context, member.field('object')));
		if (found) return found;
	}
	return undefined;
}

const SIDE_EFFECTS = ['call_expression', 'new_expression', 'await_expression', 'assignment_expression', 'augmented_assignment_expression', 'update_expression', 'yield_expression'];

const hasSideEffects = (node: SgNode) =>
	SIDE_EFFECTS.includes(node.kind() as string) || node.has({ rule: { any: SIDE_EFFECTS.map((kind) => ({ kind })) } });

/** The value of a string literal without escape sequences. */
const stringValue = (node: SgNode) => (node.kind() === 'string' && !node.text().includes('\\') ? node.text().slice(1, -1) : undefined);

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** `Error`, `errors.NotFound`: by convention, a class. */
const isClassName = (node: SgNode) => {
	const name = node.kind() === 'member_expression' ? node.field('property') : node;
	return (node.kind() === 'identifier' || node.kind() === 'member_expression') && /^[A-Z]/.test(name?.text() ?? '');
};

/**
 * What `toThrow(expected)` checks, as `assert.throws()`'s second argument. A string there would be the
 * assertion's message, and a regular expression would also match the error's name: both go in `message`.
 */
function thrownError(expected: SgNode | undefined, negated = false): { reason: string } | { build: (rewrite: Rewrite) => string | undefined } {
	if (!expected) return { build: () => undefined };
	const kind = expected.kind();
	if (kind === 'regex') return { build: () => `{ message: ${expected.text()} }` };
	if (kind === 'string') {
		const value = stringValue(expected);
		if (value === undefined) return { reason: 'a message with escape sequences' };
		return { build: () => (value ? `{ message: /${escapeRegExp(value)}/ }` : undefined) };
	}
	if (kind === 'template_string') return { reason: 'a computed message' };
	// An error is compared by message and name, stricter than jest's message: negated, that would be looser
	if (kind === 'new_expression') return { build: (rewrite) => (negated ? `{ message: ${rewrite(expected)}.message }` : rewrite(expected)) };
	if (isClassName(expected)) return { build: (rewrite) => rewrite(expected) };
	return { reason: `\`${expected.text()}\`, which could be an error class, a message or an error` };
}

/** A fresh parameter name for a callback evaluating `expression`. */
function itemName(expression: SgNode): string {
	for (const name of ['item', 'element', 'entry']) if (!references(expression, name)) return name;
	let index = 2;
	while (references(expression, `item${index}`)) index++;
	return `item${index}`;
}

/** `list.map((x) => body)`, which `toContainEqual()` checks with `list.some((x) => …(body))`. */
function mappedList(subject: SgNode) {
	if (subject.kind() !== 'call_expression') return undefined;
	const callee = subject.field('function');
	const [callback, ...rest] = argumentsOf(subject);
	if (callee?.kind() !== 'member_expression' || callee.field('property')?.text() !== 'map' || rest.length) return undefined;
	if (callback?.kind() !== 'arrow_function') return undefined;
	const [param, ...others] = parametersOf(callback);
	const body = callback.field('body');
	const list = callee.field('object');
	if (!param || others.length || !body || body.kind() === 'statement_block' || !list) return undefined;
	const name = param.kind() === 'identifier' ? param.text() : param.field('pattern')?.text();
	if (!name || !/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(name)) return undefined;
	return { list, param, name, body };
}

function containsEqual(assertion: Assertion, actual: (rewrite: Rewrite) => Operand, context: Context): Plan {
	const [expected] = assertion.args;
	if (hasSideEffects(expected)) {
		return unsupported('`toContainEqual()` with an argument that calls functions: `some()` would evaluate it for every item.');
	}
	const bang = assertion.not ? '!' : '';
	const mapped = assertion.promise ? undefined : mappedList(assertion.subject);
	return {
		build: (rewrite) => {
			context.needs.isDeepStrictEqual = true;
			const equal = context.isDeepStrictEqual;
			const value = rewrite(expected);
			if (mapped && !references(expected, mapped.name)) {
				const list = asObject(operand(mapped.list, rewrite));
				return `${bang}${list}.some((${rewrite(mapped.param)}) => ${equal}(${rewrite(mapped.body)}, ${value}))`;
			}
			const item = itemName(expected);
			return `${bang}${asObject(actual(rewrite))}.some((${item}) => ${equal}(${item}, ${value}))`;
		},
	};
}

const RELATIONS: Record<string, string> = {
	toBeGreaterThan: '>',
	toBeGreaterThanOrEqual: '>=',
	toBeLessThan: '<',
	toBeLessThanOrEqual: '<=',
};

/** node:assert's names outside of strict mode. */
const LEGACY_NAMES = {
	equal: 'strictEqual',
	notEqual: 'notStrictEqual',
	deepEqual: 'deepStrictEqual',
	notDeepEqual: 'notDeepStrictEqual',
};

/** How many arguments each matcher takes: `[min, max]`. */
const ARITY: Record<string, [number, number]> = {
	toBe: [1, 1],
	toEqual: [1, 1],
	toStrictEqual: [1, 1],
	toBeNull: [0, 0],
	toBeUndefined: [0, 0],
	toBeDefined: [0, 0],
	toBeTruthy: [0, 0],
	toBeFalsy: [0, 0],
	toBeNaN: [0, 0],
	toBeInstanceOf: [1, 1],
	toBeGreaterThan: [1, 1],
	toBeGreaterThanOrEqual: [1, 1],
	toBeLessThan: [1, 1],
	toBeLessThanOrEqual: [1, 1],
	toHaveLength: [1, 1],
	toContain: [1, 1],
	toContainEqual: [1, 1],
	toMatch: [1, 1],
	toBeCloseTo: [1, 2],
	toHaveProperty: [1, 1],
	toMatchObject: [1, 1],
	toThrow: [0, 1],
	toThrowError: [0, 1],
};

/**
 * How to migrate an assertion to node:assert, if it can be done without weakening it: every replacement checks
 * at least what jest checked, so a test that passes after the migration would have passed before. The exception
 * is `toMatchObject()`, whose closest equivalent, `partialDeepStrictEqual()`, matches arrays less strictly.
 */
export function plan(assertion: Assertion, context: Context): Plan {
	const { matcher, not, promise, args, subject } = assertion;
	const arity = ARITY[matcher];
	if (!arity) return unsupported(`\`${matcher}()\` has no node:assert equivalent.`);
	if (args.length < arity[0] || args.length > arity[1] || args.some((arg) => arg.kind() === 'spread_element')) {
		return unsupported(`Unexpected \`${matcher}()\` arguments.`);
	}
	const asymmetric = asymmetricMatcher(assertion, context);
	if (asymmetric) return unsupported(`\`${asymmetric.text()}()\` has no node:assert equivalent.`);

	const { assert, strict } = context;
	const method = (name: keyof typeof LEGACY_NAMES) => (strict ? name : LEGACY_NAMES[name]);
	const call = (name: string, ...parts: string[]) => {
		context.needs.assert = true;
		return `${assert}.${name}(${parts.join(', ')})`;
	};

	/**
	 * A negated assertion node:assert has no function for: the positive one, expected to fail. Only with an
	 * `AssertionError`, so errors computing the values still fail the test, as they did with jest.
	 */
	const failing = (positive: string, awaited = false) => {
		context.needs.assert = true;
		return awaited
			? `await ${assert}.rejects(async () => ${positive}, ${assert}.AssertionError)`
			: `${assert}.throws(() => ${positive}, ${assert}.AssertionError)`;
	};

	if (THROW_MATCHERS.has(matcher)) {
		if (promise === 'resolves') return unsupported('`resolves.toThrow()` has no node:assert equivalent.');
		if (not && promise) return unsupported(`\`rejects.not.${matcher}()\` has no node:assert equivalent.`);
		if (not && !args.length) return { build: (rewrite) => call('doesNotThrow', rewrite(subject)) };
		const error = thrownError(args[0], not);
		if ('reason' in error) return unsupported(`\`${matcher}()\` with ${error.reason}: migrate it manually.`);
		return {
			build: (rewrite) => {
				const expected = error.build(rewrite);
				const assertion = call(promise === 'rejects' ? 'rejects' : 'throws', rewrite(subject), ...(expected ? [expected] : []));
				return not ? failing(assertion) : assertion;
			},
		};
	}
	if (promise === 'rejects') return unsupported(`\`rejects.${matcher}()\` has no node:assert equivalent: use \`${assert}.rejects()\` with a validation function.`);
	if (promise === 'resolves' && isFunction(subject)) return unsupported('`resolves` on a function: call it in the assertion instead.');
	if (promise === 'resolves' && assertion.call.parent()?.kind() !== 'await_expression') {
		return unsupported('`resolves` assertions are only migrated when awaited.');
	}

	// The value under test: `await promise` for `resolves`
	const actual = (rewrite: Rewrite): Operand =>
		promise === 'resolves' ? { text: `await ${asOperand(operand(subject, rewrite))}`, level: 1 } : operand(subject, rewrite);
	const value = (rewrite: Rewrite) => actual(rewrite).text;
	// An assertion on a binary expression: `x instanceof C`, `x > 1`…
	const ok = (rewrite: Rewrite, condition: (rewrite: Rewrite) => string) =>
		call('ok', not ? `!(${condition(rewrite)})` : condition(rewrite));
	const bang = not ? '!' : '';

	switch (matcher) {
		case 'toBe':
			return { build: (rewrite) => call(method(not ? 'notEqual' : 'equal'), value(rewrite), rewrite(args[0])) };
		case 'toEqual':
			if (not) {
				return unsupported('`not.toEqual()` as `notDeepStrictEqual()` would also pass for values jest considers equal (undefined properties, other classes).');
			}
			return { build: (rewrite) => call(method('deepEqual'), value(rewrite), rewrite(args[0])) };
		case 'toStrictEqual':
			return { build: (rewrite) => call(method(not ? 'notDeepEqual' : 'deepEqual'), value(rewrite), rewrite(args[0])) };
		case 'toMatchObject':
			// Unlike jest, it lets arrays have more items than expected (in order), the one looser replacement.
			// Negated, it's stricter.
			return {
				build: (rewrite) => {
					const positive = call('partialDeepStrictEqual', value(rewrite), rewrite(args[0]));
					return not ? failing(positive, promise === 'resolves') : positive;
				},
			};
		case 'toBeNull':
			return { build: (rewrite) => call(method(not ? 'notEqual' : 'equal'), value(rewrite), 'null') };
		case 'toBeUndefined':
			return { build: (rewrite) => call(method(not ? 'notEqual' : 'equal'), value(rewrite), 'undefined') };
		case 'toBeDefined':
			return { build: (rewrite) => call(method(not ? 'equal' : 'notEqual'), value(rewrite), 'undefined') };
		case 'toBeTruthy':
			return { build: (rewrite) => (not ? call('ok', `!${asOperand(actual(rewrite))}`) : call('ok', value(rewrite))) };
		case 'toBeFalsy':
			return { build: (rewrite) => (not ? call('ok', value(rewrite)) : call('ok', `!${asOperand(actual(rewrite))}`)) };
		case 'toBeNaN':
			return { build: (rewrite) => call('ok', `${bang}Number.isNaN(${value(rewrite)})`) };
		case 'toBeInstanceOf':
			return { build: (rewrite) => ok(rewrite, (r) => `${asRelational(actual(r))} instanceof ${asRelational(operand(args[0], r))}`) };
		case 'toBeGreaterThan':
		case 'toBeGreaterThanOrEqual':
		case 'toBeLessThan':
		case 'toBeLessThanOrEqual':
			return { build: (rewrite) => ok(rewrite, (r) => `${asRelational(actual(r))} ${RELATIONS[matcher]} ${asRelational(operand(args[0], r))}`) };
		case 'toHaveLength':
			return { build: (rewrite) => call(method(not ? 'notEqual' : 'equal'), `${asObject(actual(rewrite))}.length`, rewrite(args[0])) };
		case 'toContain':
			return { build: (rewrite) => call('ok', `${bang}${asObject(actual(rewrite))}.includes(${rewrite(args[0])})`) };
		case 'toContainEqual': {
			if (not) {
				return unsupported("`not.toContainEqual()`: `isDeepStrictEqual()` is stricter than jest's equality, so its negation would pass for items jest considers equal.");
			}
			const contains = containsEqual(assertion, actual, context);
			if ('reason' in contains) return contains;
			return { build: (rewrite) => call('ok', contains.build(rewrite)) };
		}
		case 'toMatch': {
			const [pattern] = args;
			const isRegExp = pattern.kind() === 'regex' || (pattern.kind() === 'new_expression' && pattern.field('constructor')?.text() === 'RegExp');
			if (isRegExp) return { build: (rewrite) => call(not ? 'doesNotMatch' : 'match', value(rewrite), rewrite(pattern)) };
			// jest looks for a string as a substring
			if (pattern.kind() === 'string' || pattern.kind() === 'template_string') {
				return { build: (rewrite) => call('ok', `${bang}${asObject(actual(rewrite))}.includes(${rewrite(pattern)})`) };
			}
			return unsupported(`\`toMatch(${pattern.text()})\`: \`${pattern.text()}\` could be a string or a regular expression.`);
		}
		case 'toBeCloseTo': {
			if (not) return unsupported('`not.toBeCloseTo()` would pass for two infinities, which jest considers close.');
			const [, digits] = args;
			const precision = digits ? Number(digits.text()) : 2;
			if (digits && (digits.kind() !== 'number' || !Number.isInteger(precision))) {
				return unsupported('`toBeCloseTo()` with a computed precision: migrate it manually.');
			}
			// jest's own tolerance: half a unit of the last digit compared
			const tolerance = 10 ** -precision / 2;
			return {
				build: (rewrite) =>
					ok(rewrite, (r) => `Math.abs(${asRelational(actual(r))} - ${asSubtrahend(operand(args[0], r))}) < ${tolerance}`),
			};
		}
		case 'toHaveProperty': {
			const [path] = args;
			const key = stringValue(path);
			// jest reads `a.b` and `a[0]` as paths into the object
			if (key === undefined || /[.[\]]/.test(key)) return unsupported('`toHaveProperty()` with a property path: migrate it manually.');
			return { build: (rewrite) => ok(rewrite, (r) => `${path.text()} in ${asRelational(actual(r))}`) };
		}
	}
	return unsupported(`\`${matcher}()\` has no node:assert equivalent.`);
}

/**
 * The indentation the matcher's arguments have on top of the assertion's, when the matcher is on a line of its
 * own (`expect(x)\n\t.toEqual([\n\t\t…`): joined into a single call, the arguments lose it.
 */
function continuationIndent(assertion: Assertion, context: Context): string {
	const property = assertion.call.field('function')?.field('property');
	if (!property || property.range().start.line === assertion.expectCall.range().end.line) return '';
	const base = context.source.lineIndent(assertion.expectCall.range().start.index);
	const continuation = context.source.lineIndent(property.range().start.index);
	return continuation.startsWith(base) ? continuation.slice(base.length) : '';
}

const MULTILINE_TEMPLATE = { rule: { kind: 'template_string', regex: '\\n' } };

/** Rewrites the matcher's arguments without their continuation indentation (other than in template literals). */
function argumentRewrite(assertion: Assertion, context: Context, rewrite: Rewrite): Rewrite {
	const extra = continuationIndent(assertion, context);
	if (!extra) return rewrite;
	const isArgument = (node: SgNode) => assertion.args.some((arg) => arg.range().start.index === node.range().start.index && arg.range().end.index === node.range().end.index);
	return (node) => {
		const text = rewrite(node);
		if (!isArgument(node) || node.kind() === 'template_string' || node.has(MULTILINE_TEMPLATE)) return text;
		return text.replaceAll(`\n${extra}`, '\n');
	};
}

/**
 * jest's matchers as node:assert assertions. `await expect(promise).resolves.matcher()` becomes an assertion on
 * `await promise`, so it's rewritten from the `await`.
 */
export const assertionRules = (context: Context): Rule[] => [
	(node, { rewrite }) => {
		if (node.kind() !== 'await_expression' || isPinned(context, node)) return undefined;
		const argument = node.children().find((child) => child.isNamed());
		const assertion = argument && parseAssertion(argument, context);
		if (assertion?.promise !== 'resolves') return undefined;
		const migration = plan(assertion, context);
		return 'build' in migration ? migration.build(argumentRewrite(assertion, context, rewrite)) : undefined;
	},
	(node, { rewrite }) => {
		const assertion = parseAssertion(node, context);
		if (!assertion || isPinned(context, node)) return undefined;
		const migration = plan(assertion, context);
		if ('reason' in migration) {
			context.warn(node, `Kept on expect: ${migration.reason}`);
			return undefined;
		}
		return migration.build(argumentRewrite(assertion, context, rewrite));
	},
];
