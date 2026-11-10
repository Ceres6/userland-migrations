import { describe, it, mock } from 'node:test';
import { expect } from 'expect';

describe('facturación', () => {
	for (const [origen, destino] of [
		['año', 'ñandú'],
		['€uro', 'café'],
	] satisfies [unknown, ...unknown[]][]) {
		it(`convierte ${origen} en ${destino}`, () => {
			const conversión = mock.fn<(...args: any[]) => any>(() => destino);
			expect(conversión(origen)).toBe(destino);
			expect(conversión.mock.calls.map((call) => call.arguments)).toContainEqual(['año']);
		});
	}
});
