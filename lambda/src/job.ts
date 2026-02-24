/**
 * Image Converter Job Processor
 *
 * Converts TIFF, PNG, WebP, and other image formats to JPEG
 * by adding the JPEG as a new file to the SAME entity (not creating new entities).
 */

import type { ProcessContext, ProcessResult, ImageJob, ImageResult, EntityWithContent } from './lib/types.js';
import { createArkeClient, getEntity, uploadContentToEntity } from './lib/arke.js';
import {
  resolveTargetFile,
  downloadEntityFile,
  validateFileSize,
  IMAGE_FILTER,
  MAX_IMAGE_SIZE,
} from './lib/file-utils.js';
import { detectFormat, convertToJpeg } from './lib/image-convert.js';

// =============================================================================
// Main Processing Function
// =============================================================================

/**
 * Process image to JPEG conversion
 *
 * Flow:
 * 1. Download source image file (TIFF/PNG/WebP/etc)
 * 2. Detect format
 * 3. Skip if already JPEG (user confirmed)
 * 4. Convert to JPEG using Sharp
 * 5. Upload JPEG to SAME entity with key (default: "jpeg")
 * 6. Return same entity ID
 */
export async function processJob(
  ctx: ProcessContext<ImageJob>
): Promise<ProcessResult<ImageResult>> {
  const { job } = ctx;

  console.log(`[job] Processing entity ${job.entity_id}`);
  console.log(`[job] Options: quality=${job.quality}, output_key=${job.output_key}`);

  // -------------------------------------------------------------------------
  // Step 1: Create Arke client and get entity
  // -------------------------------------------------------------------------
  const client = createArkeClient(job);
  await ctx.updateProgress({ phase: 'downloading' });

  const entity = await getEntity(client, job.entity_id);
  console.log(`[job] Got entity: ${entity.id} (type: ${entity.type})`);

  // -------------------------------------------------------------------------
  // Step 2: Resolve source file and download
  // -------------------------------------------------------------------------
  const entityWithContent: EntityWithContent = {
    id: entity.id,
    type: entity.type,
    properties: entity.properties as EntityWithContent['properties'],
  };

  const sourceFile = resolveTargetFile(
    entityWithContent,
    job.target_file_key,
    IMAGE_FILTER
  );
  console.log(`[job] Resolved source file: ${sourceFile.key} (${sourceFile.content_type}, ${sourceFile.size} bytes)`);

  // Validate size
  validateFileSize(sourceFile, MAX_IMAGE_SIZE, 'image-converter');

  // Detect format
  const sourceFormat = detectFormat(
    sourceFile.content_type || '',
    sourceFile.key
  );

  if (!sourceFormat) {
    throw new Error(
      `UNSUPPORTED_TYPE: Could not detect image format. ` +
      `Content-Type: ${sourceFile.content_type}, Filename: ${sourceFile.key}`
    );
  }

  console.log(`[job] Detected format: ${sourceFormat}`);

  // -------------------------------------------------------------------------
  // Step 3: Skip if already JPEG (user confirmed behavior)
  // -------------------------------------------------------------------------
  if (sourceFormat === 'jpeg' || sourceFormat === 'jpg') {
    console.log(`[job] Source is already JPEG, skipping conversion`);

    await ctx.updateProgress({ phase: 'skipped' });

    const result: ImageResult = {
      entity_id: job.entity_id,
      entity_ids: [job.entity_id],
      source_format: sourceFormat,
      skipped: true,
      reason: 'Source is already JPEG, no conversion needed',
    };

    return {
      entity_ids: [job.entity_id],
      result,
    };
  }

  // -------------------------------------------------------------------------
  // Step 4: Download source image
  // -------------------------------------------------------------------------
  const sourceBuffer = await downloadEntityFile(
    job.api_base,
    job.api_key,
    entity.id,
    sourceFile.key
  );
  console.log(`[job] Downloaded source: ${sourceBuffer.length} bytes`);

  // -------------------------------------------------------------------------
  // Step 5: Convert to JPEG
  // -------------------------------------------------------------------------
  await ctx.updateProgress({ phase: 'converting' });

  const { buffer: jpegBuffer, width, height } = await convertToJpeg(
    sourceBuffer,
    job.quality,
    sourceFormat
  );
  console.log(`[job] Converted to JPEG: ${width}x${height}, ${jpegBuffer.length} bytes`);

  // -------------------------------------------------------------------------
  // Step 6: Upload JPEG to same entity (overwrites if exists - user confirmed)
  // -------------------------------------------------------------------------
  await ctx.updateProgress({ phase: 'uploading' });

  await uploadContentToEntity(job.api_base, job.api_key, {
    entityId: job.entity_id,
    key: job.output_key,
    content: jpegBuffer,
    contentType: 'image/jpeg',
    network: job.network,
  });
  console.log(`[job] Uploaded JPEG to entity ${job.entity_id} with key '${job.output_key}'`);

  // -------------------------------------------------------------------------
  // Step 7: Return result (same entity ID)
  // -------------------------------------------------------------------------
  await ctx.updateProgress({ phase: 'complete' });

  const result: ImageResult = {
    entity_id: job.entity_id,
    entity_ids: [job.entity_id],
    output_key: job.output_key,
    source_format: sourceFormat,
    width,
    height,
    size_bytes: jpegBuffer.length,
  };

  console.log(`[job] Processing complete: ${sourceFormat} → JPEG (${jpegBuffer.length} bytes)`);

  return {
    entity_ids: [job.entity_id],
    result,
  };
}
