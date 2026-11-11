import { it } from 'node:test';
import assert from 'node:assert/strict';

it('lee los acentos: «ñandú» 🐦', () => {
	const nombre = 'Lucía Pérez';
	assert.equal(nombre, 'Lucía Pérez');
	assert.ok(nombre.includes('í'));
	assert.throws(() => { throw new Error('Año inválido'); }, { message: /Año inválido/ });
});
