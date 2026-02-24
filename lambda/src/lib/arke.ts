/**
 * Arke SDK helpers for file processing
 *
 * Provides ArkeClient factory and common entity/file operations.
 */

import { ArkeClient } from '@arke-institute/sdk';
import type { BaseJob } from './types.js';

// =============================================================================
// Client Factory
// =============================================================================

/**
 * Create ArkeClient from job credentials
 */
export function createArkeClient(job: BaseJob): ArkeClient {
  return new ArkeClient({
    baseUrl: job.api_base,
    authToken: job.api_key,
    network: job.network,
  });
}

// =============================================================================
// Entity Operations
// =============================================================================

/**
 * Get entity by ID
 */
export async function getEntity(
  client: ArkeClient,
  entityId: string
): Promise<{
  id: string;
  cid: string;
  type: string;
  properties: Record<string, unknown>;
  relationships?: Array<{ predicate: string; peer: string; peer_type?: string }>;
}> {
  const { data, error } = await client.api.GET('/entities/{id}', {
    params: { path: { id: entityId } },
  });

  if (error || !data) {
    throw new Error(`Failed to get entity ${entityId}: ${JSON.stringify(error)}`);
  }

  return {
    id: data.id,
    cid: data.cid,
    type: data.type,
    properties: (data.properties as Record<string, unknown>) || {},
    relationships: data.relationships as Array<{ predicate: string; peer: string; peer_type?: string }> | undefined,
  };
}

/**
 * Get entity tip (CID) for CAS-safe updates
 */
export async function getEntityTip(
  client: ArkeClient,
  entityId: string
): Promise<string> {
  const { data, error } = await client.api.GET('/entities/{id}/tip', {
    params: { path: { id: entityId } },
  });

  if (error || !data) {
    throw new Error(`Failed to get tip for ${entityId}: ${JSON.stringify(error)}`);
  }

  return data.cid;
}

/**
 * Create entity with optional relationships
 */
export async function createEntity(
  client: ArkeClient,
  params: {
    type: string;
    collection?: string;
    properties?: Record<string, unknown>;
    relationships?: Array<{
      predicate: string;
      peer: string;
      peer_type?: string;
    }>;
  }
): Promise<{ id: string; cid: string }> {
  const { data, error } = await client.api.POST('/entities', {
    body: {
      type: params.type,
      collection: params.collection,
      properties: params.properties,
      relationships: params.relationships,
    },
  });

  if (error || !data) {
    throw new Error(`Failed to create entity: ${JSON.stringify(error)}`);
  }

  return { id: data.id, cid: data.cid };
}

/**
 * Update entity with CAS safety (auto-retry on conflict)
 */
export async function updateEntity(
  client: ArkeClient,
  entityId: string,
  updates: {
    properties?: Record<string, unknown>;
    relationships_add?: Array<{
      predicate: string;
      peer: string;
      peer_type?: string;
    }>;
    relationships_remove?: Array<{
      predicate: string;
      peer: string;
    }>;
  },
  maxRetries: number = 3
): Promise<void> {
  let cid = await getEntityTip(client, entityId);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { error } = await client.api.PUT('/entities/{id}', {
      params: { path: { id: entityId } },
      body: {
        expect_tip: cid,
        ...updates,
      },
    });

    if (!error) return;

    const errorStr = JSON.stringify(error);
    const isConflict = errorStr.includes('409') ||
      errorStr.includes('Conflict') ||
      errorStr.includes('cas') ||
      errorStr.includes('expect_tip');

    if (isConflict && attempt < maxRetries - 1) {
      console.log(`[arke] CAS conflict updating ${entityId}, retrying (${attempt + 1}/${maxRetries})...`);
      cid = await getEntityTip(client, entityId);
      const delay = Math.pow(2, attempt) * 200 + Math.random() * 200;
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }

    throw new Error(`Failed to update entity ${entityId}: ${errorStr}`);
  }
}

// =============================================================================
// File Operations
// =============================================================================

/**
 * Create file entity
 */
export async function createFileEntity(
  client: ArkeClient,
  params: {
    filename: string;
    contentType: string;
    size: number;
    collection?: string;
    properties?: Record<string, unknown>;
    relationships?: Array<{
      predicate: string;
      peer: string;
      peer_type?: string;
    }>;
  }
): Promise<{ id: string; cid: string }> {
  const key = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const { data, error } = await client.api.POST('/files', {
    body: {
      key,
      filename: params.filename,
      content_type: params.contentType,
      size: params.size,
      label: params.filename,
      collection: params.collection,
      properties: params.properties,
      relationships: params.relationships,
    },
  });

  if (error || !data) {
    throw new Error(`Failed to create file entity: ${JSON.stringify(error)}`);
  }

  return { id: data.id, cid: data.cid };
}

/**
 * Upload content to file entity
 */
export async function uploadFileContent(
  client: ArkeClient,
  fileId: string,
  content: Buffer,
  contentType: string
): Promise<void> {
  const { error } = await client.uploadFileContent(fileId, content, contentType);

  if (error) {
    throw new Error(`Failed to upload file content: ${JSON.stringify(error)}`);
  }
}

/**
 * Download file content
 */
export async function downloadFileContent(
  client: ArkeClient,
  fileId: string
): Promise<Buffer> {
  const { data, error } = await client.getFileContentAsArrayBuffer(fileId);

  if (error || !data) {
    throw new Error(`Failed to download file: ${JSON.stringify(error)}`);
  }

  return Buffer.from(data);
}

/**
 * Create file entity and upload content in one operation
 */
export async function createAndUploadFile(
  client: ArkeClient,
  params: {
    filename: string;
    content: Buffer;
    contentType: string;
    collection?: string;
    properties?: Record<string, unknown>;
    relationships?: Array<{
      predicate: string;
      peer: string;
      peer_type?: string;
    }>;
  }
): Promise<{ id: string; cid: string }> {
  // Create file entity
  const { id } = await createFileEntity(client, {
    filename: params.filename,
    contentType: params.contentType,
    size: params.content.length,
    collection: params.collection,
    properties: params.properties,
    relationships: params.relationships,
  });

  // Upload content
  await uploadFileContent(client, id, params.content, params.contentType);

  // Get updated CID after upload
  const cid = await getEntityTip(client, id);

  return { id, cid };
}

/**
 * Upload content to existing entity (adds file to same entity)
 *
 * Uses POST /entities/{id}/content?key={key} to add content to entity.
 * This is the key operation for image-converter - adds JPEG to same entity
 * rather than creating a new entity.
 */
export async function uploadContentToEntity(
  apiBase: string,
  apiKey: string,
  params: {
    entityId: string;
    key: string;
    content: Buffer;
    contentType: string;
    network: 'test' | 'main';
  }
): Promise<void> {
  const url = `${apiBase}/entities/${params.entityId}/content?key=${encodeURIComponent(params.key)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `ApiKey ${apiKey}`,
      'X-Arke-Network': params.network,
      'Content-Type': params.contentType,
    },
    body: params.content,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to upload content to entity ${params.entityId} with key '${params.key}': ` +
      `${response.status} ${response.statusText} - ${text}`
    );
  }

  console.log(`[arke] Uploaded content to entity ${params.entityId} with key '${params.key}' (${params.content.length} bytes)`);
}

// =============================================================================
// Relationship Operations
// =============================================================================

/**
 * Create bidirectional relationship between two entities
 */
export async function createBidirectionalRelationship(
  client: ArkeClient,
  params: {
    sourceId: string;
    targetId: string;
    sourcePredicate: string;  // e.g., 'derived_from'
    targetPredicate: string;  // e.g., 'has_derivative'
  },
  maxRetries: number = 3
): Promise<void> {
  let [sourceCid, targetCid] = await Promise.all([
    getEntityTip(client, params.sourceId),
    getEntityTip(client, params.targetId),
  ]);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { error } = await client.api.POST('/relationships', {
      body: {
        source_id: params.sourceId,
        target_id: params.targetId,
        source_predicate: params.sourcePredicate,
        target_predicate: params.targetPredicate,
        expect_source_tip: sourceCid,
        expect_target_tip: targetCid,
      },
    });

    if (!error) return;

    const errorStr = JSON.stringify(error);
    const isConflict = errorStr.includes('409') ||
      errorStr.includes('Conflict') ||
      errorStr.includes('cas') ||
      errorStr.includes('expect_tip');

    if (isConflict && attempt < maxRetries - 1) {
      console.log(`[arke] CAS conflict creating relationship, retrying (${attempt + 1}/${maxRetries})...`);
      [sourceCid, targetCid] = await Promise.all([
        getEntityTip(client, params.sourceId),
        getEntityTip(client, params.targetId),
      ]);
      const delay = Math.pow(2, attempt) * 200 + Math.random() * 200;
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }

    throw new Error(`Failed to create relationship: ${errorStr}`);
  }
}

/**
 * Add relationship to entity (one direction only)
 */
export async function addRelationship(
  client: ArkeClient,
  entityId: string,
  relationship: {
    predicate: string;
    peer: string;
    peer_type?: string;
  }
): Promise<void> {
  await updateEntity(client, entityId, {
    relationships_add: [relationship],
  });
}
