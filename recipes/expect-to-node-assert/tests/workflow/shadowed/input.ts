import { it } from 'node:test';
import { expect } from 'expect';

const check = (expect: (value: number) => { toBe(value: number): void }) => expect(1).toBe(1);

it('migrates the imported expect only', () => {
	expect(check).toBeInstanceOf(Function);
});
