import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listSizeCharts, createSizeChart } from '@/server/size-charts/service';
import { sizeChartSizesFormSchema } from '@/server/size-charts/contract';
import { badRequest } from '@/lib/api-responses';
import type { SizeChartSize } from '@/db/schema';
import { parseMultipartFormData, parseUploadedFile } from '@/lib/uploads';
import { isStorageConfigured, StorageUnavailableError } from '@/lib/storage';
import { defineRoute } from '@/lib/route-handler';
import { logger } from '@/lib/logger';

const ALLOWED_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

export const GET = defineRoute({
  auth: 'staff',
  tag: 'size-charts GET',
  handler: async () => NextResponse.json(await listSizeCharts()),
});

export const POST = defineRoute({
  auth: 'admin',
  tag: 'size-charts POST',
  handler: async ({ request }) => {
    if (!isStorageConfigured()) {
      return NextResponse.json(
        { error: 'File storage is not configured on this server' },
        { status: 503 },
      );
    }

    const formData = await parseMultipartFormData(request);
    if (formData instanceof NextResponse) return formData;

    const name = (formData.get('name') as string | null)?.trim();
    const description = (formData.get('description') as string | null)?.trim() || null;

    const nameResult = z.string().min(1).safeParse(name);
    if (!nameResult.success) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    // Sizes arrive as a JSON-string form field alongside the multipart file
    const rawSizes = (formData.get('sizes') as string | null) ?? null;
    let sizes: SizeChartSize[] = [];
    if (rawSizes) {
      const sizesResult = sizeChartSizesFormSchema.safeParse(rawSizes);
      if (!sizesResult.success) return badRequest(sizesResult.error);
      sizes = sizesResult.data;
    }

    const upload = await parseUploadedFile(formData, {
      allowedTypes: Object.keys(ALLOWED_TYPES),
      maxBytes: MAX_BYTES,
      typeErrorMessage: 'Only PDF, JPEG, PNG and WebP files are allowed',
    });
    if (upload instanceof NextResponse) return upload;
    const { file, buffer } = upload;

    try {
      const chart = await createSizeChart({
        name: nameResult.data,
        description,
        sizes,
        buffer,
        mimeType: file.type,
        ext: ALLOWED_TYPES[file.type],
      });
      return NextResponse.json(chart, { status: 201 });
    } catch (err) {
      // Storage misconfiguration (rejected credentials, missing bucket, wrong
      // region) carries an actionable message — let the wrapper 503 it rather
      // than hiding it behind a generic "Upload failed".
      if (err instanceof StorageUnavailableError) throw err;
      logger.error('[size-charts POST]', err);
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }
  },
});
