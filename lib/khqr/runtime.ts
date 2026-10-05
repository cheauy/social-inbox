import "server-only";
import { getKhqrReadiness } from "./config";
import type { MockKhqrService } from "./service";

/** Wiring point for the Billing owner after facade/contract review. No env flag
 * can replace review or turn mocked approval into real subscription writes.
 */
export function getKhqrRuntime(): { readiness: ReturnType<typeof getKhqrReadiness>; service: MockKhqrService | null } {
  return { readiness: getKhqrReadiness(), service: null };
}
