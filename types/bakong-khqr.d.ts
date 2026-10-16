declare module "bakong-khqr" {
  export class IndividualInfo {
    constructor(accountId: string, name: string, city: string,
      options: { currency: number; amount: number; billNumber: string; expirationTimestamp: number; acquiringBank?: string });
  }
  export class MerchantInfo {
    constructor(accountId: string, name: string, city: string, merchantId: string, acquiringBank: string,
      options: { currency: number; amount: number; billNumber: string; expirationTimestamp: number });
  }
  export class BakongKHQR {
    generateIndividual(info: IndividualInfo): { status: { code: number }; data?: { qr: string; md5: string } };
    generateMerchant(info: MerchantInfo): { status: { code: number }; data?: { qr: string; md5: string } };
    static decode(qr: string): { data: Record<string, unknown> };
  }
  export const khqrData: { currency: { usd: number; khr: number } };
}
