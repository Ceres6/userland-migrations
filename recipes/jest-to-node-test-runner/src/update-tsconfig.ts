/// <reference types="@codemod.com/jssg-types/runtime" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { warn } from 'codemod:runtime';
import type { Edit, SgNode, SgRoot } from '@codemod.com/jssg-types/main';
import type Json from '@codemod.com/jssg-types/langs/json';

const JEST_TYPES = /^"(jest|@types\/jest)"$/;

/** The package.json the tsconfig belongs to. */
function packageJsonFor(file: string): { dependencies?: object; devDependencies?: object } | undefined {
	for (let directory = dirname(file); ; directory = dirname(directory)) {
		try {
			return JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
		} catch {
			if (dirname(directory) === directory) return undefined;
		}
	}
}

const elementsOf = (array: SgNode<Json>) => array.children().filter((child) => child.isNamed() && child.kind() !== 'comment');

/**
 * Removes jest's global types from `compilerOptions.types` (adding Node.js' ones, which node:test's come
 * with, if the list doesn't have them).
 */
export default async function transform(root: SgRoot<Json>): Promise<string | null> {
	const edits: Edit[] = [];

	for (const array of root.root().findAll({
		rule: {
			kind: 'array',
			inside: { kind: 'pair', has: { field: 'key', kind: 'string', regex: '^"types"$' } },
		},
	})) {
		const elements = elementsOf(array);
		const jest = elements.find((element) => JEST_TYPES.test(element.text()));
		if (!jest) continue;

		const pkg = packageJsonFor(root.filename());
		const dependencies = { ...pkg?.dependencies, ...pkg?.devDependencies };
		if ('jest' in dependencies || '@types/jest' in dependencies) {
			warn(`${root.relativeFilename()}: jest is still a dependency, its types were kept.`);
			return null;
		}

		if (!elements.some((element) => element.text() === '"node"')) {
			edits.push(jest.replace('"node"'));
			continue;
		}

		// Remove the element with the comma that separates it from its neighbour
		const index = elements.indexOf(jest);
		const next = elements[index + 1];
		const previous = elements[index - 1];
		const { start, end } = jest.range();
		if (next) {
			edits.push({ startPos: start.index, endPos: next.range().start.index, insertedText: '' });
		} else if (previous) {
			edits.push({ startPos: previous.range().end.index, endPos: end.index, insertedText: '' });
		} else {
			edits.push({ startPos: start.index, endPos: end.index, insertedText: '' });
		}
	}

	return edits.length ? root.root().commitEdits(edits) : null;
}
