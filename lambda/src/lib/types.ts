/**
 * Type definitions for Image Converter Lambda
 */

import type { BaseJob, BaseProgress, BaseResult } from './base-types.js';

// =============================================================================
// Image Formats
// =============================================================================

export const SUPPORTED_FORMATS = ['tiff', 'png', 'webp', 'avif', 'gif', 'jpeg', 'jpg'] as const;
export type SupportedFormat = (typeof SUPPORTED_FORMATS)[number];

// =============================================================================
// Image Progress
// =============================================================================

export interface ImageProgress extends BaseProgress {
  phase: 'downloading' | 'converting' | 'uploading' | 'complete' | 'skipped';
}

// =============================================================================
// Image Result
// =============================================================================

export interface ImageResult extends BaseResult {
  entity_id: string;
  entity_ids: string[];  // Output entity IDs for workflow handoff
  output_key?: string;
  source_format: SupportedFormat;
  width?: number;
  height?: number;
  size_bytes?: number;
  skipped?: boolean;
  reason?: string;
}

// =============================================================================
// Image Job
// =============================================================================

export interface ImageJob extends BaseJob<ImageProgress, ImageResult> {
  /** JPEG quality (1-100, default 85) */
  quality: number;

  /** Output key for JPEG file (default "jpeg") */
  output_key: string;
}

// =============================================================================
// File Info
// =============================================================================

export interface FileInfo {
  key: string;
  content_type?: string;
  size?: number;
}

export interface FileTypeFilter {
  mimeTypes: string[];
  extensions: string[];
}

// =============================================================================
// Entity with Content
// =============================================================================

export interface EntityWithContent {
  id: string;
  type: string;
  properties: {
    content?: Record<string, {
      cid: string;
      content_type: string;
      size: number;
      uploaded_at: string;
    }>;
    [key: string]: unknown;
  };
}

// Re-export base types
export type {
  JobStatus,
  JobError,
  BaseProgress,
  BaseResult,
  BaseJob,
  StartInput,
  StartResponse,
  StatusResponse,
  ErrorResponse,
  LambdaHttpEvent,
  LambdaResponse,
  AsyncInvokePayload,
  ProcessContext,
  ProcessResult,
} from './base-types.js';
