import { after, before, describe, it, test } from 'node:test';
import { expect } from 'expect';
import { add } from './math.ts';

describe('add', () => {
	before(() => {
		expect.hasAssertions();
	});

	after(() => {});

	it('adds', () => {
		expect(add(1, 2)).toBe(3);
	});

	test.skip('skipped', () => {});
});
