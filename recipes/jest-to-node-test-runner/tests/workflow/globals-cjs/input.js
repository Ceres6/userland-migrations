'use strict';

const { sum } = require('./sum');

describe('sum', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('sums', () => {
		const spy = jest.spyOn(Math, 'max');
		expect(sum([1, 2])).toBe(3);
		expect(spy).not.toHaveBeenCalled();
	});
});
