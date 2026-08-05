import { NextResponse } from 'next/server';
import { isStorageConfigured } from '@/lib/storage';
import { parseMultipartFormData, parseUploadedFile } from '@/lib/uploads';
import { defineRoute } from '@/lib/route-handler';
import { addPoFile, listPoFiles } from '@/server/purchase-orders/files-service';
import { PO_FILE_EXTENSIONS, PO_FILE_MAX_BYTES } from '@/server/purchase-orders/files-contract';

/** Production files on this PO, oldest first, with signed links + comment threads. */
export const GET = defineRoute<{ id: string }>({
  auth: 'viewer',
  tag: 'purchase-orders/[id]/files GET',
  handler: async ({ params }) => NextResponse.json({ items: await listPoFiles(params.id) }),
});

/**
 * Staff upload of a production file (one-shot multipart: bytes + optional
 * `category` field). The supplier-side twin lives under /api/supplier.
 */
export const POST = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'purchase-orders/[id]/files POST',
  handler: async ({ request, params, session }) => {
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
    const file = await addPoFile(params.id, {
      fileName: upload.file.name,
      data: upload.buffer,
      contentType: upload.file.type || null,
      category: typeof categoryField === 'string' ? categoryField : null,
      uploadedByKind: 'staff',
      uploadedByLabel: session!.email,
    });
    return NextResponse.json(file, { status: 201 });
  },
});
