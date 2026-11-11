import type { SgNode } from '@codemod.com/jssg-types/main';
import { isShadowed } from './scope.ts';
import type { Source } from './source.ts';

export interface Context {
	source: Source;
	/** Local names `expect` is imported as. */
	expectNames: Set<string>;
	/** Local name of node:assert. */
	assert: string;
	/** Whether `assert` is node:assert's strict mode, where `equal()` is `strictEqual()`. */
	strict: boolean;
	/** Local name of node:util's `isDeepStrictEqual`. */
	isDeepStrictEqual: string;
	/** What the rewritten file needs to import. */
	needs: { assert: boolean; isDeepStrictEqual: boolean };
	/** Functions whose assertions stay on expect, as `[start, end]` byte ranges. */
	pinned: Array<[number, number]>;
	warn(node: SgNode, message: string): void;
}

/** Whether `node` is the file's `expect`, imported from the `expect` package. */
export const isExpect = (context: Context, node: SgNode | null | undefined): node is SgNode =>
	node?.kind() === 'identifier' && context.expectNames.has(node.text()) && !isShadowed(node);

export const isPinned = (context: Context, node: SgNode) => {
	const start = node.range().start.index;
	return context.pinned.some(([from, to]) => start >= from && start < to);
};
