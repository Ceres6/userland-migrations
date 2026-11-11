import type { SgNode } from '@codemod.com/jssg-types/main';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const SPACE = 0x20;
const TAB = 0x09;

/**
 * The source of a file, addressable by the byte offsets ast-grep reports.
 *
 * ast-grep ranges are byte offsets into the UTF-8 source, while JavaScript strings index UTF-16 code units:
 * slicing `text` with a node's range would corrupt every file with a non-ASCII character before the node.
 */
export class Source {
	readonly text: string;
	readonly bytes: Uint8Array;

	constructor(text: string) {
		this.text = text;
		this.bytes = encoder.encode(text);
	}

	slice(start: number, end: number): string {
		return decoder.decode(this.bytes.subarray(start, end));
	}

	/** Leading whitespace of the line containing `index`. */
	lineIndent(index: number): string {
		let start = index;
		while (start > 0 && this.bytes[start - 1] !== NEWLINE) start--;
		let end = start;
		while (this.bytes[end] === SPACE || this.bytes[end] === TAB) end++;
		return this.slice(start, end);
	}

	/**
	 * The text between `start` and `end`, with `unit` added after every line break that is not inside one of
	 * the `keep` ranges (multi-line template literals, whose content would change if re-indented).
	 */
	indent(start: number, end: number, unit: string, keep: SgNode[]): string {
		const ranges = keep.map((node) => node.range()).map((range) => [range.start.index, range.end.index]);
		let out = '';
		let from = start;
		for (let index = start; index < end; index++) {
			if (this.bytes[index] !== NEWLINE) continue;
			if (ranges.some(([rangeStart, rangeEnd]) => index > rangeStart && index < rangeEnd)) continue;
			// Blank lines stay blank
			const next = this.bytes[index + 1];
			if (next === NEWLINE || next === CARRIAGE_RETURN || index + 1 === end) continue;
			out += `${this.slice(from, index + 1)}${unit}`;
			from = index + 1;
		}
		return out + this.slice(from, end);
	}
}
