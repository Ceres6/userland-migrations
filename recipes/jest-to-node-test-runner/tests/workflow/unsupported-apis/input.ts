jest.mock('./database.ts');
jest.setTimeout(30000);

describe('unsupported', () => {
	it('keeps what has no equivalent', () => {
		const actual = jest.requireActual('./database.ts');
		const fn = jest.fn();
		fn.withImplementation(() => 1, () => {});
		expect(actual).toBeDefined();
		expect(() => fail()).toThrowErrorMatchingSnapshot();
	});
});
