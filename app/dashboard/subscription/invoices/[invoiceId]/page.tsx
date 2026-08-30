import { InvoiceReceiptView } from "@/components/subscription/invoice-receipt-view";

export const dynamic = "force-dynamic";

type InvoicePageProps = {
  params: Promise<{
    invoiceId: string;
  }>;
  searchParams?: Promise<{
    autoprint?: string | string[];
    return_to?: string | string[];
  }>;
};

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function InvoicePage({
  params,
  searchParams,
}: InvoicePageProps) {
  const { invoiceId } = await params;
  const query = searchParams ? await searchParams : {};
  const autoPrint = single(query.autoprint) === "1";
  const requestedReturnTo = single(query.return_to).trim();
  const returnTo = requestedReturnTo.startsWith("/dashboard/")
    ? requestedReturnTo
    : "/dashboard/subscription";

  return (
    <InvoiceReceiptView
      invoiceId={invoiceId}
      autoPrint={autoPrint}
      returnTo={returnTo}
    />
  );
}
