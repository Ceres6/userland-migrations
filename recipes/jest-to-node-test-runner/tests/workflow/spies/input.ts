describe('spies', () => {
	it('spies on methods and accessors', () => {
		const logger = jest.spyOn(console, 'error').mockImplementation(() => undefined);
		const now = jest.spyOn(Date, 'now').mockReturnValue(0);
		const getter = jest.spyOn(config, 'value', 'get');
		const setter = jest.spyOn(config, 'value', 'set');
		jest.spyOn(service, 'delete').mockRejectedValueOnce(new Error('db down'));

		run();

		expect(console.error).toHaveBeenCalledWith('failed');
		expect(now).toHaveBeenCalledTimes(1);
		expect(getter).toHaveBeenCalled();
		expect(setter).not.toHaveBeenCalled();
		logger.mockRestore();
	});
});
