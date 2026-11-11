const { describe, it } = require('node:test');
const { expect } = require('expect');
const { sum } = require('./sum.js');

describe('sum', () => {
	it('adds', () => {
		expect(sum(1, 2)).toBe(3);
		expect([sum(1, 1)]).toContainEqual(2);
	});
});
