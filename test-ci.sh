#!/bin/bash
set -e

echo "Starting CI Pipeline for hexnest-node"

echo "Installing all dependencies..."
npm ci

echo "Running tests..."
npm run test

echo "Pruning dev dependencies for production build..."
npm ci --omit=dev
