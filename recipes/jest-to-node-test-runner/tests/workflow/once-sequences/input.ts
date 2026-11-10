describe('once', () => {
	it('queues one-off implementations like jest', () => {
		const fn = jest.fn();
		const other = jest.fn();
		fn.mockReturnValueOnce('a');
		other.mockReturnValueOnce('x');
		fn.mockReturnValueOnce('b');
		// a comment between registrations
		fn.mockResolvedValueOnce('c').mockRejectedValueOnce(new Error('d'));
		fn.mockReturnValue('default');

		call(fn);

		fn.mockImplementationOnce(() => 'later');
	});
});

class RepositoryMock {
	private mockGet = jest.fn();

	whenGetThenReturnOnce(value: unknown): void {
		this.mockGet.mockReturnValueOnce(value);
	}
}
