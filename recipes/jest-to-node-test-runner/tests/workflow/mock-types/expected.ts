import { beforeEach, describe, it, mock, type Mock } from 'node:test';
import { expect } from 'expect';

describe('types', () => {
	let fn: Mock<(...args: [number]) => string>;
	let bare: Mock<(...args: any[]) => any>;
	let typed: Mock<typeof format>;

	beforeEach(() => {
		fn = mock.fn<(...args: any[]) => any>();
		bare = mock.fn<(...args: any[]) => any>();
		typed = mock.fn(format);
	});

	it('works', () => {
		expect(fn.mock.callCount()).toBe(0);
		expect(bare.mock.callCount()).toBe(0);
		expect(typed.mock.callCount()).toBe(0);
	});
});
