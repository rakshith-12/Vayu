#!/usr/bin/env bash
echo "==================================================="
echo "Starting TrueForge Local Agent Server on Port 3000..."
echo "==================================================="

# Check for local trueforge cli installation or use npx
if command -v trueforge &> /dev/null; then
    trueforge --port 3000
else
    npx @truefoundry/trueforge --port 3000
fi
