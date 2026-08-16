import "server-only";

/**
 * Backward-compatible aliases.
 *
 * Older TENH manual-payment code imports these billing-admin names. They now
 * resolve to the single hardened TENH administrator identity, so there is no
 * second/legacy admin whitelist that can accidentally grant access.
 */
import {
  getTenhAdminUser,
  requireTenhAdminPage,
} from "@/lib/admin/tenh-admin-auth";

export const getBillingAdminUser = getTenhAdminUser;
export const requireBillingAdminPage = requireTenhAdminPage;
