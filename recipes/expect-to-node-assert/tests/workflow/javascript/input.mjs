import { it } from 'node:test';
import { expect } from 'expect';

it('works in JavaScript', async () => {
	expect.hasAssertions();
	await expect(Promise.resolve(1)).resolves.toBe(1);
	expect(typeof 1).toBe('number');
});
