---
authors: Ceres6
---

# Jest to Node.js Test Runner

Migrates [Jest](https://jestjs.io/) 30 test suites to the built-in [Node.js test runner](https://nodejs.org/api/test.html) (`node:test`), keeping Jest's assertions through the standalone [`expect`](https://www.npmjs.com/package/expect) package. Test files import `describe`, `it`, the hooks and `mock` from `node:test`; `jest.fn()`, `jest.spyOn()` and mock configuration (`mockReturnValue()`, `mockResolvedValueOnce()`…) become `node:test` mocks; mock matchers such as `toHaveBeenCalledWith()` become assertions on the mock's recorded calls; `.each` tables become loops; fake timers, `done` callbacks, timeouts and snapshots are translated too. In `package.json`, scripts running `jest` run `node --test` with the equivalent options (test globs, setup files, timeout, concurrency, coverage), Jest's configuration is removed and its tooling is replaced with `expect` (and [`tsx`](https://tsx.is/) when the tests need more TypeScript than Node.js strips). `jest` is replaced with `node` in `tsconfig.json`'s `types`. Both CommonJS and ESM files are supported, in JavaScript and TypeScript.

## Usage

Run this codemod with:

```sh
npx codemod @nodejs/jest-to-node-test-runner
```

Then install the updated dependencies (e.g. `npm install`) and run the tests. The codemod prints a warning for everything it can't migrate: review them before committing.

To move the assertions to `node:assert` too, run [`@nodejs/expect-to-node-assert`](https://github.com/nodejs/userland-migrations/tree/main/recipes/expect-to-node-assert) next.

## Examples

### Globals and mocks

```diff
+import { describe, it, mock } from 'node:test';
+import { expect } from 'expect';
 import { greet } from './greet.ts';

 describe('greet', () => {
 	it('logs', () => {
-		const log = jest.fn();
+		const log = mock.fn<(...args: any[]) => any>();
 		greet('Ada', log);
-		expect(log).toHaveBeenCalledWith('Hello, Ada');
+		expect(log.mock.calls.map((call) => call.arguments)).toContainEqual(['Hello, Ada']);
 	});
 });
```

Untyped `jest.fn()` mocks accept any implementation later on, so in TypeScript they become `mock.fn<(...args: any[]) => any>()`; `jest.fn(implementation)` stays typed after its implementation.

### Mock configuration

```diff
-const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
-const repository = { search: jest.fn().mockResolvedValue([]) };
+const spy = mock.method(console, 'error', () => undefined);
+const repository = { search: mock.fn<(...args: any[]) => any>(() => Promise.resolve([])) };

-fn.mockReturnValue(createValue());
-fn.mockRejectedValue(new Error('boom'));
-fn.mockClear();
-fn.mockReset();
+const returnValue = createValue();
+fn.mock.mockImplementation(() => returnValue);
+fn.mock.mockImplementation(() => Promise.reject(new Error('boom')));
+fn.mock.resetCalls();
+fn.mock.resetCalls();
+fn.mock.mockImplementation(() => undefined);
```

Values Jest evaluated once (`mockReturnValue(createValue())`) are hoisted so they still are.

### One-off implementations

Jest queues `*Once()` implementations; `node:test`'s `mockImplementationOnce()` targets a call index instead, so consecutive registrations get explicit indexes:

```diff
-fn.mockReturnValueOnce('a');
-fn.mockReturnValueOnce('b');
-fn.mockReturnValue('default');
+fn.mock.mockImplementationOnce(() => 'a');
+fn.mock.mockImplementationOnce(() => 'b', fn.mock.callCount() + 1);
+fn.mock.mockImplementation(() => 'default');
```

### Mock matchers and recorded calls

```diff
-expect(fn).not.toHaveBeenCalled();
-expect(fn).toHaveBeenCalledTimes(2);
-expect(fn).toHaveBeenLastCalledWith(2);
-expect(fn).toHaveBeenNthCalledWith(1, 1);
-expect(fn.mock.calls[0][0]).toBe('a');
-const lengths = fn.mock.calls.map(([value]) => value.length);
+expect(fn.mock.callCount()).toBe(0);
+expect(fn.mock.callCount()).toBe(2);
+expect(fn.mock.calls.at(-1)?.arguments).toEqual([2]);
+expect(fn.mock.calls[0]?.arguments).toEqual([1]);
+expect(fn.mock.calls[0]!.arguments[0]).toBe('a');
+const lengths = fn.mock.calls.map(({ arguments: [value] }) => value.length);
```

Mock matchers compare with `toEqual()`'s equality, as Jest did, so asymmetric matchers (`expect.any(Number)`…) keep working.

### `.each` tables

```diff
-it.each([
+for (const [time, meal] of [
 	['08:00', Meal.Breakfast],
 	['13:00', Meal.Lunch],
-])('at %s the next meal is %p', (time, meal) => {
-	expect(nextMeal(time)).toBe(meal);
-});
+] satisfies [unknown, ...unknown[]][]) {
+	it(`at ${time} the next meal is ${JSON.stringify(meal)}`, () => {
+		expect(nextMeal(time)).toBe(meal);
+	});
+}
```

In TypeScript, `satisfies` keeps the tuple types Jest's typings inferred for each row.

### Hooks, `done` callbacks and timeouts

```diff
-beforeAll((done) => {
+before((t, done) => {
 	connect(done);
-}, 20_000);
+}, { timeout: 20_000 });

-it('takes long', async () => {
+it('takes long', { timeout: 10000 }, async () => {
 	await slow();
-}, 10000);
+});
```

### Fake timers and snapshots

```diff
-jest.useFakeTimers();
-jest.advanceTimersByTime(500);
-jest.useRealTimers();
+mock.timers.reset();
+mock.timers.enable({ now: Date.now() });
+mock.timers.tick(500);
+mock.timers.reset();

-it('matches', () => {
-	expect(render()).toMatchSnapshot();
+it('matches', (t) => {
+	t.assert.snapshot(render());
 });
```

### `package.json`

```diff
 "scripts": {
-  "test": "NODE_ENV=test jest --runInBand"
+  "test": "NODE_ENV=test node --import tsx --test --test-timeout=20000 --test-concurrency=1 \"src/**/*.test.ts\""
 },
-"jest": { "testMatch": ["<rootDir>/src/**/*.test.ts"], "testTimeout": 20000 },
 "devDependencies": {
-  "@types/jest": "^30.0.0",
-  "jest": "^30.2.0",
-  "ts-jest": "^29.4.0",
+  "expect": "^30.2.0",
+  "tsx": "^4.21.0",
   "typescript": "^6.0.0"
 }
```

## Notes

- Jest's configuration is evaluated with your Node.js (as Jest did), from `--config`, a `jest.config.*` file or `package.json`'s `jest` key. The configuration files used are deleted; other `jest.config.*` files are reported.
- Jest checked `expect.assertions()` and `expect.hasAssertions()` after each test. When the tests use them, the codemod writes `expect.setup.mjs`, whose hooks do the same, and imports it in every test process.
- TypeScript tests run through Node.js' type stripping when `tsconfig.json` enables `erasableSyntaxOnly`, and through `tsx` otherwise (enums, parameter properties and JSX need it).
- Test files are found by Jest's own detection: files using Cypress' `cy` and files importing another test framework are left alone.
- `jest.restoreAllMocks()` becomes `mock.restoreAll()`, which also restores `mock.fn()` implementations (Jest only restored spies).
- `node:test` records each call as `{ arguments, result, error, this }`: accesses to Jest's `mock.calls`, `mock.lastCall`, `mock.results` and `mock.contexts` are rewritten to read them. Unlike Jest's, the array `mock.calls` returns is a copy.

### Limitations

- `jest.mock()` and the module registry APIs (`requireActual()`, `isolateModules()`…) are left in place: `node:test`'s `mock.module()` isn't hoisted above imports and needs `--experimental-test-module-mocks`.
- `testPathIgnorePatterns`, `testRegex` and negated `testMatch` patterns can't be expressed as `node --test` globs: narrow the globs (or rename the ignored files) by hand. `moduleNameMapper`, non-`node` test environments, `globalSetup`, `projects`, custom reporters and `clearMocks`/`resetMocks`/`restoreMocks` are reported, not migrated.
- `*Once()` registrations made in helpers (outside a test) can't be ordered statically: if a helper runs several times before the mock is called, only the last registration applies. Pass `onCall` explicitly there; the codemod warns about each.
- Libraries built on Jest's mocks or globals (`jest-when`, `jest-extended`, `@testing-library/jest-dom`…) are reported, not migrated.
- `.each` tables written as tagged templates, or whose titles use `%#`, and `it.failing()` are left in place.
- Inline snapshots move to `node:test`'s snapshot files: run the tests once with `--test-update-snapshots` to write them. Snapshots with property matchers are left in place.
- `jest.runOnlyPendingTimers()`, `jest.clearAllTimers()` and the other timer APIs without a `mock.timers` counterpart are left in place; the async variants that are migrated run the timers synchronously.
- With `noUncheckedIndexedAccess`, indexing arrays derived from `mock.calls` may need a `!`: Jest typed untyped mocks' calls as `any`.
