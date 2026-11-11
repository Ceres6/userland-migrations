import { describe, it } from 'node:test';
import { expect } from 'expect';
import { load, Repository } from './repository.ts';

describe('assertion counts', () => {
	it('asserts directly', async () => {
		expect.hasAssertions();

		const item = await load();

		expect(item.id).toBe(1);
	});

	it('asserts through a helper', async () => {
		expect.hasAssertions();

		const repository = new Repository();
		await repository.save();

		repository.assertSaved();
	});

	it('asserts in a loop, after a direct assertion', () => {
		expect.hasAssertions();

		const items = [1, 2];
		expect(items).toHaveLength(2);
		for (const item of items) expect(item).toBeGreaterThan(0);
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
		expect.hasAssertions();

		await new Repository().check();
	});

	it('counts exactly', () => {
		expect.assertions(2);

		expect(1).toBe(1);
		expect(2).toBe(2);
	});

	it('counts conditional assertions', () => {
		expect.assertions(1);

		[1].forEach((value) => {
			expect(value).toBe(1);
		});
	});

	it('asserts for each item of a literal array', () => {
		expect.hasAssertions();

		['a', 'b'].forEach((value) => expect(value).toHaveLength(1));
	});

	it('asserts in a loop over a literal array', () => {
		expect.hasAssertions();

		for (const value of ['a', 'b']) {
			expect(value).toHaveLength(1);
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
		expect.hasAssertions();

		let error;
		try {
			await load();
		} catch (caught) {
			error = caught;
		} finally {
			expect(error).toBeInstanceOf(Error);
		}
	});
});
