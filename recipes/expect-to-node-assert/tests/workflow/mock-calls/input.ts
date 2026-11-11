import { it, mock } from 'node:test';
import { expect } from 'expect';

it('checks the calls', () => {
	const save = mock.fn<(...args: any[]) => any>();
	const id = 'abc';
	save(id, { force: true });

	expect(save.mock.calls.map((call) => call.arguments)).toContainEqual([id, { force: true }]);
	expect(save.mock.calls.map((call) => call.arguments)).not.toContainEqual(['other']);
	expect(save.mock.calls.at(-1)?.arguments).toEqual([id, { force: true }]);
	expect(save.mock.calls[0]?.arguments).toEqual([id, { force: true }]);
	expect(save.mock.callCount()).toBe(1);
	expect(save.mock.callCount()).toBeGreaterThan(0);
	expect(save.mock.calls.map((call) => call.result)).toContainEqual(undefined);
	expect(save.mock.calls.map((item) => item.arguments)).toContainEqual([item]);
	expect([[id]]).toContainEqual([id]);
	expect(save.mock.calls.map((call) => call.arguments)).toContainEqual([makeId()]);
});
