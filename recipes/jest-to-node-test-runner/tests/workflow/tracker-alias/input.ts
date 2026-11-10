import { mock } from './fixtures.ts';

describe('module-level mock', () => {
	it('aliases node:test tracker', () => {
		const fn = jest.fn();
		fn(mock);
		expect(fn).toHaveBeenCalledWith(mock);
	});
});
