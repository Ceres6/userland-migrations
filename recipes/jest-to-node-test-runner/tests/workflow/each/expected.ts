import { describe, it } from 'node:test';
import { expect } from 'expect';

enum Meal {
	Breakfast = 'breakfast',
	Lunch = 'lunch',
}

describe('each', () => {
	for (const value of ['2026-13-01', 'nope']) {
		it(`should throw for ${value}`, () => {
			expect(() => parse(value)).toThrow();
		});
	}

	for (const [time, meal] of [
		['08:00', Meal.Breakfast],
		['13:00', Meal.Lunch],
	] satisfies [unknown, ...unknown[]][]) {
		it(`at ${time} the next meal is ${JSON.stringify(meal)}`, () => {
			expect(nextMeal(time)).toBe(meal);
		});
	}

	for (const [a, b, expected] of [[1, 1, 2], [2, 2, 4]] as const) {
		it(`adds ${a} + ${b}`, () => {
			expect(a + b).toBe(expected);
		});
	}

	for (const code of VALID_CODES) {
		it(`should accept ${code}`, async () => {
			await expect(validate(code)).resolves.toBe(true);
		});
	}

	for (const [from, to] of EDGES) {
		it(`from ${from} to ${to}`, () => {
			expect(canMove(from, to)).toBe(true);
		});
	}

	for (const [_, overrides] of [
		['unchanged', {}],
		['renamed', { name: 'x' }],
	] satisfies [unknown, ...unknown[]][]) {
		it(`should leave it alone when ${_}`, () => {
			expect(update(overrides)).toBeDefined();
		});
	}

	for (const { a, b } of [
		{ a: 1, b: 2 },
		{ a: 3, b: 4 },
	]) {
		it(`${a} and ${b} are 100% numbers`, () => {
			expect(typeof a + typeof b).toBe('numbernumber');
		});
	}

	for (const row of [{ input: 'x' }]) {
		it(`with ${JSON.stringify(row)}`, () => {
			expect(row.input).toBe(`x`);
		});
	}

	for (const n of [1, 2]) {
		it(`runs \`${n}\` with a timeout`, { timeout: 1000 }, () => {
			expect(n).toBeGreaterThan(0);
		});
	}

	for (const [role, allowed] of [
		['admin', true],
		['guest', false],
	] satisfies [unknown, ...unknown[]][]) {
		describe(`as ${role}`, () => {
			it('checks access', () => {
				const message = `
multi-line template
	keeps its content`;
				expect(canAccess(role)).toBe(allowed);
				expect(message).toContain('keeps');
			});

			for (const [action] of [['read'], ['write']] satisfies [unknown, ...unknown[]][]) {
				it(`can ${action}`, () => {
					expect(can(role, action)).toBe(allowed);
				});
			}
		});
	}

	for (const n of [1]) {
		it.only(`only ${n}`, () => {
			expect(n).toBe(1);
		});
	}

	it.each([1, 2])('unsupported index %#', (n) => {
		expect(n).toBeTruthy();
	});
});
