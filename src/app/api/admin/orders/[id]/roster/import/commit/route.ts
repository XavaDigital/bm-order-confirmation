import { NextResponse } from 'next/server';
import { importRosterMembers, RosterFullError } from '@/server/roster/service';
import { rosterImportMappingSchema, duplicateResolutionSchema } from '@/server/roster/contract';
import { parseRosterFile, ImportParseError, MAX_IMPORT_FILE_BYTES } from '@/server/roster/import';
import { badRequest, conflict } from '@/lib/api-responses';
import { defineRoute } from '@/lib/route-handler';

export const POST = defineRoute<{ id: string }>({
  auth: 'staff',
  tag: 'admin/roster/import/commit POST',
  handler: async ({ request, params }) => {
    const formData = await request.formData().catch(() => null);
    const file = formData?.get('file');
    const mappingRaw = formData?.get('mapping');
    const resolutionRaw = formData?.get('duplicateResolution');

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      return NextResponse.json(
        { error: `File is too large — the limit is ${MAX_IMPORT_FILE_BYTES / (1024 * 1024)}MB.` },
        { status: 400 },
      );
    }
    if (typeof mappingRaw !== 'string') {
      return NextResponse.json({ error: 'No column mapping provided' }, { status: 400 });
    }

    let mappingJson: unknown;
    try {
      mappingJson = JSON.parse(mappingRaw);
    } catch {
      return NextResponse.json({ error: 'Invalid column mapping' }, { status: 400 });
    }
    const parsedMapping = rosterImportMappingSchema.safeParse(mappingJson);
    if (!parsedMapping.success) return badRequest(parsedMapping.error);

    const parsedResolution = duplicateResolutionSchema.safeParse(resolutionRaw ?? undefined);
    if (!parsedResolution.success) return badRequest(parsedResolution.error);

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const filename = file instanceof File ? file.name : 'upload.csv';
      const { rows } = await parseRosterFile(buffer, filename);

      const result = await importRosterMembers(params.id, rows, parsedMapping.data, parsedResolution.data);
      return NextResponse.json(result, { status: result.needsConfirmation ? 200 : 201 });
    } catch (err) {
      // Neither error name matches the wrapper's *NotFoundError/*ConflictError
      // suffixes, so their statuses stay here; NotFoundError falls through.
      if (err instanceof ImportParseError) return NextResponse.json({ error: err.message }, { status: 400 });
      if (err instanceof RosterFullError) return conflict(err.message);
      throw err;
    }
  },
});
