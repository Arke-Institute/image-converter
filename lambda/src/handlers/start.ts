/**
 * Start Handler - Creates async job and invokes processing
 *
 * POST /start
 * Returns immediately with job_id, processing happens in background
 */

import { LambdaClient, InvokeCommand, InvocationType } from '@aws-sdk/client-lambda';
import type { StartInput, StartResponse, ImageJob, ImageProgress } from '../lib/types.js';
import { createJob, generateJobId } from '../lib/dynamo.js';

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * Validate start input
 */
function validateInput(input: unknown): StartInput {
  const data = input as Record<string, unknown>;

  if (!data.entity_id || typeof data.entity_id !== 'string') {
    throw new Error('entity_id is required');
  }
  if (!data.api_base || typeof data.api_base !== 'string') {
    throw new Error('api_base is required');
  }
  if (!data.api_key || typeof data.api_key !== 'string') {
    throw new Error('api_key is required');
  }
  if (!data.network || (data.network !== 'test' && data.network !== 'main')) {
    throw new Error('network must be "test" or "main"');
  }

  return {
    entity_id: data.entity_id,
    api_base: data.api_base,
    api_key: data.api_key,
    network: data.network,
    collection: data.collection as string | undefined,
    target_file_key: data.target_file_key as string | undefined,
    options: data.options as Record<string, unknown> | undefined,
  };
}

/**
 * Create initial job state
 *
 * Override this function in your processor to add custom fields.
 */
export function createInitialJobState<
  TJob extends BaseJob<TProgress, TResult>,
  TProgress extends BaseProgress,
  TResult extends BaseResult,
>(
  jobId: string,
  input: StartInput,
  initialProgress: TProgress
): Omit<TJob, 'created_at' | 'updated_at' | 'ttl'> {
  return {
    job_id: jobId,
    status: 'pending',
    phase: 'init',
    progress: initialProgress,
    retry_count: 0,
    entity_id: input.entity_id,
    api_base: input.api_base,
    api_key: input.api_key,
    network: input.network,
    collection: input.collection,
    target_file_key: input.target_file_key,
    options: input.options,
  } as Omit<TJob, 'created_at' | 'updated_at' | 'ttl'>;
}

/**
 * Handle POST /start request
 */
export async function handleStart(input: unknown): Promise<StartResponse> {
  // Validate input
  const validatedInput = validateInput(input);
  const jobId = generateJobId();

  console.log(`[start] Creating job ${jobId} for entity ${validatedInput.entity_id}`);

  // Extract image-specific options
  const options = validatedInput.options || {};
  const quality = typeof options.quality === 'number' ? options.quality : 85;
  const outputKey = typeof options.output_key === 'string' ? options.output_key : 'jpeg';

  // Create job in DynamoDB with image-specific fields
  const initialProgress: ImageProgress = { phase: 'downloading' };

  const imageJob: Omit<ImageJob, 'created_at' | 'updated_at' | 'ttl'> = {
    job_id: jobId,
    status: 'pending',
    phase: 'init',
    progress: initialProgress,
    retry_count: 0,
    entity_id: validatedInput.entity_id,
    api_base: validatedInput.api_base,
    api_key: validatedInput.api_key,
    network: validatedInput.network,
    collection: validatedInput.collection,
    target_file_key: validatedInput.target_file_key,
    options: validatedInput.options,
    quality,
    output_key: outputKey,
  };

  await createJob(imageJob);

  // Invoke self asynchronously
  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!functionName) {
    throw new Error('AWS_LAMBDA_FUNCTION_NAME environment variable not set');
  }

  console.log(`[start] Invoking async processing for job ${jobId}`);

  await lambdaClient.send(new InvokeCommand({
    FunctionName: functionName,
    InvocationType: InvocationType.Event, // Fire-and-forget
    Payload: JSON.stringify({ action: 'process', job_id: jobId }),
  }));

  console.log(`[start] Job ${jobId} created and processing started`);

  return { success: true, job_id: jobId, status: 'pending' };
}
