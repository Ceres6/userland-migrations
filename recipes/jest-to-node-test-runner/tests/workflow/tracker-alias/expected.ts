import { describe, it, mock as nodeMock } from 'node:test';
import { expect } from 'expect';
import { mock } from './fixtures.ts';

describe('module-level mock', () => {
	it('aliases node:test tracker', () => {
		const fn = nodeMock.fn<(...args: any[]) => any>();
		fn(mock);
		expect(fn.mock.calls.map((call) => call.arguments)).toContainEqual([mock]);
	});
});
