describe('timers', () => {
	beforeEach(() => {
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('ticks', async () => {
		jest.useFakeTimers({ now: new Date('2026-01-01') });
		jest.setSystemTime(new Date('2026-02-01'));
		jest.setSystemTime(1000);
		jest.advanceTimersByTime(500);
		await jest.advanceTimersByTimeAsync(500);
		jest.runAllTimers();
		expect(jest.now()).toBe(2000);
		jest.runOnlyPendingTimers();
	});
});
