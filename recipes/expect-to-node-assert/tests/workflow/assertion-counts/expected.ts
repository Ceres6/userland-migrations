import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { expect } from 'expect';
import { load, Repository } from './repository.ts';

describe('assertion counts', () => {
	it('asserts directly', async () => {
		const item = await load();

		assert.equal(item.id, 1);
	});

	it('asserts through a helper', async () => {
		const repository = new Repository();
		await repository.save();

		repository.assertSaved();
	});

	it('asserts in a loop, after a direct assertion', () => {
		const items = [1, 2];
		assert.equal(items.length, 2);
		for (const item of items) assert.ok(item > 0);
	});

	it('asserts only conditionally', async () => {
		expect.hasAssertions();

		try {
			await load();
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
		}
	});

	it('returns before asserting', async () => {
		expect.hasAssertions();

		const item = await load();
		if (!item) return;

		expect(item.id).toBe(1);
	});

	it('asserts nothing itself', async () => {
		await new Repository().check();
	});

	it('counts exactly', () => {
		assert.equal(1, 1);
		assert.equal(2, 2);
	});

	it('counts conditional assertions', () => {
		expect.assertions(1);

		[1].forEach((value) => {
			expect(value).toBe(1);
		});
	});

	it('asserts for each item of a literal array', () => {
		['a', 'b'].forEach((value) => assert.equal(value.length, 1));
	});

	it('asserts in a loop over a literal array', () => {
		for (const value of ['a', 'b']) {
			assert.equal(value.length, 1);
		}
	});

	it('asserts in a loop that can skip its assertions', () => {
		expect.hasAssertions();

		for (const value of ['a', 'b']) {
			if (value === 'a') continue;
			expect(value).toHaveLength(1);
		}
	});

	it('asserts in finally', async () => {
		let error;
		try {
			await load();
		} catch (caught) {
			error = caught;
		} finally {
			assert.ok(error instanceof Error);
		}
	});
});
