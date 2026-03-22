# DeepSeek Bridge Skill

## Purpose
Route all thinking and reasoning through DeepSeek R1 running locally via Ollama.

## How to use this skill
When you need to think, reason, plan, or get answers — use this command:
```bash
curl -s http://172.26.240.1:11434/api/generate \
  -d "{\"model\":\"deepseek-r1:7b\",\"prompt\":\"YOUR_PROMPT_HERE\",\"stream\":false}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['response'])"
```

Replace YOUR_PROMPT_HERE with your actual question or task.

## When to use
- Before making any decision
- When planning how to approach a coding task
- When you need to reason through a problem
- When VJ asks you a question you need to think about

## Important
Always use this skill to think before acting.
DeepSeek is your brain. You are the hands.
