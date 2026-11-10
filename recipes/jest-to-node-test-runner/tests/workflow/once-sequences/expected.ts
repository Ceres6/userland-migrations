import { describe, it, mock } from 'node:test';

describe('once', () => {
	it('queues one-off implementations like jest', () => {
		const fn = mock.fn<(...args: any[]) => any>();
		const other = mock.fn<(...args: any[]) => any>();
		fn.mock.mockImplementationOnce(() => 'a');
		other.mock.mockImplementationOnce(() => 'x');
		fn.mock.mockImplementationOnce(() => 'b', fn.mock.callCount() + 1);
		// a comment between registrations
		fn.mock.mockImplementationOnce(() => Promise.resolve('c'), fn.mock.callCount() + 2);
		fn.mock.mockImplementationOnce(() => Promise.reject(new Error('d')), fn.mock.callCount() + 3);
		fn.mock.mockImplementation(() => 'default');

		call(fn);

		fn.mock.mockImplementationOnce(() => 'later');
	});
});

class RepositoryMock {
	private mockGet = mock.fn<(...args: any[]) => any>();

	whenGetThenReturnOnce(value: unknown): void {
		this.mockGet.mock.mockImplementationOnce(() => value);
	}
}
