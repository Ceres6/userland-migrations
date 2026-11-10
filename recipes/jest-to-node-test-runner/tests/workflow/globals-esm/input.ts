import { add } from './math.ts';

describe('add', () => {
	beforeAll(() => {
		expect.hasAssertions();
	});

	afterAll(() => {});

	it('adds', () => {
		expect(add(1, 2)).toBe(3);
	});

	test.skip('skipped', () => {});
});
