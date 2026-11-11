import assert from 'node:assert';
import { it } from 'node:test';

it('reuses node:assert, which is not in strict mode here', () => {
	assert.ok(true);
	assert.strictEqual(1, 1);
	assert.deepStrictEqual({ a: 1 }, { a: 1 });
	assert.notDeepStrictEqual([1], [2]);
});
