describe('callbacks and timeouts', () => {
	beforeAll((done) => {
		connect(done);
	}, 20_000);

	afterEach(function (done) {
		disconnect(done);
	});

	it('calls back', (done) => {
		emitter.on('event', () => done());
	});

	it('takes long', async () => {
		await slow();
	}, 10000);

	it('uses t from a closure', (done) => {
		t('translated');
		done();
	});

	it.todo('later');
	fit('focused', () => {});
	xit('skipped', () => {});
	xdescribe('skipped suite', () => {});
	it.concurrent('concurrent', async () => {});
});
