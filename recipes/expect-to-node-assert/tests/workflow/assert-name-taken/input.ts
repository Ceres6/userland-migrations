import { it } from 'node:test';
import { expect as check } from 'expect';

const isDeepStrictEqual = (a: unknown, b: unknown) => a === b;

it('avoids names the file uses', () => {
	const assert = (condition: boolean) => condition;
	check(assert(true)).toBe(true);
	check([1]).toContainEqual(1);
	check(isDeepStrictEqual(1, 1)).toBeTruthy();
});
