import { NextResponse } from 'next/server';
import { getClientIp, rateLimitedResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { isStorageConfigured } from '@/lib/storage';
import { parseMultipartFormData, parseUploadedFile } from '@/lib/uploads';
import { defineRoute } from '@/lib/route-handler';
import { addPoFile, listPoFiles } from '@/server/purchase-orders/files-service';
import { PO_FILE_EXTENSIONS, PO_FILE_MAX_BYTES } from '@/server/purchase-orders/files-contract';
import { requireSupplier } from '../../../_shared';
import { loadSentPoForExport } from '../_export';

/** The PO's production files for the portal — same DTO the admin side reads. */
export const GET = defineRoute<{ code: string; poNumber: string }>({
  auth: 'public',
  tag: 'supplier/po/files GET',
  handler: async ({ request, params }) => {
    const gate = await requireSupplier(request, params.code);
    if (!gate.ok) return gate.response;
    const po = await loadSentPoForExport(gate.supplier.id, params.poNumber);
    if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ items: await listPoFiles(po.id) });
  },
});

/**
 * Supplier upload of a production file (David, 2026-08-05): the layout before
 * test print, the test print, the production layout… One-shot multipart with
 * an optional `category` field; attributed to the named person.
 */
export const POST = defineRoute<{ code: string; poNumber: string }>({
  auth: 'public',
  tag: 'supplier/po/files POST',
  handler: async ({ request, params }) => {
    const ip = getClientIp(request.headers);
    const rateLimited = await rateLimitedResponse(
      `supplier-portal:${ip}`,
      RATE_LIMITS.customerWrite,
      'Too many requests. Please try again later.',
    );
    if (rateLimited) return rateLimited;

    const gate = await requireSupplier(request, params.code);
    if (!gate.ok) return gate.response;
    const po = await loadSentPoForExport(gate.supplier.id, params.poNumber);
    if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (!isStorageConfigured()) {
      return NextResponse.json(
        { error: 'File storage is not configured on this server' },
        { status: 503 },
      );
    }
    const formData = await parseMultipartFormData(request);
    if (formData instanceof NextResponse) return formData;
    const upload = await parseUploadedFile(formData, {
      allowedExtensions: PO_FILE_EXTENSIONS,
      maxBytes: PO_FILE_MAX_BYTES,
      typeErrorMessage: 'That file type is not accepted for production files',
    });
    if (upload instanceof NextResponse) return upload;

    const categoryField = formData.get('category');
    const file = await addPoFile(po.id, {
      fileName: upload.file.name,
      data: upload.buffer,
      contentType: upload.file.type || null,
      category: typeof categoryField === 'string' ? categoryField : null,
      uploadedByKind: 'supplier',
      uploadedByLabel: `${gate.personName} (${gate.supplier.name})`,
    });
    return NextResponse.json(file, { status: 201 });
  },
});
