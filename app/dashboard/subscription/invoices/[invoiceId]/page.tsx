import { InvoiceReceiptView } from "@/components/subscription/invoice-receipt-view";

export const dynamic = "force-dynamic";

type InvoicePageProps = {
  params: Promise<{
    invoiceId: string;
  }>;
};

export default async function InvoicePage({
  params,
}: InvoicePageProps) {
  const { invoiceId } = await params;

  return <InvoiceReceiptView invoiceId={invoiceId} />;
}
