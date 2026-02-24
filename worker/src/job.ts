/**
 * Image Converter Job Processing Logic
 *
 * This worker orchestrates image-to-JPEG conversion by:
 * 1. Starting a job on the Lambda backend
 * 2. Polling for completion using DO alarms
 * 3. Returning the output entity ID for workflow handoff
 *
 * Key difference from pdf-to-jpeg: This adds the JPEG to the SAME entity
 * rather than creating new entities, so the output is the same entity ID.
 */

import type { ArkeClient } from '@arke-institute/sdk';
import type { KladosLogger, KladosRequest, Output } from '@arke-institute/rhiza';
import type { Env, TargetProperties } from './types.js';
import { LambdaClient } from './lambda-client.js';

/**
 * Context provided to processJob
 */
export interface ProcessContext {
  /** The original request */
  request: KladosRequest;

  /** Arke client for API calls */
  client: ArkeClient;

  /** Logger for messages (stored in the klados_log) */
  logger: KladosLogger;

  /** SQLite storage for checkpointing long operations */
  sql: SqlStorage;

  /** Worker environment bindings (secrets, vars, DO namespaces) */
  env: Env;

  /** Agent auth token (passed to Lambda) */
  authToken: string;
}

/**
 * Result returned from processJob
 */
export interface ProcessResult {
  /** Output entity IDs (or OutputItems with routing properties) */
  outputs?: Output[];

  /** If true, DO will reschedule alarm and call processJob again */
  reschedule?: boolean;
}

/**
 * Process an image conversion job
 *
 * Uses Lambda polling pattern:
 * - First call: Start Lambda job, store job_id, reschedule
 * - Subsequent calls: Poll status, reschedule if pending
 * - Final call: Return output entity ID (same as input since we add to same entity)
 */
export async function processJob(ctx: ProcessContext): Promise<ProcessResult> {
  const { request, logger, sql, env, authToken } = ctx;

  // =========================================================================
  // Initialize poll state table
  // =========================================================================

  sql.exec(`
    CREATE TABLE IF NOT EXISTS poll_state (
      id INTEGER PRIMARY KEY,
      lambda_job_id TEXT NOT NULL,
      poll_count INTEGER DEFAULT 0,
      started_at TEXT NOT NULL
    )
  `);

  const state = sql.exec('SELECT * FROM poll_state WHERE id = 1').toArray()[0];

  // Create Lambda client
  const lambdaClient = new LambdaClient(env.LAMBDA_URL, env.LAMBDA_SECRET);

  // =========================================================================
  // First run - Start Lambda job
  // =========================================================================

  if (!state) {
    logger.info('Starting image conversion Lambda job', {
      target: request.target_entity,
      isWorkflow: !!request.rhiza,
    });

    if (!request.target_entity) {
      throw new Error('No target_entity in request');
    }

    // Extract properties from request.input
    const inputProps = (request.input || {}) as TargetProperties;

    // Start Lambda job
    const result = await lambdaClient.startJob({
      entity_id: request.target_entity,
      api_base: request.api_base,
      api_key: authToken, // Use agent's auth token
      network: request.network,
      collection: request.target_collection,
      target_file_key: inputProps.target_file_key,
      options: inputProps.options,
    });

    // Store job ID for polling
    sql.exec(
      'INSERT INTO poll_state (id, lambda_job_id, poll_count, started_at) VALUES (1, ?, 0, ?)',
      result.job_id,
      new Date().toISOString()
    );

    logger.info(`Started Lambda job: ${result.job_id}`);

    return { reschedule: true };
  }

  // =========================================================================
  // Subsequent runs - Poll for completion
  // =========================================================================

  const lambdaJobId = state.lambda_job_id as string;
  const pollCount = (state.poll_count as number) + 1;

  // Poll Lambda status
  const status = await lambdaClient.getStatus(lambdaJobId);

  // Still processing - reschedule
  if (status.status === 'pending' || status.status === 'processing') {
    sql.exec('UPDATE poll_state SET poll_count = ? WHERE id = 1', pollCount);

    logger.info(`Poll #${pollCount}: ${status.phase}`);

    return { reschedule: true };
  }

  // Error - clean up and throw
  if (status.status === 'error') {
    sql.exec('DELETE FROM poll_state WHERE id = 1');

    const errorCode = status.error?.code || 'UNKNOWN';
    const errorMessage = status.error?.message || 'Unknown error';

    throw new Error(`Lambda error [${errorCode}]: ${errorMessage}`);
  }

  // =========================================================================
  // Success - Return output entity ID
  // =========================================================================

  sql.exec('DELETE FROM poll_state WHERE id = 1');

  const result = status.result;

  // Handle skipped case (source was already JPEG)
  if (result?.skipped) {
    logger.success(`Skipped conversion: ${result.reason}`, {
      entity_id: result.entity_id,
      source_format: result.source_format,
      poll_count: pollCount,
    });
  } else {
    logger.success(`Converted ${result?.source_format} to JPEG`, {
      entity_id: result?.entity_id,
      output_key: result?.output_key,
      dimensions: result?.width && result?.height ? `${result.width}x${result.height}` : 'unknown',
      size_bytes: result?.size_bytes,
      poll_count: pollCount,
    });
  }

  // Return the same entity ID (we added JPEG to same entity, not created new one)
  // Use entity_ids from result if present, otherwise fall back to entity_id
  const outputIds = result?.entity_ids || (result?.entity_id ? [result.entity_id] : []);

  return {
    outputs: outputIds,
  };
}
