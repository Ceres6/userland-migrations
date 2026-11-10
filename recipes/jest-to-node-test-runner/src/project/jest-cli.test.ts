import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { translateArguments } from './jest-cli.ts';

const translate = (args: string[]) => {
	const warnings: string[] = [];
	return { ...translateArguments(args, (message) => warnings.push(message)), warnings };
};

describe('translateArguments', () => {
	it('maps the options node --test has', () => {
		assert.deepEqual(
			translate(['-i', '--testTimeout=5000', '-t', 'my test', '-u', '--watch', '--forceExit', '--shard=1/3']).options,
			[
				'--test-concurrency=1',
				'--test-timeout=5000',
				'--test-name-pattern="my test"',
				'--test-update-snapshots',
				'--watch',
				'--test-force-exit',
				'--test-shard=1/3',
			],
		);
	});

	it('reads the configuration, inline or as next word', () => {
		assert.equal(translate(['--config=jest.config.integration.js']).config, 'jest.config.integration.js');
		assert.equal(translate(['-c', 'jest.e2e.js']).config, 'jest.e2e.js');
	});

	it('drops what only matters to jest, silently', () => {
		const { options, warnings } = translate(['--verbose', '--ci', '--no-cache', '--passWithNoTests']);
		assert.deepEqual(options, []);
		assert.deepEqual(warnings, []);
	});

	it('warns about what has no equivalent', () => {
		const { warnings } = translate(['--bail', 'src/users', '--maxWorkers=50%']);
		assert.equal(warnings.length, 3);
	});

	it('turns coverage on', () => {
		assert.equal(translate(['--coverage']).coverage, true);
		assert.equal(translate(['--coverage=false']).coverage, false);
	});
});
