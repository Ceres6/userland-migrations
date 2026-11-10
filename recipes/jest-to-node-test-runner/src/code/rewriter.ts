import type { SgNode } from '@codemod.com/jssg-types/main';
import type { Source } from './source.ts';

/** Returned by a rule to drop a statement, together with the whitespace before it. */
export const REMOVE = Symbol('remove');

export type Rewrite = (node: SgNode) => string;

export type Splice = (node: SgNode, override?: (child: SgNode) => string | undefined) => string;

/**
 * Rewrites `node` (or returns `undefined` to leave it to the other rules). It gets the helpers to build its
 * output from rewritten children, so nested matches (a `jest.fn()` inside a matcher's arguments) are handled
 * in the same traversal and no output is ever matched twice.
 */
export type Rule = (node: SgNode, helpers: { rewrite: Rewrite; splice: Splice }) => string | typeof REMOVE | undefined;

const STATEMENT_LISTS = new Set(['program', 'statement_block', 'class_body', 'switch_case', 'switch_default']);

/**
 * A single top-down traversal that copies the source, letting `rules` replace the nodes they match.
 */
export function createRewriter(source: Source, rules: Rule[]) {
	const splice: Splice = (node, override) => {
		const children = node.children();
		if (!children.length) return node.text();

		const { start, end } = node.range();
		const dropsStatements = STATEMENT_LISTS.has(node.kind() as string);
		let out = '';
		let position = start.index;

		for (const child of children) {
			const range = child.range();
			const gap = source.slice(position, range.start.index);
			const replacement = override?.(child) ?? apply(child);

			if (replacement === REMOVE && dropsStatements) {
				// Drop the statement's line: the indentation and line break before it go too
				const lineBreak = gap.lastIndexOf('\n');
				out += lineBreak === -1 ? gap : gap.slice(0, lineBreak);
			} else {
				out += gap + (replacement === REMOVE ? source.slice(range.start.index, range.end.index) : replacement);
			}
			position = range.end.index;
		}

		return out + source.slice(position, end.index);
	};

	const apply = (node: SgNode): string | typeof REMOVE => {
		for (const rule of rules) {
			const out = rule(node, { rewrite, splice });
			if (out !== undefined) return out;
		}
		return splice(node);
	};

	const rewrite: Rewrite = (node) => {
		const out = apply(node);
		return out === REMOVE ? '' : out;
	};

	return (root: SgNode) => {
		const { start, end } = root.range();
		return source.slice(0, start.index) + rewrite(root) + source.slice(end.index, source.bytes.length);
	};
}
