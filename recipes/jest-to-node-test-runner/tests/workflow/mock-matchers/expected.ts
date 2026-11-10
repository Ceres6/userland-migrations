import { describe, it, mock, type Mock } from 'node:test';
import { expect } from 'expect';

interface RoutePlanner {
	route(from: string, to: string): Promise<number>;
}

const planner = (): RoutePlanner => ({
	route: mock.fn(async () => 1),
});

class ServiceMock {
	private mockSave = mock.fn<(...args: any[]) => any>();

	assertSaved(value: string): void {
		expect(this.mockSave.mock.calls.map((call) => call.arguments)).toContainEqual([value]);
	}
}

describe('mock matchers', () => {
	it('asserts calls', () => {
		const fn = mock.fn((value: number) => value);
		fn(1);
		fn(2);

		expect(fn.mock.callCount()).toBeGreaterThan(0);
		expect(fn.mock.callCount()).toBe(0);
		expect(fn.mock.callCount()).toBe(2);
		expect(fn.mock.callCount()).not.toBe(3);
		expect(fn.mock.calls.map((call) => call.arguments)).toContainEqual([1]);
		expect(fn.mock.calls.map((call) => call.arguments)).toContainEqual([expect.any(Number)]);
		expect(fn.mock.calls.map((call) => call.arguments)).not.toContainEqual([3]);
		expect(fn.mock.calls.at(-1)?.arguments).toEqual([2]);
		expect(fn.mock.calls[0]?.arguments).toEqual([1]);
		expect(fn.mock.calls[index - 1]?.arguments).toEqual([1]);
		expect(fn.mock.calls.some((call) => call.error === undefined)).toBe(true);
		expect(fn.mock.calls.filter((call) => call.error === undefined)).toHaveLength(2);
		expect(fn.mock.calls.filter((call) => call.error === undefined).map((call) => call.result)).toContainEqual(2);
		expect(fn.mock.calls.at(-1)?.result).toEqual(2);
		expect(fn.mock.calls[1]?.result).toEqual(2);
		expect(fn).toBe(fn);
	});

	it('casts mocks typed after an interface', async () => {
		const routePlanner = planner();
		await routePlanner.route('a', 'b');
		expect((routePlanner.route as Mock<typeof routePlanner.route>).mock.calls.map((call) => call.arguments)).toContainEqual(['a', 'b']);
		expect(getMock().mock.callCount()).toBeGreaterThan(0);
	});
});
