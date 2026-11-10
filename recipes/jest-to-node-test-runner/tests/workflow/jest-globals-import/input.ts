// Header comment stays first
import { describe, expect, it, jest } from '@jest/globals';
import { greet } from './greet.ts';

describe('greet', () => {
	it('logs', () => {
		const log = jest.fn<(message: string) => void>();
		greet('Ada', log);
		expect(log).toHaveBeenCalledWith('Hello, Ada');
	});
});
