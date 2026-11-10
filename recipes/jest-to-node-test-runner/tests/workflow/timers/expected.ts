import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { expect } from 'expect';

describe('timers', () => {
	beforeEach(() => {
		mock.timers.reset();
		mock.timers.enable({ now: Date.now() });
	});

	afterEach(() => {
		mock.timers.reset();
	});

	it('ticks', async () => {
		mock.timers.reset();
		mock.timers.enable({ now: new Date('2026-01-01') });
		mock.timers.setTime(Number(new Date('2026-02-01')));
		mock.timers.setTime(1000);
		mock.timers.tick(500);
		await mock.timers.tick(500);
		mock.timers.runAll();
		expect(Date.now()).toBe(2000);
		jest.runOnlyPendingTimers();
	});
});
