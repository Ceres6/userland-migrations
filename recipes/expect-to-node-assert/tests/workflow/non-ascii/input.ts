import { it } from 'node:test';
import { expect } from 'expect';

it('lee los acentos: «ñandú» 🐦', () => {
	const nombre = 'Lucía Pérez';
	expect(nombre).toBe('Lucía Pérez');
	expect(nombre).toContain('í');
	expect(() => { throw new Error('Año inválido'); }).toThrow('Año inválido');
});
