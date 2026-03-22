#!/usr/bin/env python3
"""
Gumball Signal Bridge - Async Architecture
Receive loop never blocks. LLM runs in background thread.
When ready, pushes response through signal-cli independently.
"""
import subprocess
import json
import time
import requests
import threading

SIGNAL_CLI = "signal-cli"
PHONE = "+19126556636"
OPENCLAW_URL = "http://127.0.0.1:18789"
TOKEN = "fcae0e51404599399b37f2b51291ec9079771b5f43c8cb965b95573f5b1f3f07"
POLL_INTERVAL = 3

def receive_messages():
    try:
        result = subprocess.run(
            [SIGNAL_CLI, "-o", "json", "-a", PHONE, "receive",
             "--ignore-attachments", "--ignore-stories",
             "-t", "3"],
            capture_output=True, text=True, timeout=10
        )
        messages = []
        for line in result.stdout.strip().split("\n"):
            if line:
                try:
                    messages.append(json.loads(line))
                except:
                    pass
        return messages
    except Exception as e:
        print(f"Receive error: {e}")
        return []

def extract_note_to_self(msgs):
    results = []
    for msg in msgs:
        try:
            sent = msg.get("envelope", {}).get("syncMessage", {}).get("sentMessage", {})
            if sent.get("destination") == PHONE:
                text = sent.get("message", "")
                if text:
                    results.append(text)
        except:
            pass
    return results

def send_signal(text):
    try:
        subprocess.run(
            [SIGNAL_CLI, "-a", PHONE, "send", "-m", text, PHONE],
            capture_output=True, timeout=15
        )
        print(f"Sent: {text[:80]}...")
    except Exception as e:
        print(f"Send error: {e}")

def ask_gumball_async(text):
    def worker():
        print(f"Gumball thinking... (no timeout, will respond when ready)")
        try:
            resp = requests.post(
                f"{OPENCLAW_URL}/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {TOKEN}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "openclaw",
                    "messages": [{"role": "user", "content": text}]
                },
                timeout=None
            )
            data = resp.json()
            reply = data["choices"][0]["message"]["content"]
            print(f"Gumball responded, pushing to Signal...")
            send_signal(reply)
        except Exception as e:
            print(f"Gumball error: {e}")

    t = threading.Thread(target=worker, daemon=True)
    t.start()

print("Gumball Signal Bridge started. Async mode — no timeouts.")
while True:
    msgs = receive_messages()
    texts = extract_note_to_self(msgs)
    for text in texts:
        print(f"Received: {text}")
        ask_gumball_async(text)
    time.sleep(POLL_INTERVAL)
