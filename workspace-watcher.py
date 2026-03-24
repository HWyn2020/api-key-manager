#!/usr/bin/env python3
"""
Workspace Watcher
Monitors INBOX.md for changes and auto-triggers Claude Code
"""
import subprocess
import time
import hashlib
import os

WORKDIR = "/home/henry/workspace/api-key-manager"
INBOX = f"{WORKDIR}/INBOX.md"
CLAUDE = "/mnt/c/Users/henry/AppData/Roaming/npm/claude"
LOG = f"{WORKDIR}/claude-code.log"

def get_hash(filepath):
    try:
        with open(filepath, 'rb') as f:
            return hashlib.md5(f.read()).hexdigest()
    except:
        return None

def trigger_claude():
    print(f"[Watcher] INBOX.md changed - triggering Claude Code...")
    with open(LOG, 'a') as log:
        log.write(f"\n[Watcher] INBOX.md updated - Claude Code triggered\n")
    
    subprocess.Popen(
        f"cat {INBOX} | {CLAUDE} --dangerously-skip-permissions >> {LOG} 2>&1",
        shell=True,
        cwd=WORKDIR
    )

print(f"[Watcher] Monitoring {INBOX}...")
last_hash = get_hash(INBOX)

while True:
    time.sleep(3)
    current_hash = get_hash(INBOX)
    if current_hash and current_hash != last_hash:
        last_hash = current_hash
        trigger_claude()
