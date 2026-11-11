import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Member, MemberNotFound } from './member.ts';

describe('member', () => {
	it('compares values', () => {
		const member = new Member('Ada');
		assert.equal(member.name, 'Ada');
		assert.notEqual(member.id, 0);
		assert.deepEqual(member.toPrimitives(), { name: 'Ada' });
		assert.deepEqual(member.tags, ['admin']);
		assert.equal(member.friend, null);
		assert.notEqual(member.boss, null);
		assert.equal(member.nickname, undefined);
		assert.notEqual(member.email, undefined);
		assert.ok(member.active);
		assert.ok(member.active || member.pending);
		assert.ok(member instanceof Member);
		assert.ok(member.age > 18);
		assert.ok(member.age + 1 <= 120);
		assert.equal(member.tags.length, 1);
		assert.ok(member.tags.includes('admin'));
		assert.ok(!member.name.includes('Bob'));
		assert.match(member.email, /@example\.com$/);
		assert.ok(member.email.includes('example'));
		assert.ok(Math.abs(member.score - 0.3) < 0.005);
		assert.ok(Math.abs(member.distance - 67.8) < 0.5);
		assert.ok(!Number.isNaN(member.score));
		assert.ok(!('password' in member.toPrimitives()));
		assert.deepEqual(member.tags, [
			'admin',
		]);
		// Template literals keep their content, and so their indentation
		assert.deepEqual(member.toPrimitives(), {
				name: 'Ada',
				bio: `Line one
	line two`,
			});
	});

	it('throws', async () => {
		assert.throws(() => Member.find(''));
		assert.throws(() => Member.find('nobody'), MemberNotFound);
		assert.throws(() => Member.find('nobody'), { message: /Member not found \(nobody\)/ });
		assert.throws(() => Member.find('nobody'), { message: /not found/i });
		assert.doesNotThrow(() => Member.find('ada'));
		await assert.rejects(Member.load('nobody'), MemberNotFound);
		assert.deepEqual(await Member.load('ada'), new Member('Ada'));
		assert.notEqual(await Member.load('ada'), undefined);
	});
});
