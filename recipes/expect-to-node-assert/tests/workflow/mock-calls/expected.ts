import { it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { expect } from 'expect';

it('checks the calls', () => {
	const save = mock.fn<(...args: any[]) => any>();
	const id = 'abc';
	save(id, { force: true });

	assert.ok(save.mock.calls.some((call) => isDeepStrictEqual(call.arguments, [id, { force: true }])));
	expect(save.mock.calls.map((call) => call.arguments)).not.toContainEqual(['other']);
	assert.deepEqual(save.mock.calls.at(-1)?.arguments, [id, { force: true }]);
	assert.deepEqual(save.mock.calls[0]?.arguments, [id, { force: true }]);
	assert.equal(save.mock.callCount(), 1);
	assert.ok(save.mock.callCount() > 0);
	assert.ok(save.mock.calls.some((call) => isDeepStrictEqual(call.result, undefined)));
	assert.ok(save.mock.calls.map((item) => item.arguments).some((element) => isDeepStrictEqual(element, [item])));
	assert.ok([[id]].some((item) => isDeepStrictEqual(item, [id])));
	expect(save.mock.calls.map((call) => call.arguments)).toContainEqual([makeId()]);
});
