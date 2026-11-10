import type { SgNode } from '@codemod.com/jssg-types/main';
import {
	type Context,
	type TestCallee,
	argumentsOf,
	callbackOf,
	contextName,
	isFunction,
	parameterPattern,
	parametersOf,
	testCallee,
} from './context.ts';
import type { Rule } from './rewriter.ts';

const RENAMES: Record<string, string> = {
	afterAll: 'after',
	beforeAll: 'before',
	fdescribe: 'describe.only',
	fit: 'it.only',
	xdescribe: 'describe.skip',
	xit: 'it.skip',
	xtest: 'test.skip',
};

const SNAPSHOT = { rule: { kind: 'property_identifier', regex: '^toMatch(Inline)?Snapshot$' } };

/** node:test's name for a jest test function (`fit` → `it.only`), or `null` if it has none. */
function calleeName(callee: TestCallee, node: SgNode, context: Context): string | null {
	const modifiers = callee.modifiers.filter((modifier) => modifier !== 'concurrent');
	if (modifiers.length < callee.modifiers.length) {
		context.warn(node, 'node:test runs tests in a file one after another: `concurrent` was dropped.');
	}
	if (modifiers.includes('failing')) {
		context.warn(node, '`.failing` has no node:test equivalent: migrate it manually.');
		return null;
	}
	return [RENAMES[callee.base] ?? callee.base, ...modifiers].join('.');
}

/**
 * node:test passes the test context first and the `done` callback second, where jest passes `done` alone.
 * Snapshots are asserted through the test context, so tests that take one get it as parameter.
 */
function parametersFor(callback: SgNode, callee: TestCallee): string | undefined {
	if (callee.kind === 'suite') return undefined;
	const params = parametersOf(callback);
	if (params.length === 1) return `(${contextName(callback)}, ${parameterPattern(params[0]).text})`;
	if (!params.length && callee.kind === 'test' && callback.has(SNAPSHOT)) return `(${contextName(callback)})`;
	return undefined;
}

export const testRules = (context: Context): Rule[] => [
	(node, { rewrite, splice }) => {
		if (node.kind() !== 'call_expression') return undefined;
		const calleeNode = node.field('function');
		const callee = testCallee(calleeNode, context);
		if (!callee || callee.modifiers.includes('each') || !calleeNode) return undefined;

		const name = calleeName(callee, node, context);
		if (name === null) return undefined;

		const args = argumentsOf(node);
		const callback = callbackOf(node, callee);
		const params = isFunction(callback) ? parametersFor(callback, callee) : undefined;
		const paramsNode = callback?.field('parameters') ?? callback?.field('parameter');
		// jest takes the timeout last, node:test in an options object
		const callbackIndex = callee.kind === 'hook' ? 0 : 1;
		const timeout = isFunction(callback) && args.length === callbackIndex + 2 ? args[callbackIndex + 1] : undefined;
		if (!timeout && !params && name === calleeNode.text()) return undefined;

		const callbackText =
			callback &&
			(params && paramsNode
				? splice(callback, (child) => (child.range().start.index === paramsNode.range().start.index ? params : undefined))
				: rewrite(callback));

		if (timeout && callbackText) {
			const options = `{ timeout: ${rewrite(timeout)} }`;
			return callee.kind === 'hook'
				? `${name}(${callbackText}, ${options})`
				: `${name}(${rewrite(args[0])}, ${options}, ${callbackText})`;
		}

		const argumentsNode = node.field('arguments');
		return splice(node, (child) => {
			const start = child.range().start.index;
			if (start === calleeNode.range().start.index) return name;
			if (callback && callbackText && start === argumentsNode?.range().start.index) {
				return splice(child, (arg) => (arg.range().start.index === callback.range().start.index ? callbackText : undefined));
			}
			return undefined;
		});
	},
];
