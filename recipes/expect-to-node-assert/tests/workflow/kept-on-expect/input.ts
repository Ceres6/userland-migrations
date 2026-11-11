import { it } from 'node:test';
import { expect } from 'expect';
import { load, NotFound } from './load.ts';

it('keeps what node:assert would check less strictly', async () => {
	const error = NotFound;
	const pattern = /x/;
	expect(await load()).toStrictEqual({ id: expect.any(String), name: 'Ada' });
	expect(await load()).toEqual(expect.objectContaining({ name: 'Ada' }));
	expect(await load()).not.toEqual({ name: 'Bob' });
	expect('text').toMatch(pattern);
	expect(() => load()).toThrow(error);
	expect(() => load()).toThrow(`not ${'found'}`);
	expect(await load()).toHaveProperty('a.b');
	expect(await load()).toMatchInlineSnapshot();
	await expect(load()).rejects.toStrictEqual(new NotFound());
	await expect(load()).resolves.toThrow();
	expect(1).toBe(1);
	return expect(load()).resolves.toBe(1);
});
