import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('already node:test', () => {
	it('works', () => {
		assert.equal(1, 1);
	});
});
