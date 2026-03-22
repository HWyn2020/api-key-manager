#!/bin/bash
# Claude Code Skill - Shared Workspace Mode
CLAUDE="/mnt/c/Users/henry/AppData/Roaming/npm/claude"
WORKDIR="${1:-/home/henry/workspace/api-key-manager}"
LOG="$WORKDIR/claude-code.log"
INBOX="$WORKDIR/INBOX.md"
OUTBOX="$WORKDIR/OUTBOX.md"

echo "[$(date)] Claude Code starting in $WORKDIR" | tee -a "$LOG"

if [ ! -f "$INBOX" ]; then
  echo "[$(date)] ERROR: No INBOX.md found" | tee -a "$LOG"
  exit 1
fi

echo "[$(date)] Reading INBOX..." | tee -a "$LOG"
cat "$INBOX" >> "$LOG"

cd "$WORKDIR"
cat "$INBOX" | $CLAUDE --dangerously-skip-permissions 2>&1 | tee -a "$LOG"

EXIT_CODE=${PIPESTATUS[0]}

echo "[$(date)] Task complete. Exit: $EXIT_CODE" | tee -a "$LOG"
echo "[$(date)] Files in workspace:" | tee -a "$LOG"
find "$WORKDIR" -type f | sort | tee -a "$LOG"

if [ $EXIT_CODE -eq 0 ]; then
  echo "[$(date)] SUCCESS" | tee -a "$LOG"
else
  echo "[$(date)] FAILED - exit code $EXIT_CODE" | tee -a "$LOG"
fi
