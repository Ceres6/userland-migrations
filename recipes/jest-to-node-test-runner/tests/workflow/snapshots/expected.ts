import { describe, it } from 'node:test';
import { expect } from 'expect';

describe('snapshots', () => {
	it('matches', (t) => {
		t.assert.snapshot(render());
	});

	it('matches inline', async (t) => {
		t.assert.snapshot(await load());
	});

	it('with property matchers', (t) => {
		expect(render()).toMatchSnapshot({ id: expect.any(String) });
	});
});
