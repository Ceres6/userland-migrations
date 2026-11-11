import type { SgNode } from '@codemod.com/jssg-types/main';
import { parseAssertion } from './assertions.ts';
import { type Context, isExpect } from './context.ts';
import { REMOVE, type Rule } from './rewriter.ts';
import { argumentsOf, isFunction, ownerFunction, sameNode } from './scope.ts';

const unwrapAwait = (node: SgNode | undefined) =>
	node?.kind() === 'await_expression' ? node.children().find((child) => child.isNamed()) : node;

/** Helpers named like assertions (`assertSaved()`, `repository.expectNothingSaved()`), by convention. */
const HELPER_NAME = /^(assert|expect)[A-Z0-9_]/;

const expressionOf = (statement: SgNode) => unwrapAwait(statement.children().find((child) => child.isNamed()));

function countCall(statement: SgNode, context: Context) {
	if (statement.kind() !== 'expression_statement') return undefined;
	const call = expressionOf(statement);
	const callee = call?.kind() === 'call_expression' ? call.field('function') : undefined;
	if (callee?.kind() !== 'member_expression' || !isExpect(context, callee.field('object'))) return undefined;
	const name = callee.field('property')?.text();
	return name === 'hasAssertions' || name === 'assertions' ? { name, call: call as SgNode } : undefined;
}

const isHelperCall = (call: SgNode | undefined) => {
	if (call?.kind() !== 'call_expression') return false;
	const callee = call.field('function');
	const name = callee?.kind() === 'member_expression' ? callee.field('property') : callee;
	return HELPER_NAME.test(name?.text() ?? '');
};

const namedChildren = (node: SgNode) => node.children().filter((child) => child.isNamed() && child.kind() !== 'comment');

/** `[a, b]`: a loop over it runs at least once. */
const isNonEmptyArray = (node: SgNode | null | undefined) =>
	node?.kind() === 'array' && namedChildren(node).some((element) => element.kind() !== 'spread_element');

interface Run {
	call: SgNode;
	/** Whether it runs exactly once (not in a loop). */
	once: boolean;
}

/**
 * The calls sure to run whenever `fn` completes: its statements before any early return, those in `finally`
 * blocks, and those in loops over non-empty array literals (`[a, b].forEach(…)`, `for (… of [a, b])`).
 */
function sureToRun(fn: SgNode, once = true): Run[] {
	const body = fn.field('body');
	if (!body) return [];
	if (body.kind() !== 'statement_block') {
		const call = unwrapAwait(body);
		return call ? [{ call, once }] : [];
	}
	const own = (node: SgNode) => sameNode(ownerFunction(node), fn);
	const firstReturn = Math.min(
		...fn
			.findAll({ rule: { kind: 'return_statement' } })
			.filter(own)
			.map((node) => node.range().start.index),
	);
	const runs: Run[] = [];

	const visit = (statement: SgNode, times: boolean) => {
		if (statement.range().start.index > firstReturn) return;
		const kind = statement.kind() as string;
		if (kind === 'expression_statement' || kind === 'return_statement') {
			const call = expressionOf(statement);
			if (!call) return;
			runs.push({ call, once: times });
			const callee = call.kind() === 'call_expression' ? call.field('function') : undefined;
			const [callback] = call.kind() === 'call_expression' ? argumentsOf(call) : [];
			if (callee?.kind() === 'member_expression' && callee.field('property')?.text() === 'forEach' && isNonEmptyArray(callee.field('object')) && isFunction(callback)) {
				runs.push(...sureToRun(callback, false));
			}
		} else if (kind === 'statement_block') {
			for (const child of namedChildren(statement)) visit(child, times);
		} else if (kind === 'for_in_statement' && isNonEmptyArray(statement.field('right'))) {
			const loop = statement.field('body');
			const exits = loop?.has({ rule: { any: [{ kind: 'break_statement' }, { kind: 'continue_statement' }] } });
			if (loop && !exits) visit(loop, false);
		} else if (kind === 'try_statement') {
			const block = statement.field('finalizer')?.field('body');
			if (block) visit(block, times);
		}
	};
	for (const statement of namedChildren(body)) visit(statement, once);
	return runs;
}

/** What a test function asserts, and whether each assertion is sure to run. */
function assertionsOf(fn: SgNode, context: Context) {
	const runs = sureToRun(fn);
	const direct = runs.filter((run) => parseAssertion(run.call, context));
	const calls = fn.findAll({ rule: { kind: 'call_expression' } });
	return {
		direct,
		all: calls.filter((call) => parseAssertion(call, context)),
		helpers: runs.filter((run) => isHelperCall(run.call)),
		anyHelpers: calls.some(isHelperCall),
		runsOnce: (call: SgNode) => direct.some((run) => run.once && sameNode(run.call, call)),
	};
}

/**
 * node:assert doesn't count assertions, so `expect.hasAssertions()` and `expect.assertions(n)` can only go where
 * they can't fail: where the test is sure to run (as many) assertions. Elsewhere, the test stays on expect.
 */
export function assertionCountRules(root: SgNode, context: Context): Rule[] {
	const removed = new Set<number>();

	for (const statement of root.findAll({ rule: { kind: 'expression_statement' } })) {
		const count = countCall(statement, context);
		if (!count) continue;
		const fn = ownerFunction(statement);
		if (!fn) {
			context.warn(statement, `Kept on expect: \`expect.${count.name}()\` outside of a test.`);
			continue;
		}
		const { direct, all, helpers, anyHelpers, runsOnce } = assertionsOf(fn, context);
		const pin = (reason: string) => {
			context.pinned.push([fn.range().start.index, fn.range().end.index]);
			context.warn(statement, `Kept this test on expect: ${reason}`);
		};

		if (count.name === 'hasAssertions') {
			if (direct.length || helpers.length) removed.add(statement.range().start.index);
			else if (all.length) pin('its assertions only run conditionally, and node:assert has no `expect.hasAssertions()`.');
			else {
				removed.add(statement.range().start.index);
				context.warn(statement, 'Removed `expect.hasAssertions()`: the test makes no assertion itself, make sure the code it calls does.');
			}
			continue;
		}

		const [expected] = count.call.field('arguments')?.children().filter((child) => child.isNamed()) ?? [];
		const exact = expected?.kind() === 'number' && Number(expected.text()) === all.length;
		if (exact && !anyHelpers && all.every(runsOnce)) removed.add(statement.range().start.index);
		else pin('node:assert has no `expect.assertions()` (`t.plan()` counts `t.assert` assertions).');
	}

	return [(node) => (node.kind() === 'expression_statement' && removed.has(node.range().start.index) ? REMOVE : undefined)];
}
