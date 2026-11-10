import { mock } from 'node:test';
import { expect } from 'expect';
import type Invoice from '#context/invoices/domain/invoice.ts';
import type { InvoiceRepository } from '#context/invoices/domain/invoiceRepository.ts';

export default class InvoiceRepositoryMock implements InvoiceRepository {
	private mockSave = mock.fn<(...args: any[]) => any>();

	private mockSearch = mock.fn<(...args: any[]) => any>(() => Promise.resolve([]));

	async save(invoice: Invoice): Promise<void> {
		this.mockSave(invoice);
	}

	async search(): Promise<Invoice[]> {
		return this.mockSearch();
	}

	whenSearchThenReturn(invoices: Invoice[]): void {
		this.mockSearch.mock.mockImplementation(() => invoices);
	}

	assertSaveHasBeenCalledWith(invoice: Invoice): void {
		const { mock } = this.mockSave,
			lastSaved = mock.calls[mock.calls.length - 1]!.arguments[0] as Invoice;

		expect(lastSaved.toPrimitives()).toStrictEqual(invoice.toPrimitives());
	}

	assertSavedExactly(invoices: Invoice[]): void {
		const saved = this.mockSave.mock.calls.map(({ arguments: [invoice] }) => (invoice as Invoice).toPrimitives());

		expect(saved).toStrictEqual(expect.arrayContaining(invoices.map((invoice) => invoice.toPrimitives())));
	}

	assertNothingSaved(): void {
		expect(this.mockSave.mock.callCount()).toBe(0);
	}

	lastFound(): Invoice | null {
		return (this.mockSearch.mock.calls.map((call) => ({ type: call.error === undefined ? 'return' : 'throw', value: call.error === undefined ? call.result : call.error })).at(-1)?.value as Invoice | undefined) ?? null;
	}
}
