import { describe, it } from 'node:test';
import { expect } from 'expect';
import { Member, MemberNotFound } from './member.ts';

describe('member', () => {
	it('compares values', () => {
		const member = new Member('Ada');
		expect(member.name).toBe('Ada');
		expect(member.id).not.toBe(0);
		expect(member.toPrimitives()).toStrictEqual({ name: 'Ada' });
		expect(member.tags).toEqual(['admin']);
		expect(member.friend).toBeNull();
		expect(member.boss).not.toBeNull();
		expect(member.nickname).toBeUndefined();
		expect(member.email).toBeDefined();
		expect(member.active).toBeTruthy();
		expect(member.active || member.pending).not.toBeFalsy();
		expect(member).toBeInstanceOf(Member);
		expect(member.age).toBeGreaterThan(18);
		expect(member.age + 1).toBeLessThanOrEqual(120);
		expect(member.tags).toHaveLength(1);
		expect(member.tags).toContain('admin');
		expect(member.name).not.toContain('Bob');
		expect(member.email).toMatch(/@example\.com$/);
		expect(member.email).toMatch('example');
		expect(member.score).toBeCloseTo(0.3);
		expect(member.distance).toBeCloseTo(67.8, 0);
		expect(member.score).not.toBeNaN();
		expect(member.toPrimitives()).not.toHaveProperty('password');
		expect(member.tags)
			.toStrictEqual([
				'admin',
			]);
		// Template literals keep their content, and so their indentation
		expect(member.toPrimitives())
			.toStrictEqual({
				name: 'Ada',
				bio: `Line one
	line two`,
			});
	});

	it('throws', async () => {
		expect(() => Member.find('')).toThrow();
		expect(() => Member.find('nobody')).toThrow(MemberNotFound);
		expect(() => Member.find('nobody')).toThrow('Member not found (nobody)');
		expect(() => Member.find('nobody')).toThrow(/not found/i);
		expect(() => Member.find('ada')).not.toThrow();
		await expect(Member.load('nobody')).rejects.toThrow(MemberNotFound);
		await expect(Member.load('ada')).resolves.toStrictEqual(new Member('Ada'));
		await expect(Member.load('ada')).resolves.toBeDefined();
	});
});
