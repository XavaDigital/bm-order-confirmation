import { NextResponse } from 'next/server';
import { getOrderById } from '@/server/orders/service';
import { parseRosterFile, guessColumnMapping, ImportParseError, MAX_IMPORT_FILE_BYTES } from '@/server/roster/import';
import { notFound } from '@/lib/api-responses';
import { defineRoute } from '@/lib/route-handler';

export const POST = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'admin/roster/import/preview POST',
  handler: async ({ request, params }) => {
    const order = await getOrderById(params.id);
    if (!order) return notFound('Order not found');

    const formData = await request.formData().catch(() => null);
    const file = formData?.get('file');
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      return NextResponse.json(
        { error: `File is too large — the limit is ${MAX_IMPORT_FILE_BYTES / (1024 * 1024)}MB.` },
        { status: 400 },
      );
    }

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const filename = file instanceof File ? file.name : 'upload.csv';
      const { headers, rows } = await parseRosterFile(buffer, filename);
      const guessedMapping = guessColumnMapping(headers);

      return NextResponse.json({
        headers,
        previewRows: rows.slice(0, 10),
        totalRows: rows.length,
        guessedMapping,
      });
    } catch (err) {
      // ImportParseError's name is plain 'Error' — the wrapper won't map it,
      // so its 400 stays here.
      if (err instanceof ImportParseError) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }
  },
});
