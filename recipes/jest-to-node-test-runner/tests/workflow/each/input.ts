enum Meal {
	Breakfast = 'breakfast',
	Lunch = 'lunch',
}

describe('each', () => {
	it.each(['2026-13-01', 'nope'])('should throw for %s', (value) => {
		expect(() => parse(value)).toThrow();
	});

	it.each([
		['08:00', Meal.Breakfast],
		['13:00', Meal.Lunch],
	])('at %s the next meal is %p', (time, meal) => {
		expect(nextMeal(time)).toBe(meal);
	});

	it.each([[1, 1, 2], [2, 2, 4]] as const)('adds %d + %d', (a, b, expected) => {
		expect(a + b).toBe(expected);
	});

	it.each(VALID_CODES)('should accept %s', async (code: string) => {
		await expect(validate(code)).resolves.toBe(true);
	});

	it.each(EDGES)('from %s to %s', (from, to) => {
		expect(canMove(from, to)).toBe(true);
	});

	it.each([
		['unchanged', {}],
		['renamed', { name: 'x' }],
	])('should leave it alone when %s', (_, overrides) => {
		expect(update(overrides)).toBeDefined();
	});

	it.each([
		{ a: 1, b: 2 },
		{ a: 3, b: 4 },
	])('$a and $b are 100% numbers', ({ a, b }) => {
		expect(typeof a + typeof b).toBe('numbernumber');
	});

	it.each([{ input: 'x' }])('with %j', (row) => {
		expect(row.input).toBe(`x`);
	});

	it.each([1, 2])('runs `%i` with a timeout', (n) => {
		expect(n).toBeGreaterThan(0);
	}, 1000);

	describe.each([
		['admin', true],
		['guest', false],
	])('as %s', (role, allowed) => {
		it('checks access', () => {
			const message = `
multi-line template
	keeps its content`;
			expect(canAccess(role)).toBe(allowed);
			expect(message).toContain('keeps');
		});

		it.each([['read'], ['write']])('can %s', (action) => {
			expect(can(role, action)).toBe(allowed);
		});
	});

	it.only.each([1])('only %s', (n) => {
		expect(n).toBe(1);
	});

	it.each([1, 2])('unsupported index %#', (n) => {
		expect(n).toBeTruthy();
	});
});
