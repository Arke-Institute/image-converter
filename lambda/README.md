# Lambda File Processor Template

AWS Lambda template for Arke file processing with async job pattern.

## Features

- **Async job pattern**: POST /start returns immediately, poll GET /status/:id for progress
- **Arke SDK integration**: Entity/file operations, CAS-safe updates, relationships
- **File input conventions**: Type-agnostic processing, MIME type detection
- **DynamoDB state**: Job tracking with TTL auto-cleanup
- **SAM deployment**: Infrastructure as code with CloudFormation

## Quick Start

1. **Copy this template** to a new directory for your processor

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Customize `src/job.ts`**:
   - Define your accepted file types
   - Implement `processJob()` with your processing logic
   - Update progress types as needed

4. **Build**:
   ```bash
   npm run build
   ```

5. **Deploy**:
   ```bash
   STACK_NAME=my-processor PROCESSOR_NAME=my-processor ./scripts/deploy.sh
   ```

## API

### POST /start

Create a new processing job.

**Request**:
```json
{
  "entity_id": "ENTITY_ID",
  "api_base": "https://arke-v1.arke.institute",
  "api_key": "ak_xxx",
  "network": "test",
  "collection": "COLLECTION_ID",
  "target_file_key": "document.pdf",
  "options": { ... }
}
```

**Response**:
```json
{
  "success": true,
  "job_id": "job_ABC123",
  "status": "pending"
}
```

### GET /status/:job_id

Poll job status.

**Response**:
```json
{
  "success": true,
  "job_id": "job_ABC123",
  "status": "processing",
  "phase": "rendering",
  "progress": {
    "phase": "rendering",
    "pages_total": 10,
    "pages_processed": 5
  },
  "created_at": "2024-01-01T00:00:00.000Z",
  "updated_at": "2024-01-01T00:00:30.000Z"
}
```

**Job statuses**:
- `pending` - Job created, waiting to start
- `processing` - Job is running
- `done` - Job completed successfully
- `error` - Job failed

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DYNAMODB_TABLE` | Yes | DynamoDB table name for job state |
| `LAMBDA_SECRET` | Yes | Secret for authenticating requests |
| `AWS_REGION` | No | AWS region (default: us-east-1) |

### SAM Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `ProcessorName` | file-processor | Name for resources |
| `TableName` | (auto) | DynamoDB table name |
| `MemorySize` | 1024 | Lambda memory in MB |
| `Timeout` | 900 | Lambda timeout in seconds |

## File Structure

```
lambda-template/
├── src/
│   ├── index.ts              # Main handler (HTTP routing)
│   ├── job.ts                # Your processing logic (customize this)
│   ├── handlers/
│   │   ├── start.ts          # POST /start handler
│   │   ├── status.ts         # GET /status handler
│   │   └── process.ts        # Async processing handler
│   └── lib/
│       ├── types.ts          # Type definitions
│       ├── dynamo.ts         # DynamoDB helpers
│       ├── arke.ts           # Arke SDK helpers
│       └── file-utils.ts     # File detection/download
├── scripts/
│   ├── deploy.sh             # SAM deployment
│   └── create-table.sh       # Standalone DynamoDB setup
├── template.yaml             # SAM template
├── package.json
├── tsconfig.json
└── README.md
```

## Customization Guide

### 1. Define File Types

In `src/job.ts`, import and configure accepted file types:

```typescript
import { PDF_FILTER, validateFileSize } from './lib/file-utils.js';

const ACCEPTED_TYPES = PDF_FILTER;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
```

### 2. Define Progress Types

Extend the base progress type for your processor:

```typescript
interface MyProgress extends BaseProgress {
  phase: 'downloading' | 'processing' | 'uploading' | 'complete';
  items_total?: number;
  items_processed?: number;
}
```

### 3. Implement Processing

In `processJob()`:

```typescript
export async function processJob(ctx: ProcessContext): Promise<ProcessResult> {
  const { job } = ctx;
  const client = createArkeClient(job);

  // 1. Get target entity
  const entity = await getEntity(client, job.entity_id);

  // 2. Resolve and download file
  const file = resolveTargetFile(entity, job.target_file_key, ACCEPTED_TYPES);
  validateFileSize(file, MAX_FILE_SIZE, 'my-processor');
  const content = await downloadEntityFile(client, entity.id, file.key);

  // 3. Process
  await ctx.updateProgress({ phase: 'processing', items_total: 10 });
  const outputs = await myProcessingFunction(content);

  // 4. Track for idempotency
  await ctx.trackCreatedEntities(outputs.map(o => o.id));

  // 5. Return result
  return {
    entity_ids: outputs.map(o => o.id),
    result: { entity_ids: outputs.map(o => o.id), count: outputs.length },
  };
}
```

### 4. Add Lambda Layers

For processors needing native binaries (e.g., Ghostscript, Sharp), add layers to `template.yaml`:

```yaml
Layers:
  - !Sub arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:layer:ghostscript:1
```

## Testing

### Local Testing

```bash
# Build
npm run build

# Test with SAM local (requires Docker)
sam local invoke -e test/event.json
```

### Integration Testing

```bash
# Start job
curl -X POST https://your-lambda.lambda-url.us-east-1.on.aws/start \
  -H "Content-Type: application/json" \
  -H "X-Lambda-Secret: your-secret" \
  -d '{
    "entity_id": "ENTITY_ID",
    "api_base": "https://arke-v1.arke.institute",
    "api_key": "ak_xxx",
    "network": "test"
  }'

# Poll status
curl https://your-lambda.lambda-url.us-east-1.on.aws/status/job_ABC123 \
  -H "X-Lambda-Secret: your-secret"
```

## Related

- [File Input Conventions](../arke-kladoi/file-processing/docs/file-input-conventions.md)
- [klados-do-template](../klados-do-template/) - Cloudflare Worker that polls this Lambda
- [@arke-institute/sdk](https://github.com/arke-institute/sdk) - Arke API client
