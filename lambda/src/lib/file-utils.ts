/**
 * File handling utilities for image converter
 */

import type { EntityWithContent, FileInfo, FileTypeFilter } from './types.js';

// =============================================================================
// Constants
// =============================================================================

export const MAX_IMAGE_SIZE = 50 * 1024 * 1024; // 50MB

export const IMAGE_FILTER: FileTypeFilter = {
  mimeTypes: [
    'image/tiff',
    'image/png',
    'image/webp',
    'image/avif',
    'image/gif',
    'image/jpeg',
  ],
  extensions: ['.tiff', '.tif', '.png', '.webp', '.avif', '.gif', '.jpg', '.jpeg'],
};

// =============================================================================
// File Resolution
// =============================================================================

/**
 * List files from entity's properties.content
 */
export function listEntityFiles(
  entity: Pick<EntityWithContent, 'properties'>
): FileInfo[] {
  const content = entity.properties.content;
  if (!content || typeof content !== 'object') {
    return [];
  }

  return Object.entries(content).map(([key, meta]) => ({
    key,
    content_type: meta.content_type,
    size: meta.size,
  }));
}

/**
 * Resolve target file from entity
 *
 * Priority:
 * 1. Explicit target_file_key (throw if not found)
 * 2. Auto-detect from properties.content using filter
 */
export function resolveTargetFile(
  entity: EntityWithContent,
  targetFileKey?: string,
  filter?: FileTypeFilter
): FileInfo {
  const files = listEntityFiles(entity);

  // 1. Explicit file key
  if (targetFileKey) {
    const file = files.find((f) => f.key === targetFileKey);
    if (!file) {
      throw new Error(`FILE_NOT_FOUND: File '${targetFileKey}' not found on entity ${entity.id}`);
    }
    return file;
  }

  // 2. Auto-detect with filter
  if (filter) {
    const matchingFile = files.find((f) => isMatchingFile(f, filter));
    if (matchingFile) {
      return matchingFile;
    }
  }

  // 3. No file found
  if (files.length === 0) {
    throw new Error(`NO_CONTENT: Entity ${entity.id} has no files attached`);
  }

  throw new Error(
    `NO_CONTENT: No matching image file found on entity ${entity.id}. ` +
      `Available files: ${files.map((f) => `${f.key} (${f.content_type})`).join(', ')}`
  );
}

/**
 * Check if file matches the type filter
 */
function isMatchingFile(file: FileInfo, filter: FileTypeFilter): boolean {
  // Check MIME type
  if (file.content_type && filter.mimeTypes.includes(file.content_type)) {
    return true;
  }

  // Check extension
  const ext = file.key.toLowerCase();
  return filter.extensions.some((validExt) => ext.endsWith(validExt));
}

// =============================================================================
// File Validation
// =============================================================================

/**
 * Validate file size
 */
export function validateFileSize(
  file: FileInfo,
  maxSizeBytes: number,
  processorName: string
): void {
  if (!file.size) {
    console.warn(`[file-utils] File '${file.key}' has no size metadata, skipping validation`);
    return;
  }

  if (file.size > maxSizeBytes) {
    const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
    const maxSizeMB = (maxSizeBytes / 1024 / 1024).toFixed(0);
    throw new Error(
      `FILE_TOO_LARGE: File '${file.key}' is ${fileSizeMB}MB. ` +
        `Maximum size for ${processorName} is ${maxSizeMB}MB.`
    );
  }
}

// =============================================================================
// File Download
// =============================================================================

/**
 * Download file content from Arke entity
 *
 * Uses direct HTTP fetch because SDK doesn't properly support key parameter
 */
export async function downloadEntityFile(
  apiBase: string,
  authToken: string,
  entityId: string,
  fileKey: string
): Promise<Buffer> {
  const url = `${apiBase}/entities/${entityId}/content?key=${encodeURIComponent(fileKey)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `ApiKey ${authToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `DOWNLOAD_FAILED: Failed to download file '${fileKey}' from entity ${entityId}: ` +
        `${response.status} ${response.statusText} - ${text}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
