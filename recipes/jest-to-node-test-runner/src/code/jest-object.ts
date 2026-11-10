import type { SgNode } from '@codemod.com/jssg-types/main';
import { type Context, argumentsOf, isShadowed } from './context.ts';
import type { Rule } from './rewriter.ts';

/** `jest.fn()` and `jest.spyOn()` are handled with the rest of the mock API. */
const MOCK_CREATION = new Set(['fn', 'spyOn']);

const ASYNC_TIMERS = 'node:test runs mocked timers synchronously, without flushing promises in between like jest.';

function useFakeTimers(options: SgNode | undefined, tracker: string, context: Context): string {
	// jest's fake clock starts at the real time, node:test's at 0
	if (!options) return `${tracker}.timers.enable({ now: Date.now() })`;
	const now = options.kind() === 'object' ? options.find({ rule: { kind: 'pair', has: { field: 'key', regex: '^now$' } } }) : null;
	const others = options.kind() === 'object' ? options.children().filter((child) => child.kind() === 'pair' || child.kind() === 'shorthand_property_identifier') : [];
	if (options.kind() !== 'object' || others.length > (now ? 1 : 0)) {
		context.warn(options, 'Only the `now` option of `jest.useFakeTimers()` maps to node:test: review the others.');
	}
	const value = now?.field('value')?.text() ?? 'Date.now()';
	return `${tracker}.timers.enable({ now: ${value} })`;
}

export const jestObjectRules = (context: Context): Rule[] => [
	(node, { rewrite }) => {
		if (node.kind() !== 'call_expression') return undefined;
		const callee = node.field('function');
		if (callee?.kind() !== 'member_expression') return undefined;
		const object = callee.field('object');
		if (object?.kind() !== 'identifier' || object.text() !== 'jest' || !context.isJestGlobal('jest') || isShadowed(object)) return undefined;

		const method = callee.field('property')?.text() ?? '';
		if (MOCK_CREATION.has(method)) return undefined;

		const tracker = context.tracker;
		const [first] = argumentsOf(node);
		const firstText = () => (first ? rewrite(first) : '');

		switch (method) {
			case 'useFakeTimers': {
				// jest reinstalls fake timers when they're on already, node:test throws
				const enable = useFakeTimers(first, tracker, context);
				if (node.parent()?.kind() === 'expression_statement') {
					return `${tracker}.timers.reset();\n${context.source.lineIndent(node.range().start.index)}${enable}`;
				}
				context.warn(node, `\`${tracker}.timers.enable()\` throws when the timers are already mocked: call \`${tracker}.timers.reset()\` before if they can be.`);
				return enable;
			}
			case 'useRealTimers':
				return `${tracker}.timers.reset()`;
			case 'advanceTimersByTimeAsync':
				context.warn(node, ASYNC_TIMERS);
				return `${tracker}.timers.tick(${firstText()})`;
			case 'advanceTimersByTime':
				return `${tracker}.timers.tick(${firstText()})`;
			case 'runAllTimersAsync':
				context.warn(node, ASYNC_TIMERS);
				return `${tracker}.timers.runAll()`;
			case 'runAllTimers':
				return `${tracker}.timers.runAll()`;
			case 'setSystemTime':
				if (!first) break;
				return `${tracker}.timers.setTime(${first.kind() === 'number' ? firstText() : `Number(${firstText()})`})`;
			case 'now':
				return 'Date.now()';
			case 'restoreAllMocks':
				return `${tracker}.restoreAll()`;
		}

		const hint =
			{
				mock: 'node:test mocks modules with `mock.module()` (behind `--experimental-test-module-mocks`), which is not hoisted above imports like `jest.mock()`',
				setTimeout: 'use `--test-timeout` or the `timeout` option of the test',
			}[method] ?? 'node:test has no equivalent';
		context.warn(node, `\`jest.${method}()\` was not migrated: ${hint}.`);
		return undefined;
	},
];
