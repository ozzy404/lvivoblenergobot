#!/bin/bash
# Build script for WebApp - updates version hash in index.html

# Generate version based on current timestamp
VERSION=$(date +%Y%m%d%H%M%S)

# Update version in index.html
sed -i "s/\?v=[0-9]*/\?v=$VERSION/g" public/index.html

echo "✅ Updated version to: $VERSION"
echo "Files updated:"
grep -n "?v=" public/index.html
