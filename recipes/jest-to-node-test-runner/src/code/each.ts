import type { Edit, SgNode } from '@codemod.com/jssg-types/main';
import {
	type Context,
	argumentsOf,
	isFunction,
	parameterPattern,
	parametersOf,
	references,
	testCallee,
} from './context.ts';

const unwrap = (node: SgNode): SgNode => {
	let current = node;
	while (['as_expression', 'satisfies_expression', 'parenthesized_expression', 'non_null_expression'].includes(current.kind() as string)) {
		const inner = current.children().find((child) => child.isNamed());
		if (!inner) break;
		current = inner;
	}
	return current;
};

const elementsOf = (array: SgNode) => array.children().filter((child) => child.isNamed() && child.kind() !== 'comment');

/**
 * Whether jest spreads each row into the callback's arguments: it does when every row is an array.
 * Undecidable for tables that aren't array literals, where the callback's arity tells.
 */
function rowsAreArgumentLists(table: SgNode, arity: number): boolean | null {
	const literal = unwrap(table);
	if (literal.kind() !== 'array') return arity > 1;
	const rows = elementsOf(literal);
	if (rows.length && rows.every((row) => row.kind() === 'array')) return true;
	if (rows.some((row) => row.kind() === 'array' || row.kind() === 'spread_element')) return null;
	return false;
}

/** jest's printf-style title placeholders (`%s`, `%p`…) and `$key` interpolation, as a template literal. */
function interpolateTitle(
	title: SgNode,
	positional: (index: number) => string | undefined,
	keyed: (path: string) => string | undefined,
): string | null {
	if (title.kind() !== 'string') {
		return title.kind() === 'template_string' && !/%|\$[A-Za-z_]/.test(title.text()) ? title.text() : null;
	}

	const raw = title.text();
	const quote = raw[0];
	const content = raw.slice(1, -1);
	let out = '';
	let index = 0;
	let changed = false;

	for (let position = 0; position < content.length; position++) {
		const char = content[position];
		const next = content[position + 1];

		if (char === '\\') {
			out += next === quote ? quote : `${char}${next ?? ''}`;
			position++;
		} else if (char === '%' && next === '%') {
			out += '%';
			position++;
			changed = true;
		} else if (char === '%' && next && 'sdifjoOp'.includes(next)) {
			const value = positional(index++);
			if (!value) return null;
			out += 'sdif'.includes(next) ? `\${${value}}` : `\${JSON.stringify(${value})}`;
			position++;
			changed = true;
		} else if (char === '%' && (next === '#' || next === '$')) {
			return null;
		} else if (char === '$' && /[A-Za-z_]/.test(next ?? '')) {
			const path = /^[A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)*/.exec(content.slice(position + 1))?.[0] ?? '';
			const value = keyed(path);
			if (value === undefined) {
				out += char;
				continue;
			}
			out += `\${${value}}`;
			position += path.length;
			changed = true;
		} else if (char === '`') {
			out += '\\`';
		} else if (char === '$' && next === '{') {
			out += '\\$';
		} else {
			out += char;
		}
	}

	return changed ? `\`${out}\`` : raw;
}

/**
 * `it.each(table)(title, fn)` → `for (const row of table) { it(title, fn) }`.
 *
 * Returns the edits for the outermost `.each` calls: nested ones are converted on the next round, once the
 * outer ones are loops.
 */
export function convertEach(root: SgNode, context: Context): Edit[] {
	const edits: Edit[] = [];
	const { source, indentUnit } = context;

	for (const statement of root.findAll({ rule: { kind: 'expression_statement' } })) {
		const call = statement.children()[0];
		if (call?.kind() !== 'call_expression') continue;

		const eachCall = call.field('function');
		if (eachCall?.kind() !== 'call_expression') continue;

		const callee = testCallee(eachCall.field('function'), context);
		if (!callee || callee.kind === 'hook' || callee.modifiers.at(-1) !== 'each') continue;

		const location = eachCall;
		const [table, ...extra] = argumentsOf(eachCall);
		if (!table || extra.length || eachCall.field('arguments')?.kind() === 'template_string') {
			context.warn(location, '`.each` with a tagged template table is not supported: convert it to a loop manually.');
			continue;
		}

		const [title, fn, timeout, ...rest] = argumentsOf(call);
		if (!title || !isFunction(fn) || rest.length) {
			context.warn(location, '`.each` without an inline callback is not supported: convert it to a loop manually.');
			continue;
		}

		const params = parametersOf(fn).map(parameterPattern);
		const spread = rowsAreArgumentLists(table, params.length);
		const isRest = params.some((param) => param.text.startsWith('...'));
		if (spread === null || (!spread && (params.length > 1 || isRest))) {
			context.warn(location, "Can't tell whether this `.each` table's rows are argument lists: convert it to a loop manually.");
			continue;
		}

		const usedInTitle = new Set<number>();
		const paramName = (index: number) => {
			const name = params[index]?.identifier;
			if (name) usedInTitle.add(index);
			return name;
		};
		// jest interpolates `$key` from object rows only
		const literalTable = unwrap(table);
		const objectRows =
			!spread &&
			(literalTable.kind() === 'array' ? elementsOf(literalTable).every((row) => row.kind() === 'object') : true);
		const rowName = objectRows ? params[0]?.identifier : undefined;
		const interpolated = interpolateTitle(
			title,
			(index) => (spread ? paramName(index) : index === 0 ? paramName(0) : undefined),
			(path) => {
				if (!objectRows) return undefined;
				if (rowName) return `${rowName}.${path}`;
				const [key] = path.split('.');
				return fn.find({ rule: { kind: 'shorthand_property_identifier_pattern', regex: `^${key}$` } }) ? path : undefined;
			},
		);
		if (interpolated === null) {
			context.warn(location, "This `.each` title's placeholders can't be mapped to the callback's parameters: convert it manually.");
			continue;
		}

		const body = fn.field('body');
		const isUsed = (index: number) =>
			usedInTitle.has(index) || !params[index]?.identifier || (body && references(body, params[index].identifier));

		let binding: string;
		if (spread) {
			const elements = params.map((param, index) => (isUsed(index) ? param.text : ''));
			while (elements.length && elements.at(-1) === '') elements.pop();
			binding = elements.length ? `[${elements.join(', ')}]` : '_row';
		} else {
			binding = params[0]?.text ?? '_row';
		}

		// Destructuring an array literal loses the tuple types jest's typings infer for each row
		const keepsTuples =
			context.isTypeScript &&
			spread &&
			literalTable === table &&
			table.kind() === 'array' &&
			elementsOf(table).every((row) => elementsOf(row).length > 0);
		const tableText = `${table.text()}${keepsTuples ? ' satisfies [unknown, ...unknown[]][]' : ''}`;

		const indent = source.lineIndent(statement.range().start.index);
		const fnRange = fn.range();
		const paramsNode = fn.field('parameters') ?? fn.field('parameter');
		const templates = fn.findAll({ rule: { kind: 'template_string' } });
		let fnText: string;
		if (paramsNode) {
			const paramsRange = paramsNode.range();
			fnText =
				source.indent(fnRange.start.index, paramsRange.start.index, indentUnit, templates) +
				'()' +
				source.indent(paramsRange.end.index, fnRange.end.index, indentUnit, templates);
		} else {
			fnText = source.indent(fnRange.start.index, fnRange.end.index, indentUnit, templates);
		}

		const baseCallee = [callee.base, ...callee.modifiers.slice(0, -1)].join('.');
		const options = timeout ? `{ timeout: ${timeout.text()} }, ` : '';

		edits.push(
			statement.replace(
				`for (const ${binding} of ${tableText}) {\n` +
					`${indent}${indentUnit}${baseCallee}(${interpolated}, ${options}${fnText});\n` +
					`${indent}}`,
			),
		);
	}

	return edits;
}
