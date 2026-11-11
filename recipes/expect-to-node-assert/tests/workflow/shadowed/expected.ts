import { it } from 'node:test';
import assert from 'node:assert/strict';

const check = (expect: (value: number) => { toBe(value: number): void }) => expect(1).toBe(1);

it('migrates the imported expect only', () => {
	assert.ok(check instanceof Function);
});
