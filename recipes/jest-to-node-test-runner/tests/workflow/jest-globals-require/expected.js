const { describe, it, mock } = require('node:test');
const { expect } = require('expect');
const { sum } = require('./sum');

describe('sum', () => {
	it('sums', () => {
		const spy = mock.fn(sum);
		expect(spy(1, 2)).toBe(3);
	});
});
