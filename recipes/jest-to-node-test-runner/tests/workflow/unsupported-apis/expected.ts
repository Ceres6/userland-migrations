import { describe, it, mock } from 'node:test';
import { expect } from 'expect';

jest.mock('./database.ts');
jest.setTimeout(30000);

describe('unsupported', () => {
	it('keeps what has no equivalent', () => {
		const actual = jest.requireActual('./database.ts');
		const fn = mock.fn<(...args: any[]) => any>();
		fn.withImplementation(() => 1, () => {});
		expect(actual).toBeDefined();
		expect(() => fail()).toThrowErrorMatchingSnapshot();
	});
});
