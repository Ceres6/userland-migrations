'use strict';

const { afterEach, describe, it, mock } = require('node:test');
const { expect } = require('expect');
const { sum } = require('./sum');

describe('sum', () => {
	afterEach(() => {
		mock.restoreAll();
	});

	it('sums', () => {
		const spy = mock.method(Math, 'max');
		expect(sum([1, 2])).toBe(3);
		expect(spy.mock.callCount()).toBe(0);
	});
});
