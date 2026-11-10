describe('types', () => {
	let fn: jest.Mock<string, [number]>;
	let bare: jest.Mock;
	let typed: jest.MockedFunction<typeof format>;

	beforeEach(() => {
		fn = jest.fn();
		bare = jest.fn();
		typed = jest.fn(format);
	});

	it('works', () => {
		expect(fn).not.toHaveBeenCalled();
		expect(bare).not.toHaveBeenCalled();
		expect(typed).not.toHaveBeenCalled();
	});
});
