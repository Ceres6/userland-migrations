export default class Repeater {
	static distinct<T extends { equalsTo(other: T): boolean }>(items: T[]): T[] {
		return items.filter((item, index) => !items.slice(0, index).some((it) => it.equalsTo(item)));
	}

	static check(test: (value: number) => boolean, expect: number): boolean {
		return test(expect);
	}
}
