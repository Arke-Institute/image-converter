/**
 * Image Converter Klados E2E Test
 *
 * Tests the image-to-JPEG conversion:
 * 1. Creates an entity with a PNG image
 * 2. Invokes the klados to convert to JPEG
 * 3. Verifies JPEG was added to the SAME entity
 *
 * Prerequisites:
 * 1. Deploy Lambda: cd ../lambda && ./scripts/deploy.sh
 * 2. Deploy worker: npm run deploy
 * 3. Register klados: npm run register
 * 4. Set environment variables
 *
 * Environment variables:
 *   ARKE_USER_KEY   - Your Arke user API key (uk_...)
 *   KLADOS_ID       - The klados entity ID from registration
 *   ARKE_API_BASE   - API base URL (default: https://arke-v1.arke.institute)
 *   ARKE_NETWORK    - Network to use (default: test)
 *
 * Usage:
 *   ARKE_USER_KEY=uk_... KLADOS_ID=klados_... npm test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  configureTestClient,
  createCollection,
  createEntity,
  deleteEntity,
  getEntity,
  invokeKlados,
  waitForKladosLog,
  assertLogCompleted,
  getConfig,
  log,
} from '@arke-institute/klados-testing';

// =============================================================================
// Configuration
// =============================================================================

const ARKE_API_BASE = process.env.ARKE_API_BASE || 'https://arke-v1.arke.institute';
const ARKE_USER_KEY = process.env.ARKE_USER_KEY;
const NETWORK = (process.env.ARKE_NETWORK || 'test') as 'test' | 'main';
const KLADOS_ID = process.env.KLADOS_ID;

// =============================================================================
// Helper Functions
// =============================================================================

// Path to test PNG file (a real image that Sharp can process)
const TEST_IMAGE_PATH = '/Users/chim/Downloads/soviet_afghanistan_analysis_aesthetic.png';

/**
 * Get a valid PNG image for testing
 * Uses a real image file if available, otherwise creates a minimal test image
 */
function getTestPng(): ArrayBuffer {
  // Try to use the real test image
  if (existsSync(TEST_IMAGE_PATH)) {
    const buffer = readFileSync(TEST_IMAGE_PATH);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }

  // Fallback: Create a minimal valid 8x8 PNG using raw bytes
  // This is a properly formatted PNG with all required chunks
  // Generated programmatically to ensure validity
  const pngHex =
    '89504E470D0A1A0A' + // PNG signature
    '0000000D49484452' + // IHDR chunk header
    '000000080000000808020000004B6D1AAE' + // IHDR data: 8x8, RGB, etc. + CRC
    '00000015494441547801636060606060F8' + // IDAT chunk with compressed data
    'CF00000100010001000100000CC94F0C' + // IDAT continued + CRC
    '0000000049454E44AE426082'; // IEND chunk

  // Convert hex to binary
  const bytes = new Uint8Array(pngHex.length / 2);
  for (let i = 0; i < pngHex.length; i += 2) {
    bytes[i / 2] = parseInt(pngHex.substr(i, 2), 16);
  }
  return bytes.buffer;
}

/**
 * Upload binary content to an entity
 */
async function uploadEntityContent(
  entityId: string,
  content: ArrayBuffer,
  contentType: string,
  key: string = 'original'
): Promise<void> {
  const config = getConfig();
  const url = `${config.apiBase}/entities/${entityId}/content?key=${encodeURIComponent(key)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `ApiKey ${config.userKey}`,
      'X-Arke-Network': config.network,
      'Content-Type': contentType,
    },
    body: content,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to upload content: ${response.status} - ${text}`);
  }
}

/**
 * Download content from an entity
 */
async function downloadEntityContent(
  entityId: string,
  key: string
): Promise<{ data: ArrayBuffer; contentType: string } | null> {
  const config = getConfig();
  const url = `${config.apiBase}/entities/${entityId}/content?key=${encodeURIComponent(key)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `ApiKey ${config.userKey}`,
      'X-Arke-Network': config.network,
    },
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    const text = await response.text();
    throw new Error(`Failed to download content: ${response.status} - ${text}`);
  }

  const data = await response.arrayBuffer();
  const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
  return { data, contentType };
}

// =============================================================================
// Test Suite
// =============================================================================

describe('image-converter-worker', () => {
  // Test fixtures
  let targetCollection: { id: string };
  let imageEntity: { id: string };
  let jobCollectionId: string;

  // Skip tests if environment not configured
  beforeAll(() => {
    if (!ARKE_USER_KEY) {
      console.warn('Skipping tests: ARKE_USER_KEY not set');
      return;
    }
    if (!KLADOS_ID) {
      console.warn('Skipping tests: KLADOS_ID not set');
      return;
    }

    // Configure the test client
    configureTestClient({
      apiBase: ARKE_API_BASE,
      userKey: ARKE_USER_KEY,
      network: NETWORK,
    });

    log(`Using klados: ${KLADOS_ID}`);
  });

  // Create test fixtures
  beforeAll(async () => {
    if (!ARKE_USER_KEY || !KLADOS_ID) return;

    log('Creating test fixtures...');

    // Create target collection with permissions for klados to update entities
    targetCollection = await createCollection({
      label: `Image Converter Test ${Date.now()}`,
      description: 'Test collection for image-to-JPEG conversion',
      roles: {
        public: ['*:view', '*:invoke', '*:create', '*:update'],
      },
    });
    log(`Created target collection: ${targetCollection.id}`);

    // Create image entity
    imageEntity = await createEntity({
      type: 'file',
      properties: {
        label: 'Test PNG Image',
        filename: 'test-image.png',
      },
      collection: targetCollection.id,
    });
    log(`Created image entity: ${imageEntity.id}`);

    // Create and upload test PNG
    log('Creating test PNG...');
    const pngContent = getTestPng();
    log(`Created PNG: ${pngContent.byteLength} bytes`);

    log('Uploading PNG content to entity...');
    await uploadEntityContent(imageEntity.id, pngContent, 'image/png', 'original');
    log('PNG content uploaded');
  });

  // Cleanup test fixtures
  afterAll(async () => {
    if (!ARKE_USER_KEY || !KLADOS_ID) return;

    // Disable cleanup for debugging
    log('Cleanup DISABLED for inspection');
    log(`  Target collection: ${targetCollection?.id}`);
    log(`  Image entity: ${imageEntity?.id}`);
    log(`  Job collection: ${jobCollectionId}`);

    // Uncomment to enable cleanup:
    // try {
    //   if (imageEntity?.id) await deleteEntity(imageEntity.id);
    //   if (targetCollection?.id) await deleteEntity(targetCollection.id);
    //   log('Cleanup complete');
    // } catch (e) {
    //   log(`Cleanup error (non-fatal): ${e}`);
    // }
  });

  // ==========================================================================
  // Tests
  // ==========================================================================

  it('should convert PNG to JPEG on same entity', async () => {
    if (!ARKE_USER_KEY || !KLADOS_ID) {
      console.warn('Test skipped: missing environment variables');
      return;
    }

    // Invoke the klados
    log('Invoking Image Converter klados...');
    const result = await invokeKlados({
      kladosId: KLADOS_ID,
      targetEntity: imageEntity.id,
      targetCollection: targetCollection.id,
      confirm: true,
      input: {
        target_file_key: 'original',
        quality: 85,
        output_key: 'jpeg',
      },
    });

    expect(result.status).toBe('started');
    expect(result.job_id).toBeDefined();
    expect(result.job_collection).toBeDefined();

    jobCollectionId = result.job_collection!;
    log(`Job started: ${result.job_id}`);
    log(`Job collection: ${jobCollectionId}`);

    // Wait for completion - Lambda processing can take a while
    log('Waiting for job completion (Lambda processing may take 30-60 seconds)...');
    const kladosLog = await waitForKladosLog(jobCollectionId, {
      timeout: 120000, // 2 minutes for Lambda cold start + processing
      pollInterval: 5000,
      onPoll: (elapsed) => {
        log(`  Polling... ${Math.round(elapsed / 1000)}s elapsed`);
      },
    });

    // Verify log completed successfully
    assertLogCompleted(kladosLog);
    log(`Job completed with status: ${kladosLog.properties.status}`);

    // Log all messages for debugging
    log('Log messages:');
    for (const msg of kladosLog.properties.log_data?.messages || []) {
      log(`  [${msg.level}] ${msg.message}`);
    }

    // Check outputs - should be same entity ID
    const outputs = kladosLog.properties.log_data?.entry?.outputs || [];
    expect(outputs.length).toBe(1);
    expect(outputs[0]).toBe(imageEntity.id);
    log(`Output entity: ${outputs[0]} (same as input)`);

    // Verify JPEG was added to the entity
    const updatedEntity = await getEntity(imageEntity.id);
    log(`Updated entity content: ${JSON.stringify(updatedEntity.properties.content)}`);

    // Check that both original and jpeg exist
    expect(updatedEntity.properties.content).toBeDefined();
    expect(updatedEntity.properties.content.original).toBeDefined();
    expect(updatedEntity.properties.content.jpeg).toBeDefined();
    expect(updatedEntity.properties.content.jpeg.content_type).toBe('image/jpeg');
    log('JPEG content key exists with correct content type');

    // Download and verify JPEG content
    const jpegContent = await downloadEntityContent(imageEntity.id, 'jpeg');
    expect(jpegContent).not.toBeNull();
    expect(jpegContent!.contentType).toBe('image/jpeg');
    expect(jpegContent!.data.byteLength).toBeGreaterThan(0);
    log(`Downloaded JPEG: ${jpegContent!.data.byteLength} bytes`);

    log('Image conversion completed successfully!');
  }, 180000); // 3 minute test timeout

  it('should handle preview mode (confirm=false)', async () => {
    if (!ARKE_USER_KEY || !KLADOS_ID) {
      console.warn('Test skipped: missing environment variables');
      return;
    }

    // Preview invocation (confirm=false)
    const preview = await invokeKlados({
      kladosId: KLADOS_ID,
      targetEntity: imageEntity.id,
      targetCollection: targetCollection.id,
      confirm: false,
      input: {
        target_file_key: 'original',
      },
    });

    // Preview should return pending_confirmation status
    expect(preview.status).toBe('pending_confirmation');
    log(`Preview result: ${preview.status}`);
  });

  it('should skip conversion for JPEG source', async () => {
    if (!ARKE_USER_KEY || !KLADOS_ID) {
      console.warn('Test skipped: missing environment variables');
      return;
    }

    // Create a JPEG entity
    const jpegEntity = await createEntity({
      type: 'file',
      properties: {
        label: 'Test JPEG Image',
        filename: 'test-image.jpg',
      },
      collection: targetCollection.id,
    });

    // Upload a minimal JPEG (just the header is enough to detect format)
    // Minimal valid JPEG: SOI + APP0 + EOI
    const jpegBytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00,
      0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
    ]);
    await uploadEntityContent(jpegEntity.id, jpegBytes.buffer, 'image/jpeg', 'original');

    // Invoke the converter
    log('Invoking klados with JPEG source (should skip)...');
    const result = await invokeKlados({
      kladosId: KLADOS_ID,
      targetEntity: jpegEntity.id,
      targetCollection: targetCollection.id,
      confirm: true,
      input: {
        target_file_key: 'original',
      },
    });

    expect(result.status).toBe('started');

    // Wait for completion
    const kladosLog = await waitForKladosLog(result.job_collection!, {
      timeout: 120000,
      pollInterval: 5000,
    });

    // Should complete successfully (skipped)
    assertLogCompleted(kladosLog);

    // Log messages should indicate skipped
    const messages = kladosLog.properties.log_data?.messages || [];
    log('Log messages:');
    for (const msg of messages) {
      log(`  [${msg.level}] ${msg.message}`);
    }

    // Output should be the same entity
    const outputs = kladosLog.properties.log_data?.entry?.outputs || [];
    expect(outputs.length).toBe(1);
    expect(outputs[0]).toBe(jpegEntity.id);

    // Cleanup
    await deleteEntity(jpegEntity.id);
    log('JPEG skip test passed');
  }, 180000);
});
