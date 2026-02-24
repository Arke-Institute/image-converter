/**
 * Type definitions for Lambda file processor template
 *
 * Extend these types for your specific processor.
 */

// =============================================================================
// Job Status
// =============================================================================

export type JobStatus = 'pending' | 'processing' | 'done' | 'error';

// =============================================================================
// Job Error
// =============================================================================

export interface JobError {
  code: string;
  message: string;
}

// =============================================================================
// Base Job Interface
// =============================================================================

/**
 * Base progress tracking - extend for your processor
 *
 * @example
 * ```typescript
 * interface PdfProgress extends BaseProgress {
 *   pages_total: number;
 *   pages_processed: number;
 * }
 * ```
 */
export interface BaseProgress {
  phase: string;
}

/**
 * Base result type - extend for your processor
 *
 * @example
 * ```typescript
 * interface PdfResult extends BaseResult {
 *   pages: Array<{ entity_id: string; page_number: number }>;
 * }
 * ```
 */
export interface BaseResult {
  entity_ids?: string[];
}

/**
 * Base async job interface for file processors
 *
 * @template TProgress - Processor-specific progress type
 * @template TResult - Processor-specific result type
 */
export interface BaseJob<
  TProgress extends BaseProgress = BaseProgress,
  TResult extends BaseResult = BaseResult,
> {
  // Identity
  job_id: string;

  // Status
  status: JobStatus;
  phase: string;

  // Progress tracking
  progress: TProgress;

  // Result (populated when done)
  result?: TResult;

  // Error info (populated when status='error')
  error?: JobError;

  // Retry tracking
  retry_count: number;

  // Timestamps
  created_at: string;
  updated_at: string;
  completed_at?: string;

  // TTL for DynamoDB auto-cleanup (Unix timestamp in seconds)
  ttl: number;

  // === Input fields (copied from StartInput) ===

  /** Target entity ID to process */
  entity_id: string;

  /** Arke API base URL */
  api_base: string;

  /** Arke API key for authentication */
  api_key: string;

  /** Arke network (test or main) */
  network: 'test' | 'main';

  /** Target collection for output entities */
  collection?: string;

  /** Specific file key to process (per file-input-conventions.md) */
  target_file_key?: string;

  /** Processor-specific options */
  options?: Record<string, unknown>;

  // === Idempotency tracking ===

  /** Entity IDs created during processing (for retry safety) */
  created_entity_ids?: string[];
}

// =============================================================================
// HTTP Request/Response Types
// =============================================================================

/**
 * Input for POST /start endpoint
 */
export interface StartInput {
  /** Target entity ID to process */
  entity_id: string;

  /** Arke API base URL */
  api_base: string;

  /** Arke API key for authentication */
  api_key: string;

  /** Arke network (test or main) */
  network: 'test' | 'main';

  /** Target collection for output entities */
  collection?: string;

  /** Specific file key to process (per file-input-conventions.md) */
  target_file_key?: string;

  /** Processor-specific options */
  options?: Record<string, unknown>;
}

/**
 * Response from POST /start endpoint
 */
export interface StartResponse {
  success: true;
  job_id: string;
  status: 'pending';
}

/**
 * Response from GET /status/:job_id endpoint
 */
export interface StatusResponse<
  TProgress extends BaseProgress = BaseProgress,
  TResult extends BaseResult = BaseResult,
> {
  success: true;
  job_id: string;
  status: JobStatus;
  phase: string;
  progress: TProgress;
  result?: TResult;
  error?: JobError;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

/**
 * Error response from any endpoint
 */
export interface ErrorResponse {
  success: false;
  error: string;
}

// =============================================================================
// Lambda Event Types
// =============================================================================

/**
 * Lambda Function URL event structure
 */
export interface LambdaHttpEvent {
  requestContext: {
    http: {
      method: string;
      path: string;
    };
  };
  headers: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  rawPath?: string;
}

/**
 * Lambda response structure
 */
export interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Async invoke payload (for self-invocation)
 */
export interface AsyncInvokePayload {
  action: 'process';
  job_id: string;
}

// =============================================================================
// Process Context
// =============================================================================

/**
 * Context passed to the processJob function
 */
export interface ProcessContext<TJob extends BaseJob = BaseJob> {
  /** The job record from DynamoDB */
  job: TJob;

  /** Update job progress */
  updateProgress: (progress: Partial<TJob['progress']>) => Promise<void>;

  /** Update job status and phase */
  updateStatus: (status: JobStatus, phase: string) => Promise<void>;

  /** Complete the job with result */
  complete: (result?: TJob['result']) => Promise<void>;

  /** Fail the job with error */
  fail: (code: string, message: string) => Promise<void>;

  /** Append entity IDs to created_entity_ids for idempotency tracking */
  trackCreatedEntities: (entityIds: string[]) => Promise<void>;

  /** Get fresh job state from DynamoDB */
  refreshJob: () => Promise<TJob | null>;
}

// =============================================================================
// Process Result
// =============================================================================

/**
 * Result from processJob function
 */
export interface ProcessResult<TResult extends BaseResult = BaseResult> {
  /** Output entity IDs (for workflow handoff) */
  entity_ids?: string[];

  /** Full result object */
  result?: TResult;
}
