// Header comment stays first
import { describe, it, mock } from 'node:test';
import { expect } from 'expect';
import { greet } from './greet.ts';

describe('greet', () => {
	it('logs', () => {
		const log = mock.fn<(message: string) => void>();
		greet('Ada', log);
		expect(log.mock.calls.map((call) => call.arguments)).toContainEqual(['Hello, Ada']);
	});
});
