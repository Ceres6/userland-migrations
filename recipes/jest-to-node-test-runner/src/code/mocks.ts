import type { SgNode } from '@codemod.com/jssg-types/main';
import { type Context, argumentsOf, isFunction, isShadowed, parametersOf, testCallee } from './context.ts';
import { REMOVE, type Rule } from './rewriter.ts';

const ANY_FUNCTION = '(...args: any[]) => any';

/** jest's mock configuration methods, all of which return the mock so they chain. */
const CONFIG_METHODS = new Set([
	'mockClear',
	'mockImplementation',
	'mockImplementationOnce',
	'mockName',
	'mockRejectedValue',
	'mockRejectedValueOnce',
	'mockReset',
	'mockResolvedValue',
	'mockResolvedValueOnce',
	'mockRestore',
	'mockReturnThis',
	'mockReturnValue',
	'mockReturnValueOnce',
]);

const UNSUPPORTED_METHODS = new Set(['getMockImplementation', 'getMockName', 'withImplementation']);

/** Properties of node:test's call records, to recognise already migrated accesses. */
const CALL_RECORD_KEYS = new Set(['arguments', 'error', 'result', 'stack', 'target', 'this']);

/** Array methods whose callback can destructure the call record instead of the arguments array. */
const FUSABLE_METHODS = new Set(['every', 'flatMap', 'forEach', 'map', 'some']);

const IMPURE = new Set(['call_expression', 'new_expression', 'await_expression']);

const SIMPLE_REFERENCE = new Set(['identifier', 'this', 'member_expression', 'subscript_expression']);

interface Link {
	method: string;
	args: SgNode[];
	call: SgNode;
}

/**
 * Whether a chain's receiver can be a jest mock: a reference to one, or its creation. Other calls are
 * libraries' own chains, like jest-when's `when(fn).calledWith(1).mockReturnValue(2)`.
 */
const isMockReceiver = (base: SgNode) =>
	base.kind() !== 'call_expression' ||
	/^jest\.(fn|spyOn)$/.test(base.field('function')?.text() ?? '');

/** `x.mockReturnValue(1).mockName('x')` → base `x` and its links. */
function unrollChain(node: SgNode): { base: SgNode; links: Link[] } | null {
	const links: Link[] = [];
	let current = node;
	while (current.kind() === 'call_expression') {
		const callee = current.field('function');
		const method = callee?.kind() === 'member_expression' ? callee.field('property')?.text() : undefined;
		const object = callee?.field('object');
		if (!method || !object || !CONFIG_METHODS.has(method)) break;
		links.unshift({ method, args: argumentsOf(current), call: current });
		current = object;
	}
	return links.length && isMockReceiver(current) ? { base: current, links } : null;
}

/** Configuration of something that isn't a jest mock (jest-when and the like): left alone, with a warning. */
const foreignChains = (context: Context): Rule => (node) => {
	if (node.kind() !== 'call_expression') return undefined;
	const callee = node.field('function');
	const method = callee?.kind() === 'member_expression' ? callee.field('property')?.text() : undefined;
	const object = callee?.field('object');
	if (!method || !object || !CONFIG_METHODS.has(method) || unrollChain(node)) return undefined;
	// Once per chain, at its outermost call
	const parent = node.parent();
	const chained = parent?.kind() === 'member_expression' && CONFIG_METHODS.has(parent.field('property')?.text() ?? '');
	if (!chained) {
		context.warn(node, `\`${node.text().split('\n')[0]}\` doesn't configure a jest mock directly (jest-when?): migrate it by hand.`);
	}
	return undefined;
};

const jestMethod = (call: SgNode, context: Context) => {
	const callee = call.field('function');
	if (callee?.kind() !== 'member_expression') return undefined;
	const object = callee.field('object');
	if (object?.kind() !== 'identifier' || object.text() !== 'jest' || !context.isJestGlobal('jest') || isShadowed(object)) return undefined;
	return callee.field('property')?.text();
};

const isCreation = (node: SgNode, context: Context) =>
	node.kind() === 'call_expression' && ['fn', 'spyOn'].includes(jestMethod(node, context) ?? '');

/** Parenthesises a receiver that `.mock` can't be appended to as is. */
const receiver = (base: SgNode, text: string) =>
	[...SIMPLE_REFERENCE, 'call_expression', 'parenthesized_expression', 'non_null_expression'].includes(base.kind() as string)
		? text
		: `(${text})`;

const isSimpleReference = (node: SgNode): boolean => {
	if (node.kind() === 'identifier' || node.kind() === 'this') return true;
	if (node.kind() === 'member_expression') {
		const object = node.field('object');
		return !!object && isSimpleReference(object);
	}
	return false;
};

/** `jest.fn<…>()` type arguments as node:test's single function type. */
function mockFunctionType(call: SgNode, context: Context): string {
	if (!context.isTypeScript) return '';
	const typeArguments = call.field('type_arguments');
	if (!typeArguments) return `<${ANY_FUNCTION}>`;
	const types = typeArguments.children().filter((child) => child.isNamed());
	// `@jest/globals`' `jest.fn<F>()` takes the function type; `@types/jest`' takes the return and argument types
	if (context.importsJestGlobals) return typeArguments.text();
	const [returns, parameters] = types.map((type) => type.text());
	return `<(...args: ${parameters ?? 'any[]'}) => ${returns ?? 'any'}>`;
}

/** The implementation a configuration link sets, or `undefined` if it doesn't set one. */
function implementationOf(link: Link, value: string, context: Context): string | undefined {
	switch (link.method.replace(/Once$/, '')) {
		case 'mockImplementation':
			return value;
		case 'mockReturnValue':
			return `() => ${value}`;
		case 'mockResolvedValue':
			return `() => Promise.resolve(${value})`;
		case 'mockRejectedValue':
			return `() => Promise.reject(${value})`;
		case 'mockReturnThis':
			return context.isTypeScript ? 'function (this: unknown) { return this; }' : 'function () { return this; }';
		default:
			return undefined;
	}
}

/** node:test calls (on `fn.mock`) replacing a jest configuration link. `null` when there's no equivalent. */
function configure(link: Link, value: string, onCall: string, context: Context): string[] | null {
	const implementation = implementationOf(link, value, context);
	if (implementation !== undefined) {
		return link.method.endsWith('Once')
			? [`mockImplementationOnce(${implementation}${onCall})`]
			: [`mockImplementation(${implementation})`];
	}
	switch (link.method) {
		case 'mockClear':
			return ['resetCalls()'];
		case 'mockReset':
			// jest 30 also drops the implementation: the mock returns undefined
			return ['resetCalls()', 'mockImplementation(() => undefined)'];
		case 'mockRestore':
			return ['restore()'];
		case 'mockName':
			return [];
		default:
			return null;
	}
}

const isValueMethod = (method: string) => /^mock(ReturnValue|ResolvedValue|RejectedValue)$/.test(method);

const shouldHoist = (link: Link) => {
	const [value] = link.args;
	if (!value || !isValueMethod(link.method)) return false;
	// A fresh error per call is indistinguishable from jest's single one but for its stack
	if (link.method === 'mockRejectedValue' && value.kind() === 'new_expression') return false;
	return IMPURE.has(value.kind() as string);
};

const isMockConfigStatement = (statement: SgNode) => {
	const expression = statement.kind() === 'expression_statement' ? statement.children()[0] : undefined;
	return !!expression && !!unrollChain(expression);
};

/**
 * How many `*Once` registrations on `receiverText` precede `statement` in its run of mock configuration
 * statements: node:test's `mockImplementationOnce()` targets a call index rather than queueing, so each
 * one needs its own index.
 */
function precedingOnceRegistrations(statement: SgNode, receiverText: string): number {
	let count = 0;
	let sibling = statement.prev();
	while (sibling) {
		if (sibling.kind() === 'comment') {
			sibling = sibling.prev();
			continue;
		}
		if (!isMockConfigStatement(sibling)) break;
		const chain = unrollChain(sibling.children()[0]);
		if (chain && chain.base.text() === receiverText) {
			count += chain.links.filter((link) => link.method.endsWith('Once')).length;
		}
		sibling = sibling.prev();
	}
	return count;
}

const enclosingFunction = (node: SgNode) =>
	node
		.ancestors()
		.find((ancestor) =>
			['arrow_function', 'function_expression', 'function_declaration', 'method_definition'].includes(ancestor.kind() as string),
		);

/** Whether `fn` is the callback of a test, suite or hook. */
const isTestCallback = (fn: SgNode | undefined, context: Context) => {
	const call = fn?.parent()?.parent();
	return call?.kind() === 'call_expression' && !!testCallee(call.field('function'), context);
};

/** A `const` name that is free in the function (or file) around `node`. */
function freeName(node: SgNode, base: string, taken: Set<string>): string {
	const scope = enclosingFunction(node) ?? node.getRoot().root();
	const text = scope.text();
	for (let suffix = 1; ; suffix++) {
		const name = suffix === 1 ? base : `${base}${suffix}`;
		if (!taken.has(name) && !new RegExp(`\\b${name}\\b`).test(text)) {
			taken.add(name);
			return name;
		}
	}
}

/** node:test's equivalent of a `jest.fn()` / `jest.spyOn()` call, with an optional implementation. */
function createMock(call: SgNode, implementation: string | undefined, rewrite: (node: SgNode) => string, context: Context) {
	const args = argumentsOf(call).map(rewrite);
	if (jestMethod(call, context) === 'fn') {
		// `jest.fn(impl)` is typed after `impl`; `jest.fn()` accepts any implementation later on
		const inferred = implementation === undefined && args[0] && !call.field('type_arguments');
		const impl = implementation ?? args[0];
		return `${context.tracker}.fn${inferred ? '' : mockFunctionType(call, context)}(${impl ?? ''})`;
	}

	const [object, property, accessType] = args;
	const kind = accessType?.match(/^['"`](get|set)['"`]$/)?.[1];
	const method = kind === 'get' ? 'getter' : kind === 'set' ? 'setter' : 'method';
	return `${context.tracker}.${method}(${[object, property, implementation].filter(Boolean).join(', ')})`;
}

/** How many node:test calls replace a configuration link. */
const callsFor = (method: string) => (method === 'mockName' ? 0 : method === 'mockReset' ? 2 : 1);

/** Whether a creation's first configuration link can become the mock's implementation. */
const folds = (link: Link | undefined, context: Context) =>
	!!link && !link.method.endsWith('Once') && implementationOf(link, '', context) !== undefined;

const linkValue = (link: Link, rewrite: (node: SgNode) => string) => (link.args[0] ? rewrite(link.args[0]) : 'undefined');

/**
 * Mock configuration chains in statement position: one node:test call per line.
 *
 * Every check happens before rewriting anything, so a chain that's left alone is only visited once.
 */
const configurationStatement = (context: Context): Rule => (node, { rewrite }) => {
	if (node.kind() !== 'expression_statement') return undefined;
	const expression = node.children()[0];
	if (!expression) return undefined;
	const chain = unrollChain(expression);
	if (!chain) return undefined;

	const { base, links } = chain;

	if (isCreation(base, context)) {
		// `jest.spyOn(o, 'm').mockReturnValue(1)`: the first link becomes the mock's implementation
		const [first, ...rest] = links;
		const remaining = folds(first, context) ? rest : links;
		if (remaining.reduce((count, link) => count + callsFor(link.method), 0) > 1) {
			context.warn(expression, 'Unsupported mock configuration chain: migrate it manually.');
			return undefined;
		}
		const implementation = folds(first, context) ? implementationOf(first, linkValue(first, rewrite), context) : undefined;
		const created = createMock(base, implementation, rewrite, context);
		const calls = remaining.flatMap((link) => configure(link, linkValue(link, rewrite), '', context) ?? []);
		return `${calls.length ? `${created}.mock.${calls[0]}` : created};`;
	}

	const lineCount = links.reduce((count, link) => count + callsFor(link.method) + (shouldHoist(link) ? 1 : 0), 0);
	if (!lineCount) return REMOVE;
	if (lineCount > 1 && !isSimpleReference(base)) {
		context.warn(expression, 'Mock configuration chain on a computed receiver: migrate it manually.');
		return undefined;
	}

	const indent = context.source.lineIndent(node.range().start.index);
	const receiverText = receiver(base, rewrite(base));
	const taken = new Set<string>();
	const lines: string[] = [];
	let once = precedingOnceRegistrations(node, base.text());

	for (const link of links) {
		let value = linkValue(link, rewrite);
		if (shouldHoist(link)) {
			const name = freeName(node, link.method.replace(/^mock/, '').replace(/^\w/, (c) => c.toLowerCase()), taken);
			lines.push(`const ${name} = ${value};`);
			value = name;
		}

		const isOnce = link.method.endsWith('Once');
		const onCall = isOnce && once > 0 ? `, ${receiverText}.mock.callCount() + ${once}` : '';
		if (isOnce) {
			once++;
			if (!isTestCallback(enclosingFunction(node), context)) {
				context.warn(
					link.call,
					`\`${link.method}()\` outside a test: node:test's \`mockImplementationOnce()\` targets the next call instead of queueing, so registering several before the mock is called keeps only the last one. Pass \`onCall\` explicitly if this runs more than once per call.`,
				);
			}
		}

		lines.push(...(configure(link, value, onCall, context) ?? []).map((call) => `${receiverText}.mock.${call};`));
	}

	return lines.join(`\n${indent}`);
};

/** Mock configuration chains used as values, e.g. `const spy = jest.spyOn(o, 'm').mockReturnValue(1)`. */
const configurationExpression = (context: Context): Rule => (node, { rewrite }) => {
	if (node.kind() !== 'call_expression') return undefined;
	const chain = unrollChain(node);
	if (!chain) return undefined;

	const { base, links } = chain;
	const named = links.filter((link) => link.method !== 'mockName');

	if (isCreation(base, context)) {
		const [first] = named;
		if (named.length > 1 || (first && !folds(first, context))) {
			context.warn(node, 'Unsupported mock configuration chain while creating a mock: migrate it manually.');
			return undefined;
		}
		if (first && shouldHoist(first)) {
			context.warn(
				first.args[0],
				'jest evaluated this value once, the migrated implementation evaluates it on every call: hoist it to a variable if that matters.',
			);
		}
		const implementation = first ? implementationOf(first, linkValue(first, rewrite), context) : undefined;
		return createMock(base, implementation, rewrite, context);
	}

	const [link] = named;
	if (named.length !== 1 || callsFor(link.method) !== 1) {
		context.warn(node, 'Mock configuration chain used as a value: migrate it manually.');
		return undefined;
	}
	const [call] = configure(link, linkValue(link, rewrite), '', context) ?? [];
	return `${receiver(base, rewrite(base))}.mock.${call}`;
};

/** jest mock methods node:test has no counterpart for. */
const unsupportedMethods = (context: Context): Rule => (node) => {
	if (node.kind() !== 'call_expression') return undefined;
	const callee = node.field('function');
	const method = callee?.kind() === 'member_expression' ? callee.field('property')?.text() : undefined;
	if (method && UNSUPPORTED_METHODS.has(method)) {
		context.warn(node, `\`${method}()\` has no node:test equivalent: migrate it manually.`);
	}
	return undefined;
};

/** `jest.fn()` / `jest.spyOn()` on their own. */
const creation = (context: Context): Rule => (node, { rewrite }) => {
	if (node.kind() !== 'call_expression') return undefined;
	if (!isCreation(node, context)) return undefined;
	return createMock(node, undefined, rewrite, context);
};

/** A jest mock's `mock` object: `fn.mock`, or a `mock` destructured from one. */
const isMockState = (node: SgNode | null) =>
	!!node &&
	((node.kind() === 'member_expression' && node.field('property')?.text() === 'mock') ||
		(node.kind() === 'identifier' && node.text() === 'mock'));

const recordAccess = (node: SgNode) => {
	const parent = node.parent();
	return (
		parent?.kind() === 'member_expression' &&
		parent.field('object')?.range().start.index === node.range().start.index &&
		CALL_RECORD_KEYS.has(parent.field('property')?.text() ?? '')
	);
};

/** `fn.mock.calls[0]` → `fn.mock.calls[0].arguments`, and jest's other `mock` state. */
const mockState = (context: Context): Rule => (node, { rewrite, splice }) => {
	const kind = node.kind();

	if (kind === 'subscript_expression') {
		const calls = node.field('object');
		if (calls?.kind() !== 'member_expression' || calls.field('property')?.text() !== 'calls') return undefined;
		const state = calls.field('object');
		if (!isMockState(state) || recordAccess(node)) return undefined;
		// jest's untyped mocks indexed as `any`: the record exists, as jest's code assumed (noUncheckedIndexedAccess)
		const assertion = context.isTypeScript ? '!' : '';
		return `${rewrite(state)}.calls[${rewrite(node.field('index'))}]${assertion}.arguments`;
	}

	if (kind === 'call_expression') {
		const callee = node.field('function');
		const calls = callee?.kind() === 'member_expression' ? callee.field('object') : undefined;
		if (calls?.kind() !== 'member_expression' || calls.field('property')?.text() !== 'calls') return undefined;
		const state = calls.field('object');
		if (!isMockState(state)) return undefined;
		const method = callee.field('property')?.text() ?? '';

		if (method === 'at') {
			if (recordAccess(node)) return undefined;
			return `${rewrite(state)}.calls.at(${argumentsOf(node).map(rewrite).join(', ')})?.arguments`;
		}

		const [fn, ...rest] = argumentsOf(node);
		if (!FUSABLE_METHODS.has(method) || !isFunction(fn)) return undefined;
		const [first, ...otherParams] = parametersOf(fn);
		const pattern = first?.kind() === 'required_parameter' ? first.field('pattern') : first;
		if (pattern?.kind() !== 'array_pattern') return undefined;
		const params = fn.field('parameters');
		const callback = splice(fn, (child) =>
			child.range().start.index === params?.range().start.index
				? `({ arguments: ${rewrite(pattern)} }${otherParams.map((param) => `, ${rewrite(param)}`).join('')})`
				: undefined,
		);
		return `${rewrite(state)}.calls.${method}(${[callback, ...rest.map(rewrite)].join(', ')})`;
	}

	if (kind === 'variable_declarator') {
		// `const { calls } = fn.mock`: jest's shape, arguments lists, for every later use
		const pattern = node.field('name');
		const value = node.field('value');
		if (pattern?.kind() !== 'object_pattern' || !isMockState(value)) return undefined;
		const keys = pattern.children().filter((child) => child.isNamed()).map((child) => child.text());
		if (keys.length === 1 && keys[0] === 'calls') return `calls = ${rewrite(value)}.calls.map((call) => call.arguments)`;
		if (keys.some((key) => /^(calls|lastCall|results|instances|contexts)\b/.test(key))) {
			context.warn(node, "Destructuring jest's mock state: migrate it by hand (node:test records calls as `{ arguments, result, error, this }`).");
		}
		return undefined;
	}

	if (kind !== 'member_expression') return undefined;
	const property = node.field('property')?.text();
	const state = node.field('object');
	if (!isMockState(state)) return undefined;
	const stateText = rewrite(state);

	switch (property) {
		case 'calls': {
			const parent = node.parent();
			const parentProperty = parent?.kind() === 'member_expression' ? parent.field('property')?.text() : undefined;
			if (parentProperty === 'length') return undefined;
			// Already migrated
			if (parentProperty === 'map' && parent?.parent()?.text().includes('call.arguments')) return undefined;
			return `${stateText}.calls.map((call) => call.arguments)`;
		}
		case 'lastCall':
			return `${stateText}.calls.at(-1)?.arguments`;
		case 'results':
			return `${stateText}.calls.map((call) => ({ type: call.error === undefined ? 'return' : 'throw', value: call.error === undefined ? call.result : call.error }))`;
		case 'instances':
		case 'contexts':
			return `${stateText}.calls.map((call) => call.this)`;
		default:
			return undefined;
	}
};

/** `jest.Mock<R, A>` → `Mock<(...args: A) => R>` and friends. */
const mockTypes = (context: Context): Rule => (node, { rewrite }) => {
	const kind = node.kind();
	if (kind !== 'generic_type' && kind !== 'nested_type_identifier') return undefined;
	if (kind === 'nested_type_identifier' && node.parent()?.kind() === 'generic_type') return undefined;

	const name = kind === 'generic_type' ? node.field('name') : node;
	if (name?.kind() !== 'nested_type_identifier' || name.field('module')?.text() !== 'jest') return undefined;
	if (!context.isJestGlobal('jest')) return undefined;

	const type = name.field('name')?.text() ?? '';
	const isFunctionMock = ['MockedFunction', 'MockedFn', 'SpiedFunction'].includes(type);
	if (!isFunctionMock && !['Mock', 'MockInstance', 'SpyInstance'].includes(type)) {
		context.warn(node, `\`jest.${type}\` has no node:test equivalent: type it manually.`);
		return undefined;
	}
	const typeArguments = kind === 'generic_type' ? node.field('type_arguments') : undefined;
	const args = typeArguments?.children().filter((child) => child.isNamed()).map(rewrite) ?? [];

	let functionType: string;
	if (isFunctionMock) {
		functionType = args[0] ?? ANY_FUNCTION;
	} else {
		functionType =
			context.importsJestGlobals && args.length === 1
				? args[0]
				: `(...args: ${args[1] ?? 'any[]'}) => ${args[0] ?? 'any'}`;
	}
	context.needsMockType = true;
	return `Mock<${functionType}>`;
};

export const mockRules = (context: Context): Rule[] => [
	configurationStatement(context),
	configurationExpression(context),
	foreignChains(context),
	unsupportedMethods(context),
	creation(context),
	mockState(context),
	mockTypes(context),
];

/** What the file declares as mocks, so matchers on them need no cast to node:test's `Mock` type. */
export function knownMocks(root: SgNode, context: Context): Set<string> {
	const mocks = new Set<string>();
	const isMockValue = (value: SgNode | null) => {
		if (!value) return false;
		const chain = value.kind() === 'call_expression' ? unrollChain(value) : null;
		return isCreation(chain?.base ?? value, context);
	};
	const isMockType = (type: SgNode | null) => !!type && /\bjest\.(Mock|MockedFunction|MockedFn|SpyInstance|SpiedFunction|MockInstance)\b/.test(type.text());

	for (const declarator of root.findAll({ rule: { kind: 'variable_declarator' } })) {
		const name = declarator.field('name');
		if (name?.kind() === 'identifier' && (isMockValue(declarator.field('value')) || isMockType(declarator.field('type')))) {
			mocks.add(name.text());
		}
	}
	for (const field of root.findAll({ rule: { kind: 'public_field_definition' } })) {
		const name = field.field('name');
		if (name && (isMockValue(field.field('value')) || isMockType(field.field('type')))) mocks.add(`this.${name.text()}`);
	}
	for (const assignment of root.findAll({ rule: { kind: 'assignment_expression' } })) {
		const left = assignment.field('left');
		if (left && isMockValue(assignment.field('right'))) mocks.add(left.text());
	}
	return mocks;
}
