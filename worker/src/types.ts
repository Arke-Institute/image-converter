/**
 * Type definitions for the Image Converter worker
 */

/**
 * Cloudflare Worker environment bindings
 */
export interface Env {
  /** Klados agent ID (registered in Arke) */
  AGENT_ID: string;

  /** Agent version for logging */
  AGENT_VERSION: string;

  /** Arke agent API key (secret) */
  ARKE_AGENT_KEY: string;

  /** Lambda function URL */
  LAMBDA_URL: string;

  /** Lambda authentication secret */
  LAMBDA_SECRET: string;

  /** Verification token for endpoint verification (set during registration) */
  VERIFICATION_TOKEN?: string;

  /** Agent ID for verification (used before AGENT_ID is configured) */
  ARKE_VERIFY_AGENT_ID?: string;

  /** Durable Object binding for job processing */
  KLADOS_JOB: DurableObjectNamespace;
}

/**
 * Image conversion options passed via input properties
 */
export interface ImageOptions {
  /** JPEG quality 1-100 (default: 85) */
  quality?: number;

  /** Output key for the JPEG file (default: "jpeg") */
  output_key?: string;
}

/**
 * Properties of the target entity being processed
 */
export interface TargetProperties {
  /** Specific file key to process (per file-input-conventions.md) */
  target_file_key?: string;

  /** Image conversion options */
  options?: ImageOptions;

  /** Allow any additional properties */
  [key: string]: unknown;
}

/**
 * Properties for output entities
 * Note: For image-converter, we modify the same entity (add JPEG content)
 * so output is the same entity ID
 */
export interface OutputProperties {
  /** Source entity ID (same as input since we add to same entity) */
  entity_id: string;

  /** Output key for the JPEG file */
  output_key: string;

  /** Source image format */
  source_format: string;

  /** Image width in pixels */
  width?: number;

  /** Image height in pixels */
  height?: number;

  /** JPEG file size in bytes */
  size_bytes?: number;

  /** Whether conversion was skipped (source already JPEG) */
  skipped?: boolean;

  /** Reason for skipping */
  reason?: string;

  /** Allow any additional properties */
  [key: string]: unknown;
}
