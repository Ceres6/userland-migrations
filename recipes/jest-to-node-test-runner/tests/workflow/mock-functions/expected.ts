import { describe, it, mock } from 'node:test';
import { expect } from 'expect';

describe('mock functions', () => {
	it('creates and configures mocks', async () => {
		const untyped = mock.fn<(...args: any[]) => any>();
		const implemented = mock.fn((a: number, b: number) => a + b);
		const typed = mock.fn<(...args: [string]) => number>();
		const returning = mock.fn<(...args: any[]) => any>(() => 42);
		const resolving = mock.fn<(...args: any[]) => any>(() => Promise.resolve([]));
		const named = mock.fn<(...args: any[]) => any>();

		untyped.mock.mockImplementation(() => 1);
		const returnValue = createValue();
		untyped.mock.mockImplementation(() => returnValue);
		untyped.mock.mockImplementation(() => Promise.resolve('ok'));
		untyped.mock.mockImplementation(() => Promise.reject(new Error('boom')));
		untyped.mock.mockImplementation((value: number) => value * 2);
		untyped.mock.mockImplementation(function (this: unknown) { return this; });
		untyped.mock.resetCalls();
		untyped.mock.resetCalls();
		untyped.mock.mockImplementation(() => undefined);
		untyped.mock.restore();
		untyped.mock.mockImplementation(() => 1);

		expect(implemented(1, 2)).toBe(3);
		expect(typed).toBeDefined();
		expect(returning()).toBe(42);
		await expect(resolving()).resolves.toStrictEqual([]);
		expect(named).toBeDefined();
	});
});
