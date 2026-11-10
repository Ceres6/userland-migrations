import type Invoice from '#context/invoices/domain/invoice.ts';
import type { InvoiceRepository } from '#context/invoices/domain/invoiceRepository.ts';

export default class InvoiceRepositoryMock implements InvoiceRepository {
	private mockSave = jest.fn();

	private mockSearch = jest.fn().mockResolvedValue([]);

	async save(invoice: Invoice): Promise<void> {
		this.mockSave(invoice);
	}

	async search(): Promise<Invoice[]> {
		return this.mockSearch();
	}

	whenSearchThenReturn(invoices: Invoice[]): void {
		this.mockSearch.mockReturnValue(invoices);
	}

	assertSaveHasBeenCalledWith(invoice: Invoice): void {
		const { mock } = this.mockSave,
			lastSaved = mock.calls[mock.calls.length - 1][0] as Invoice;

		expect(lastSaved.toPrimitives()).toStrictEqual(invoice.toPrimitives());
	}

	assertSavedExactly(invoices: Invoice[]): void {
		const saved = this.mockSave.mock.calls.map(([invoice]) => (invoice as Invoice).toPrimitives());

		expect(saved).toStrictEqual(expect.arrayContaining(invoices.map((invoice) => invoice.toPrimitives())));
	}

	assertNothingSaved(): void {
		expect(this.mockSave).not.toHaveBeenCalled();
	}

	lastFound(): Invoice | null {
		return (this.mockSearch.mock.results.at(-1)?.value as Invoice | undefined) ?? null;
	}
}
