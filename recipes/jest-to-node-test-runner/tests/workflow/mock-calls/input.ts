describe('mock state', () => {
	it('reads calls and results', () => {
		const fn = jest.fn((value: string) => value.length);
		fn('a');

		expect(fn.mock.calls[0][0]).toBe('a');
		expect(fn.mock.calls).toStrictEqual([['a']]);
		expect(fn.mock.calls.length).toBe(1);
		expect(fn.mock.calls.at(-1)?.[0]).toBe('a');
		expect(fn.mock.lastCall).toStrictEqual(['a']);
		const lengths = fn.mock.calls.map(([value]) => value.length);
		const long = fn.mock.calls.filter(([value]) => value.length > 1);
		expect(fn.mock.results[0].value).toBe(1);
		expect(fn.mock.contexts).toHaveLength(1);
		expect(lengths).toStrictEqual([1]);
		expect(long).toStrictEqual([]);

		const { mock } = fn;
		const last = mock.calls[mock.calls.length - 1][0];
		expect(last).toBe('a');

		const { calls } = fn.mock,
			first = calls[0][0];
		expect(first).toBe('a');
	});
});
