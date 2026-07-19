#!/bin/bash

HANDOFF_FILE=".claude/handoff/current.json"

echo "Running /continua..."

OUTPUT=$(claude "/continua")

echo "$OUTPUT"

# Check that the handoff exists
if [ ! -f "$HANDOFF_FILE" ]; then
  echo "Error: handoff not found"
  exit 1
fi

echo "Handoff found. Restarting Claude..."

# New session (equivalent to clear)
claude "/ripristina"