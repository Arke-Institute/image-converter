#!/bin/bash
set -e

# Configuration
FUNCTION_NAME="arke-image-converter"
REGION="${AWS_REGION:-us-east-1}"
MEMORY_SIZE=1024
TIMEOUT=300  # 5 minutes
RUNTIME="nodejs20.x"
ARCHITECTURE="arm64"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Building Lambda function...${NC}"

# Navigate to lambda directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAMBDA_DIR="$(dirname "$SCRIPT_DIR")"
cd "$LAMBDA_DIR"

# Clean previous build
rm -rf dist lambda.zip node_modules

# Clean any previous lock file issues
rm -f package-lock.json

# Remove Linux-specific sharp packages from package.json before install (they break on macOS)
if grep -q "@img/sharp-linux" package.json 2>/dev/null; then
  echo -e "${YELLOW}Removing Linux-specific packages from package.json...${NC}"
  node -e "
    const pkg = require('./package.json');
    delete pkg.dependencies['@img/sharp-linux-arm64'];
    delete pkg.dependencies['@img/sharp-libvips-linux-arm64'];
    require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  "
fi

# Install dependencies
echo -e "${YELLOW}Installing dependencies...${NC}"
npm install --ignore-scripts

# For sharp on Lambda arm64, we need the Linux binary + libvips
# Download the tarballs directly (npm install ignores --cpu/--os on macOS)
echo -e "${YELLOW}Downloading sharp for Linux arm64...${NC}"
npm pack @img/sharp-linux-arm64@0.33.5 @img/sharp-libvips-linux-arm64@1.0.4 2>/dev/null

# Extract to node_modules/@img/
mkdir -p node_modules/@img/sharp-linux-arm64
mkdir -p node_modules/@img/sharp-libvips-linux-arm64
tar -xzf img-sharp-linux-arm64-0.33.5.tgz -C node_modules/@img/sharp-linux-arm64 --strip-components=1
tar -xzf img-sharp-libvips-linux-arm64-1.0.4.tgz -C node_modules/@img/sharp-libvips-linux-arm64 --strip-components=1
rm -f img-sharp-*.tgz

# Build TypeScript
echo -e "${YELLOW}Bundling code...${NC}"
npx esbuild src/index.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --outfile=dist/index.js \
  --format=cjs \
  --external:sharp \
  --external:@aws-sdk/* \
  --minify

# Create deployment package
echo -e "${YELLOW}Creating deployment package...${NC}"
mkdir -p dist/node_modules

# Copy sharp and its dependencies
cp -r node_modules/sharp dist/node_modules/
cp -r node_modules/detect-libc dist/node_modules/
cp -r node_modules/semver dist/node_modules/ 2>/dev/null || true
cp -r node_modules/color dist/node_modules/ 2>/dev/null || true
cp -r node_modules/color-convert dist/node_modules/ 2>/dev/null || true
cp -r node_modules/color-name dist/node_modules/ 2>/dev/null || true
cp -r node_modules/color-string dist/node_modules/ 2>/dev/null || true
cp -r node_modules/simple-swizzle dist/node_modules/ 2>/dev/null || true
cp -r node_modules/is-arrayish dist/node_modules/ 2>/dev/null || true

# Copy only Linux arm64 sharp binaries (not macOS)
mkdir -p dist/node_modules/@img
cp -r node_modules/@img/sharp-linux-arm64 dist/node_modules/@img/ 2>/dev/null || true
cp -r node_modules/@img/sharp-libvips-linux-arm64 dist/node_modules/@img/ 2>/dev/null || true

# Remove any macOS binaries that might have been copied
rm -rf dist/node_modules/@img/sharp-darwin-* 2>/dev/null || true
rm -rf dist/node_modules/@img/sharp-libvips-darwin-* 2>/dev/null || true

# Create zip
cd dist
zip -r ../lambda.zip index.js node_modules
cd ..

echo -e "${GREEN}Package created: lambda.zip ($(du -h lambda.zip | cut -f1))${NC}"

# Update existing function
echo -e "${YELLOW}Updating function...${NC}"
aws lambda update-function-code \
  --function-name "$FUNCTION_NAME" \
  --zip-file fileb://lambda.zip \
  --region "$REGION"

# Wait for update to complete
echo -e "${YELLOW}Waiting for update to complete...${NC}"
aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"

# Get function URL
echo -e "${YELLOW}Getting function URL...${NC}"
FUNCTION_URL=$(aws lambda get-function-url-config \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --query 'FunctionUrl' \
  --output text 2>/dev/null || echo "")

if [ -n "$FUNCTION_URL" ]; then
  echo -e "${GREEN}Function URL: ${FUNCTION_URL}${NC}"
fi

echo ""
echo -e "${GREEN}Deployment complete!${NC}"
