import { it } from 'node:test';
import nodeAssert from 'node:assert/strict';
import { isDeepStrictEqual as isDeepStrictEqualTo } from 'node:util';

const isDeepStrictEqual = (a: unknown, b: unknown) => a === b;

it('avoids names the file uses', () => {
	const assert = (condition: boolean) => condition;
	nodeAssert.equal(assert(true), true);
	nodeAssert.ok([1].some((item) => isDeepStrictEqualTo(item, 1)));
	nodeAssert.ok(isDeepStrictEqual(1, 1));
});
