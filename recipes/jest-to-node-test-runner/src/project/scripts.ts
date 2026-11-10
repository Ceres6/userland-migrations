import astGrep from 'codemod:ast-grep';
import type { SgNode } from '@codemod.com/jssg-types/main';
import { Source } from '../code/source.ts';

/** A jest invocation inside a package.json script. */
export interface JestCommand {
	/** Byte offsets of the part to replace: the runner (`npx jest`, `node …/jest.js`) and its arguments. */
	start: number;
	end: number;
	/** jest's arguments, unquoted. */
	args: string[];
}

const RUNNERS = new Set(['bun', 'bunx', 'npm', 'npx', 'pnpm', 'pnpx', 'yarn']);
const RUNNER_WORDS = new Set(['--', 'exec', 'run']);

const isJestBinary = (word: string) =>
	word === 'jest' || /(^|\/)node_modules\/(\.bin\/jest|jest\/bin\/jest(\.js)?)$/.test(word);

const isAssignment = (word: string) => /^[A-Za-z_]\w*=/.test(word);

function unquote(node: SgNode): string {
	if (node.kind() === 'command_name') return unquote(node.children()[0] ?? node);
	if (node.kind() === 'raw_string') return node.text().slice(1, -1);
	if (node.kind() === 'string') {
		return node
			.children()
			.filter((child) => child.isNamed())
			.map((child) => child.text())
			.join('');
	}
	return node.text();
}

/**
 * Finds the jest invocations in a script: `jest`, `npx jest`, `yarn jest`, `node node_modules/.bin/jest`,
 * `cross-env CI=1 jest`… Environment assignments and `cross-env` stay in place.
 */
export function findJestCommands(script: string): JestCommand[] {
	const commands: JestCommand[] = [];

	for (const command of astGrep.parse('bash', script).root().findAll({ rule: { kind: 'command' } })) {
		const words = command.children().filter((child) => child.kind() !== 'variable_assignment' && child.isNamed());
		const texts = words.map(unquote);
		const jest = texts.findIndex(isJestBinary);
		if (jest === -1) continue;

		const before = texts.slice(0, jest);
		const crossEnv = before.indexOf('cross-env');
		const runnable = before.every(
			(word, index) =>
				RUNNERS.has(word) ||
				RUNNER_WORDS.has(word) ||
				word === 'node' ||
				word === 'cross-env' ||
				// node's or the runner's flags, and cross-env's variables
				word.startsWith('-') ||
				(crossEnv !== -1 && index > crossEnv && isAssignment(word)),
		);
		if (!runnable) continue;

		const first = crossEnv === -1 ? 0 : jest;
		commands.push({
			start: words[first].range().start.index,
			end: command.range().end.index,
			args: texts.slice(jest + 1),
		});
	}

	return commands;
}

/** Replaces each jest invocation in `script` with what `replace` returns for it. */
export function replaceJestCommands(script: string, replace: (command: JestCommand) => string): string {
	const source = new Source(script);
	let out = '';
	let position = 0;
	for (const command of findJestCommands(script).sort((a, b) => a.start - b.start)) {
		out += source.slice(position, command.start) + replace(command);
		position = command.end;
	}
	return out + source.slice(position, source.bytes.length);
}
