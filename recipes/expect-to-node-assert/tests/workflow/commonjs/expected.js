const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');
const { sum } = require('./sum.js');

describe('sum', () => {
	it('adds', () => {
		assert.equal(sum(1, 2), 3);
		assert.ok([sum(1, 1)].some((item) => isDeepStrictEqual(item, 2)));
	});
});
