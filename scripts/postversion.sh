#!/usr/bin/env bash
# Auto-update Dockerfile.api with the new version after `npm version`
set -e

NEW_VERSION=$(node -e "console.log(require('./package.json').version)")
echo "Updating Dockerfile.api to webpeel@${NEW_VERSION}..."

# Replace the version-pinned line
sed -i.bak "s|RUN npm install webpeel@[0-9.]*|RUN npm install webpeel@${NEW_VERSION}|g" Dockerfile.api
rm -f Dockerfile.api.bak

echo "✅ Dockerfile.api updated to webpeel@${NEW_VERSION}"
