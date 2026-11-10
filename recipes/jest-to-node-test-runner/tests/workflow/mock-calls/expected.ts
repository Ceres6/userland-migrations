import { describe, it, mock as nodeMock } from 'node:test';
import { expect } from 'expect';

describe('mock state', () => {
	it('reads calls and results', () => {
		const fn = nodeMock.fn((value: string) => value.length);
		fn('a');

		expect(fn.mock.calls[0]!.arguments[0]).toBe('a');
		expect(fn.mock.calls.map((call) => call.arguments)).toStrictEqual([['a']]);
		expect(fn.mock.calls.length).toBe(1);
		expect(fn.mock.calls.at(-1)?.arguments?.[0]).toBe('a');
		expect(fn.mock.calls.at(-1)?.arguments).toStrictEqual(['a']);
		const lengths = fn.mock.calls.map(({ arguments: [value] }) => value.length);
		const long = fn.mock.calls.map((call) => call.arguments).filter(([value]) => value.length > 1);
		expect(fn.mock.calls.map((call) => ({ type: call.error === undefined ? 'return' : 'throw', value: call.error === undefined ? call.result : call.error }))[0].value).toBe(1);
		expect(fn.mock.calls.map((call) => call.this)).toHaveLength(1);
		expect(lengths).toStrictEqual([1]);
		expect(long).toStrictEqual([]);

		const { mock } = fn;
		const last = mock.calls[mock.calls.length - 1]!.arguments[0];
		expect(last).toBe('a');

		const calls = fn.mock.calls.map((call) => call.arguments),
			first = calls[0][0];
		expect(first).toBe('a');
	});
});
