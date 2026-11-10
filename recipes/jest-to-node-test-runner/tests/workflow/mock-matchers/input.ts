interface RoutePlanner {
	route(from: string, to: string): Promise<number>;
}

const planner = (): RoutePlanner => ({
	route: jest.fn(async () => 1),
});

class ServiceMock {
	private mockSave = jest.fn();

	assertSaved(value: string): void {
		expect(this.mockSave).toHaveBeenCalledWith(value);
	}
}

describe('mock matchers', () => {
	it('asserts calls', () => {
		const fn = jest.fn((value: number) => value);
		fn(1);
		fn(2);

		expect(fn).toHaveBeenCalled();
		expect(fn).not.toHaveBeenCalled();
		expect(fn).toHaveBeenCalledTimes(2);
		expect(fn).not.toHaveBeenCalledTimes(3);
		expect(fn).toHaveBeenCalledWith(1);
		expect(fn).toHaveBeenCalledWith(expect.any(Number));
		expect(fn).not.toHaveBeenCalledWith(3);
		expect(fn).toHaveBeenLastCalledWith(2);
		expect(fn).toHaveBeenNthCalledWith(1, 1);
		expect(fn).toHaveBeenNthCalledWith(index, 1);
		expect(fn).toHaveReturned();
		expect(fn).toHaveReturnedTimes(2);
		expect(fn).toHaveReturnedWith(2);
		expect(fn).toHaveLastReturnedWith(2);
		expect(fn).toHaveNthReturnedWith(2, 2);
		expect(fn).toBe(fn);
	});

	it('casts mocks typed after an interface', async () => {
		const routePlanner = planner();
		await routePlanner.route('a', 'b');
		expect(routePlanner.route).toHaveBeenCalledWith('a', 'b');
		expect(getMock()).toHaveBeenCalled();
	});
});
