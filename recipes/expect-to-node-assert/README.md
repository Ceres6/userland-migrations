---
authors: Ceres6
---

# Jest's expect to node:assert

Migrates assertions written with [Jest](https://jestjs.io/)'s standalone [`expect`](https://www.npmjs.com/package/expect) package to Node.js' built-in [`node:assert`](https://nodejs.org/api/assert.html), for example in test suites moved to the Node.js test runner with [`@nodejs/jest-to-node-test-runner`](https://github.com/nodejs/userland-migrations/tree/main/recipes/jest-to-node-test-runner). Matchers become the `node:assert` assertion that checks the same thing (`toStrictEqual()` becomes `assert.deepEqual()` in strict mode, `toThrow()` becomes `assert.throws()`, and so on), and `expect.hasAssertions()` goes where the test can't finish without asserting. Except for `toMatchObject()` (see the notes), every replacement checks at least what Jest did for the values its matcher accepts, so a test that passes after the migration would have passed before. What `node:assert` can't check as strictly stays on `expect`, with a warning. Once no file of a package uses `expect`, it's removed from `package.json`, together with the `expect.setup.mjs` file `@nodejs/jest-to-node-test-runner` adds and its `--import` in the scripts. Both CommonJS and ESM files are supported, in JavaScript and TypeScript.

## Usage

Run this codemod with:

```sh
npx codemod @nodejs/expect-to-node-assert
```

Then update the installed dependencies (e.g. `npm install`) and run the tests. The codemod prints a warning for everything it leaves on `expect`: review them before committing.

## Examples

### Values

```diff
 import { it } from 'node:test';
-import { expect } from 'expect';
+import assert from 'node:assert/strict';
 import { Member } from './member.ts';

 it('creates a member', () => {
-	expect.hasAssertions();
-
 	const member = new Member('Ada');
-	expect(member.name).toBe('Ada');
-	expect(member.toPrimitives()).toStrictEqual({ name: 'Ada' });
-	expect(member.tags).toHaveLength(1);
-	expect(member).toBeInstanceOf(Member);
-	expect(member.age).toBeGreaterThan(18);
+	assert.equal(member.name, 'Ada');
+	assert.deepEqual(member.toPrimitives(), { name: 'Ada' });
+	assert.equal(member.tags.length, 1);
+	assert.ok(member instanceof Member);
+	assert.ok(member.age > 18);
 });
```

### Errors and promises

`assert.throws()` would read a string as its own failure message, and would also match a regular expression against the error's name, so both go in `message`:

```diff
-expect(() => Member.find('nobody')).toThrow(MemberNotFound);
-expect(() => Member.find('nobody')).toThrow('not found');
-await expect(Member.load('nobody')).rejects.toThrow(MemberNotFound);
-await expect(Member.load('ada')).resolves.toStrictEqual(ada);
+assert.throws(() => Member.find('nobody'), MemberNotFound);
+assert.throws(() => Member.find('nobody'), { message: /not found/ });
+await assert.rejects(Member.load('nobody'), MemberNotFound);
+assert.deepEqual(await Member.load('ada'), ada);
```

### Mock calls

```diff
-expect(save.mock.calls.map((call) => call.arguments)).toContainEqual([id, { force: true }]);
+assert.ok(save.mock.calls.some((call) => isDeepStrictEqual(call.arguments, [id, { force: true }])));
```

## Notes

- `node:assert` is imported in strict mode (`node:assert/strict`), where `equal()` is `strictEqual()` and `deepEqual()` is `deepStrictEqual()`. A file that already imports `node:assert` keeps using it, with the strict methods' full names when it isn't in strict mode.
- `toEqual()` becomes `deepEqual()`, which also compares `undefined` properties and prototypes: a test comparing an instance with an object literal, or ignoring an `undefined` property, starts failing and needs its expected value fixed.
- `toMatchObject()` becomes `assert.partialDeepStrictEqual()`, which matches objects the same way but arrays less strictly: an expected array only needs its items to appear in order, so `['a', 'x', 'b']` matches `['a', 'b']` and any array matches `[]`, where Jest required exactly the expected items. Where a test relies on an array's exact contents, compare that array with `assert.deepEqual()` too.
- `not` forms without a `node:assert` function, `not.toMatchObject()` and `not.toThrow()` with an error to compare, become the positive assertion expected to fail: `assert.throws(() => assert.partialDeepStrictEqual(member, { name: 'Bob' }), assert.AssertionError)`. Only an `AssertionError` counts, so an error computing the values still fails the test, as it did with Jest. `not.toThrow()` with an error instance compares only its message, as Jest did.
- `not.toEqual()` and `not.toContainEqual()` stay on `expect`: their replacements compare more strictly than Jest's equality, so negated they would pass for values Jest considers equal. `not.toBeCloseTo()` stays too, as it would pass for two infinities, which Jest considers close.
- `toContain()` becomes `includes()`, which finds `NaN` (Jest's `toContain()` never did).
- `toThrow()` with an error class is recognised by its capitalised name (`MemberNotFound`, `errors.NotFound`). With an error instance, `assert.throws()` also compares its name and properties, not just its message.
- `expect.hasAssertions()` is removed when the test makes an assertion that is sure to run: one of its own statements before any early `return`, in a `finally` block or in a loop over a non-empty array literal, or a call to a helper named like an assertion (`assertSaved()`, `repository.expectNothingSaved()`). Tests whose assertions only run conditionally keep `expect.hasAssertions()` and their assertions on `expect`. `expect.assertions(n)` is only removed when the test has exactly `n` assertions that each run once.

### Limitations

- Asymmetric matchers (`expect.any()`, `expect.objectContaining()`, `expect.arrayContaining()`…), `not.toEqual()`, `not.toContainEqual()`, `not.toBeCloseTo()`, `rejects.not.toThrow()`, snapshot matchers, custom matchers and `toHaveProperty()` with a property path stay on `expect`.
- `toThrow()` and `toMatch()` with a variable stay on `expect`, as it could be a class, a message or an error (or a string or a regular expression). So do `toContainEqual()` with an argument that calls functions, which `some()` would call for every item, and `.resolves` assertions that aren't awaited.
- In TypeScript, `node:assert`'s replacements need the value's type to allow what they do. `expect()` accepted anything, so a value that may be `null` or `undefined` before `.includes()`, `.length` or `in` needs narrowing (or a `!`), and so does `toContain()` with a value outside the array's element type.
- Only imports of the `expect` package are migrated: Jest's global `expect` and `@jest/globals`' are left alone.
