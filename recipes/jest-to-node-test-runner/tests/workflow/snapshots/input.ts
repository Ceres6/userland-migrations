describe('snapshots', () => {
	it('matches', () => {
		expect(render()).toMatchSnapshot();
	});

	it('matches inline', async () => {
		expect(await load()).toMatchInlineSnapshot(`
{
	"ok": true,
}
`);
	});

	it('with property matchers', () => {
		expect(render()).toMatchSnapshot({ id: expect.any(String) });
	});
});
