/** jest's single-letter flags. */
const ALIASES: Record<string, string> = {
	b: 'bail',
	c: 'config',
	e: 'expand',
	i: 'runInBand',
	o: 'onlyChanged',
	t: 'testNamePattern',
	u: 'updateSnapshot',
	w: 'maxWorkers',
};

/** Flags taking a value, which may be the next word. */
const VALUE_FLAGS = new Set([
	'changedSince',
	'collectCoverageFrom',
	'config',
	'coverageDirectory',
	'coverageProvider',
	'coverageReporters',
	'env',
	'maxWorkers',
	'outputFile',
	'reporters',
	'rootDir',
	'roots',
	'seed',
	'selectProjects',
	'setupFiles',
	'setupFilesAfterEnv',
	'shard',
	'testEnvironment',
	'testMatch',
	'testNamePattern',
	'testPathIgnorePatterns',
	'testPathPattern',
	'testRegex',
	'testTimeout',
]);

/** Flags about jest's own output, caching or process handling: node --test needs nothing for them. */
const IGNORED = new Set([
	'cache',
	'ci',
	'colors',
	'detectOpenHandles',
	'errorOnDeprecated',
	'expand',
	'injectGlobals',
	'logHeapUsage',
	'noStackTrace',
	'passWithNoTests',
	'silent',
	'useStderr',
	'verbose',
	'watchman',
]);

export interface JestInvocation {
	/** `--config` value: a path, or inline JSON. */
	config?: string;
	coverage: boolean;
	/** node --test options. */
	options: string[];
}

/** Quotes a shell argument if it needs it (double quotes work in every shell npm runs scripts with). */
export const quote = (value: string) => (/^[\w./:=@%+,-]+$/.test(value) ? value : JSON.stringify(value));

/** Translates jest's command-line arguments (unquoted) to node --test options. */
export function translateArguments(args: string[], warn: (message: string) => void): JestInvocation {
	const invocation: JestInvocation = { coverage: false, options: [] };

	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (!arg.startsWith('-') || arg === '-' || arg === '--') {
			if (arg !== '--') warn(`jest's path pattern \`${arg}\` was dropped: pass the matching files or globs to node --test instead.`);
			continue;
		}

		const [rawName, inlineValue] = arg.replace(/^--?/, '').split(/=(.*)/s);
		let name = ALIASES[rawName] ?? rawName;
		let negated = false;
		if (name.startsWith('no-')) {
			negated = true;
			name = name.slice(3);
		}

		let value = inlineValue;
		if (value === undefined && VALUE_FLAGS.has(name) && index + 1 < args.length) value = args[++index];
		const enabled = !negated && value !== 'false';

		switch (name) {
			case 'config':
				invocation.config = value;
				break;
			case 'coverage':
			case 'collectCoverage':
				invocation.coverage = enabled;
				break;
			case 'runInBand':
				if (enabled) invocation.options.push('--test-concurrency=1');
				break;
			case 'maxWorkers':
				if (value && /^\d+$/.test(value)) invocation.options.push(`--test-concurrency=${value}`);
				else warn(`\`--maxWorkers=${value}\` has no node --test equivalent: use \`--test-concurrency=<number>\`.`);
				break;
			case 'testTimeout':
				invocation.options.push(`--test-timeout=${value}`);
				break;
			case 'testNamePattern':
				invocation.options.push(`--test-name-pattern=${quote(value ?? '')}`);
				break;
			case 'updateSnapshot':
				if (enabled) invocation.options.push('--test-update-snapshots');
				break;
			case 'watch':
			case 'watchAll':
				if (enabled) invocation.options.push('--watch');
				break;
			case 'forceExit':
				if (enabled) invocation.options.push('--test-force-exit');
				break;
			case 'shard':
				invocation.options.push(`--test-shard=${value}`);
				break;
			case 'randomize':
				if (enabled) invocation.options.push('--test-randomize');
				break;
			case 'seed':
				invocation.options.push(`--test-random-seed=${value}`);
				break;
			default:
				if (!IGNORED.has(name)) warn(`jest's \`${arg}\` has no node --test equivalent and was dropped.`);
		}
	}

	return invocation;
}
