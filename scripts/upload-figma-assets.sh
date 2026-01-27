#!/bin/bash

# Upload Figma assets to S3 for USQC26 card designs
# Note: Figma MCP returns SVGs which browsers can render as images
# Usage: ./scripts/upload-figma-assets.sh

set -e

BUCKET="trading-card-app-austin-mediabucket-urnrnefs"
AWS_PROFILE="prod"
ASSETS_DIR="/tmp/usqc26-assets"

mkdir -p "$ASSETS_DIR"

echo "Downloading Figma assets (SVG format)..."

# Camera icon (from get_design_context)
curl -sL "https://www.figma.com/api/mcp/asset/2b4d274a-7f28-4e9a-8ee6-91c8c0df6081" -o "$ASSETS_DIR/camera-icon.svg"

echo "Verifying downloaded files..."
for f in "$ASSETS_DIR"/*; do
  if [ -f "$f" ]; then
    size=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null)
    echo "  $(basename "$f"): $size bytes"
  fi
done

echo "Uploading to S3..."

# Upload SVG assets
AWS_PROFILE=$AWS_PROFILE aws s3 cp "$ASSETS_DIR/camera-icon.svg" "s3://$BUCKET/config/overlays/camera-icon.svg" --content-type "image/svg+xml"

echo "Done! Uploaded assets:"
AWS_PROFILE=$AWS_PROFILE aws s3 ls "s3://$BUCKET/config/overlays/"

# Cleanup
rm -rf "$ASSETS_DIR"

echo ""
echo "Note: Frame overlays are drawn programmatically in the renderer."
echo "The frame shape uses a rounded rectangle with inner cutout."
