import { it } from 'node:test';
import assert from 'node:assert/strict';

it('works in JavaScript', async () => {
	assert.equal(await Promise.resolve(1), 1);
	assert.equal(typeof 1, 'number');
});
