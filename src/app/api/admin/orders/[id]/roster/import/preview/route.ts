import { NextRequest, NextResponse } from 'next/server';
import { getOrderById } from '@/server/orders/service';
import { parseRosterFile, guessColumnMapping, ImportParseError, MAX_IMPORT_FILE_BYTES } from '@/server/roster/import';
import { logger } from '@/lib/logger';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id: orderId } = await params;

  const order = await getOrderById(orderId);
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

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
    if (err instanceof ImportParseError) return NextResponse.json({ error: err.message }, { status: 400 });
    logger.error('[admin/roster/import/preview POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
