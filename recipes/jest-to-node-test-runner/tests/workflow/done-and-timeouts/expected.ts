import { afterEach, before, describe, it } from 'node:test';

describe('callbacks and timeouts', () => {
	before((t, done) => {
		connect(done);
	}, { timeout: 20_000 });

	afterEach(function (t, done) {
		disconnect(done);
	});

	it('calls back', (t, done) => {
		emitter.on('event', () => done());
	});

	it('takes long', { timeout: 10000 }, async () => {
		await slow();
	});

	it('uses t from a closure', (context, done) => {
		t('translated');
		done();
	});

	it.todo('later');
	it.only('focused', () => {});
	it.skip('skipped', () => {});
	describe.skip('skipped suite', () => {});
	it('concurrent', async () => {});
});
