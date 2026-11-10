const { describe, expect, it, jest } = require('@jest/globals');
const { sum } = require('./sum');

describe('sum', () => {
	it('sums', () => {
		const spy = jest.fn(sum);
		expect(spy(1, 2)).toBe(3);
	});
});
