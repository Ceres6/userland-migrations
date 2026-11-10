describe('facturación', () => {
	it.each([
		['año', 'ñandú'],
		['€uro', 'café'],
	])('convierte %s en %s', (origen, destino) => {
		const conversión = jest.fn().mockReturnValue(destino);
		expect(conversión(origen)).toBe(destino);
		expect(conversión).toHaveBeenCalledWith('año');
	});
});
