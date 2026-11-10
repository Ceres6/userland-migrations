import { describe, it, mock, type Mock } from 'node:test';
import { expect } from 'expect';

describe('spies', () => {
	it('spies on methods and accessors', () => {
		const logger = mock.method(console, 'error', () => undefined);
		const now = mock.method(Date, 'now', () => 0);
		const getter = mock.getter(config, 'value');
		const setter = mock.setter(config, 'value');
		mock.method(service, 'delete').mock.mockImplementationOnce(() => Promise.reject(new Error('db down')));

		run();

		expect((console.error as Mock<typeof console.error>).mock.calls.map((call) => call.arguments)).toContainEqual(['failed']);
		expect(now.mock.callCount()).toBe(1);
		expect(getter.mock.callCount()).toBeGreaterThan(0);
		expect(setter.mock.callCount()).toBe(0);
		logger.mock.restore();
	});
});
