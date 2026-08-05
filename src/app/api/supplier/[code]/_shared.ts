/**
 * The password-portal gate, shared by every /api/supplier/[code]/* route —
 * mirrors the roster surface's _shared.ts convention.
 *
 * Resolves the supplier from the URL code, then proves the request's cookie
 * against it (signature binds the portal password, so a password change signs
 * everyone out). Returns the supplier row + the person's self-asserted name,
 * or a NextResponse to return as-is.
 */
import { NextRequest, NextResponse } from 'next/server';
import { SUPPLIER_SESSION_COOKIE, readSupplierSessionCookie } from '@/lib/supplier-session';
import { getSupplierByPortalCode } from '@/server/supplier-portal/service';

export type SupplierGateResult =
  | {
      ok: true;
      supplier: NonNullable<Awaited<ReturnType<typeof getSupplierByPortalCode>>>;
      personName: string;
    }
  | { ok: false; response: NextResponse };

export async function requireSupplier(
  request: NextRequest,
  code: string,
): Promise<SupplierGateResult> {
  const supplier = await getSupplierByPortalCode(code);
  // Unknown code and not-logged-in read the same (401 with a login hint) so
  // the gate never confirms which supplier codes exist.
  if (!supplier || !supplier.isActive || !supplier.portalPassword) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Sign in required', code: 'login_required' }, { status: 401 }),
    };
  }
  const session = readSupplierSessionCookie(
    supplier,
    request.cookies.get(SUPPLIER_SESSION_COOKIE)?.value,
  );
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Sign in required', code: 'login_required' }, { status: 401 }),
    };
  }
  return { ok: true, supplier, personName: session.name };
}
