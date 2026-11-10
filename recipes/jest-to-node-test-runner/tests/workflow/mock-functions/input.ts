describe('mock functions', () => {
	it('creates and configures mocks', async () => {
		const untyped = jest.fn();
		const implemented = jest.fn((a: number, b: number) => a + b);
		const typed = jest.fn<number, [string]>();
		const returning = jest.fn().mockReturnValue(42);
		const resolving = jest.fn().mockResolvedValue([]);
		const named = jest.fn().mockName('named');

		untyped.mockReturnValue(1);
		untyped.mockReturnValue(createValue());
		untyped.mockResolvedValue('ok');
		untyped.mockRejectedValue(new Error('boom'));
		untyped.mockImplementation((value: number) => value * 2);
		untyped.mockReturnThis();
		untyped.mockClear();
		untyped.mockReset();
		untyped.mockRestore();
		untyped.mockName('untyped');
		untyped.mockReturnValue(1).mockName('chained');

		expect(implemented(1, 2)).toBe(3);
		expect(typed).toBeDefined();
		expect(returning()).toBe(42);
		await expect(resolving()).resolves.toStrictEqual([]);
		expect(named).toBeDefined();
	});
});
