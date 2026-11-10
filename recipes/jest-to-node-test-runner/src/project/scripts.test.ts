import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findJestCommands, replaceJestCommands } from './scripts.ts';

const replaced = (script: string) => replaceJestCommands(script, ({ args }) => `node --test ${args.join(' ')}`.trim());

describe('findJestCommands', () => {
	it('finds jest however it is run', () => {
		assert.equal(replaced('jest'), 'node --test');
		assert.equal(replaced('npx jest --ci'), 'node --test --ci');
		assert.equal(replaced('yarn jest'), 'node --test');
		assert.equal(replaced('pnpm exec jest'), 'node --test');
		assert.equal(replaced('node --experimental-vm-modules node_modules/jest/bin/jest.js'), 'node --test');
		assert.equal(replaced('node node_modules/.bin/jest -i'), 'node --test -i');
	});

	it('keeps environment variables and cross-env', () => {
		assert.equal(replaced('NODE_ENV=test jest --verbose'), 'NODE_ENV=test node --test --verbose');
		assert.equal(replaced('npx cross-env CI=1 jest'), 'npx cross-env CI=1 node --test');
	});

	it('only replaces the jest command of a list', () => {
		assert.equal(replaced('tsc && jest -c a.js; echo done'), 'tsc && node --test -c a.js; echo done');
		assert.equal(
			replaced('npm run start:background && npm run cy:run; npm run stop:background'),
			'npm run start:background && npm run cy:run; npm run stop:background',
		);
	});

	it('unquotes the arguments', () => {
		assert.deepEqual(findJestCommands(`jest -t 'my test' "src/a b"`)[0].args, ['-t', 'my test', 'src/a b']);
	});

	it('ignores commands that merely mention jest', () => {
		assert.deepEqual(findJestCommands('echo jest'), []);
		assert.deepEqual(findJestCommands('eslint --plugin jest .'), []);
	});
});
