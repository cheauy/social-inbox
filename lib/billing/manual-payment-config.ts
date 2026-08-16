import "server-only";

function clean(value: string | undefined) {
  return value?.trim() ?? "";
}

function isEnabled(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(
    clean(value).toLowerCase(),
  );
}

export type ManualPaymentConfig = {
  enabled: boolean;
  bankName: string;
  accountName: string;
  accountNumber: string;
  qrImageUrl: string | null;
  supportText: string | null;
};

export function getManualPaymentConfig(): ManualPaymentConfig {
  const bankName = clean(
    process.env.TENH_MANUAL_PAYMENT_BANK_NAME,
  );
  const accountName = clean(
    process.env.TENH_MANUAL_PAYMENT_ACCOUNT_NAME,
  );
  const accountNumber = clean(
    process.env.TENH_MANUAL_PAYMENT_ACCOUNT_NUMBER,
  );
  const qrImageUrl = clean(
    process.env.TENH_MANUAL_PAYMENT_QR_IMAGE_URL,
  );
  const supportText = clean(
    process.env.TENH_MANUAL_PAYMENT_SUPPORT_TEXT,
  );

  const enabled =
    isEnabled(
      process.env.TENH_MANUAL_PAYMENT_ENABLED,
    ) &&
    Boolean(bankName) &&
    Boolean(accountName) &&
    Boolean(accountNumber);

  return {
    enabled,
    bankName,
    accountName,
    accountNumber,
    qrImageUrl: qrImageUrl || null,
    supportText: supportText || null,
  };
}
