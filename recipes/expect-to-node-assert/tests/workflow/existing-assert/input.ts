import assert from 'node:assert';
import { it } from 'node:test';
import { expect } from 'expect';

it('reuses node:assert, which is not in strict mode here', () => {
	assert.ok(true);
	expect(1).toBe(1);
	expect({ a: 1 }).toStrictEqual({ a: 1 });
	expect([1]).not.toStrictEqual([2]);
});
