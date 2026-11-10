import type { SgNode } from '@codemod.com/jssg-types/main';
import { type Context, argumentsOf, callbackOf, contextName, isShadowed, testCallee } from './context.ts';
import type { Rule } from './rewriter.ts';

const RETURNED = '(call) => call.error === undefined';

const nth = (index: string) => (/^\d+$/.test(index) ? `${Number(index) - 1}` : `${index} - 1`);

/**
 * jest's mock matchers as assertions on node:test's call records. jest compares arguments and return values
 * with `toEqual`'s recursive equality (asymmetric matchers included), so that's what the rewrites use.
 */
const MOCK_MATCHERS: Record<string, (mock: string, args: string[], not: string) => string | null> = {
	toHaveBeenCalled: (mock, _, not) => (not ? `expect(${mock}.callCount()).toBe(0)` : `expect(${mock}.callCount()).toBeGreaterThan(0)`),
	toHaveBeenCalledTimes: (mock, [times], not) => `expect(${mock}.callCount()).${not}toBe(${times})`,
	toHaveBeenCalledWith: (mock, args, not) =>
		`expect(${mock}.calls.map((call) => call.arguments)).${not}toContainEqual([${args.join(', ')}])`,
	toHaveBeenLastCalledWith: (mock, args, not) => `expect(${mock}.calls.at(-1)?.arguments).${not}toEqual([${args.join(', ')}])`,
	toHaveBeenNthCalledWith: (mock, [index, ...args], not) =>
		index ? `expect(${mock}.calls[${nth(index)}]?.arguments).${not}toEqual([${args.join(', ')}])` : null,
	toHaveReturned: (mock, _, not) => `expect(${mock}.calls.some(${RETURNED})).toBe(${not ? 'false' : 'true'})`,
	toHaveReturnedTimes: (mock, [times], not) => `expect(${mock}.calls.filter(${RETURNED})).${not}toHaveLength(${times})`,
	toHaveReturnedWith: (mock, [value], not) =>
		`expect(${mock}.calls.filter(${RETURNED}).map((call) => call.result)).${not}toContainEqual(${value})`,
	toHaveLastReturnedWith: (mock, [value], not) => `expect(${mock}.calls.at(-1)?.result).${not}toEqual(${value})`,
	toHaveNthReturnedWith: (mock, [index, value], not) =>
		index ? `expect(${mock}.calls[${nth(index)}]?.result).${not}toEqual(${value})` : null,
};

const SNAPSHOT_MATCHERS = new Set(['toMatchSnapshot', 'toMatchInlineSnapshot']);
const UNSUPPORTED_MATCHERS = new Set(['toThrowErrorMatchingSnapshot', 'toThrowErrorMatchingInlineSnapshot']);

interface Assertion {
	subject: SgNode;
	not: boolean;
	matcher: string;
	args: SgNode[];
}

/** `expect(subject)[.not].matcher(args)` */
function parseAssertion(node: SgNode, context: Context): Assertion | null {
	if (node.kind() !== 'call_expression') return null;
	const callee = node.field('function');
	if (callee?.kind() !== 'member_expression') return null;
	const matcher = callee.field('property')?.text() ?? '';
	let object = callee.field('object');
	let not = false;
	if (object?.kind() === 'member_expression' && object.field('property')?.text() === 'not') {
		not = true;
		object = object.field('object');
	}
	if (object?.kind() !== 'call_expression') return null;
	const expect = object.field('function');
	if (expect?.kind() !== 'identifier' || expect.text() !== 'expect' || !context.isJestGlobal('expect') || isShadowed(expect)) return null;
	const [subject] = argumentsOf(object);
	if (!subject) return null;
	return { subject, not, matcher, args: argumentsOf(node) };
}

/** Whether `typeof node` is a valid type query: `a`, `a.b`, `this.a.b`. */
const isEntityName = (node: SgNode): boolean => {
	if (node.kind() === 'identifier' || node.kind() === 'this') return true;
	if (node.kind() !== 'member_expression') return false;
	const object = node.field('object');
	return !!object && node.field('property')?.kind() === 'property_identifier' && isEntityName(object);
};

const REFERENCE = new Set(['identifier', 'member_expression', 'subscript_expression', 'call_expression', 'this', 'parenthesized_expression']);

/** The test callback whose context `node` can use, if it is inside one (and not inside a nested test). */
function enclosingTest(node: SgNode, context: Context): SgNode | undefined {
	for (const ancestor of node.ancestors()) {
		if (ancestor.kind() !== 'call_expression') continue;
		const callee = testCallee(ancestor.field('function'), context);
		if (!callee) continue;
		if (callee.kind !== 'test') return undefined;
		const callback = callbackOf(ancestor, callee);
		return callback && node.range().start.index >= callback.range().start.index ? callback : undefined;
	}
	return undefined;
}

export const matcherRules = (context: Context): Rule[] => [
	(node, { rewrite }) => {
		const assertion = parseAssertion(node, context);
		if (!assertion) return undefined;
		const { subject, not, matcher, args } = assertion;

		if (UNSUPPORTED_MATCHERS.has(matcher)) {
			context.warn(node, `\`${matcher}()\` has no node:test equivalent: migrate it manually.`);
			return undefined;
		}

		if (SNAPSHOT_MATCHERS.has(matcher)) {
			const callback = enclosingTest(node, context);
			const [hint] = args;
			if (!callback || not || (hint && matcher === 'toMatchSnapshot' && hint.kind() !== 'string')) {
				context.warn(node, `\`${matcher}()\` can only be migrated directly inside a test, without property matchers.`);
				return undefined;
			}
			if (matcher === 'toMatchInlineSnapshot') {
				context.warn(
					node,
					'node:test has no inline snapshots: this one moves to the snapshot file, run the tests with `--test-update-snapshots` to write it.',
				);
			}
			return `${contextName(callback)}.assert.snapshot(${rewrite(subject)})`;
		}

		const migrate = MOCK_MATCHERS[matcher];
		if (!migrate) return undefined;
		if (/^toHaveNth/.test(matcher) && !args.length) {
			context.warn(node, `Unsupported \`${matcher}()\` arguments: migrate it manually.`);
			return undefined;
		}

		let mock = rewrite(subject);
		if (!REFERENCE.has(subject.kind() as string)) mock = `(${mock})`;
		// `obj.method` may be a mock without being typed as one: spied (`jest.spyOn(obj, 'method')`), or
		// created for an object typed after an interface. jest's `expect()` took anything, `.mock` needs a mock.
		if (context.isTypeScript && isEntityName(subject) && subject.kind() === 'member_expression' && !context.knownMocks.has(subject.text())) {
			context.needsMockType = true;
			mock = `(${mock} as Mock<typeof ${mock}>)`;
		}

		return migrate(`${mock}.mock`, args.map(rewrite), not ? 'not.' : '') ?? undefined;
	},
];
