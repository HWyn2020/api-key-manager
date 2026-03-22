## Documentation Standard — Every Project

Every project Gumball manages must have a `/docs` folder at the root level.

### Required Documentation Files

**`/docs/MISSION.md`**
- What this project is trying to accomplish
- The problem it solves
- Who it serves
- The vision for where it's going

**`/docs/ARCHITECTURE.md`**
- How the system is built
- What each component does
- How components talk to each other
- Technology stack and why each was chosen

**`/docs/VULNERABILITIES.md`**
- Every vulnerability found during Red Team Testing
- Which Red Team found it (RT1/RT2/RT3/RT4)
- Severity level (Critical/High/Medium/Low)
- How it was patched
- Retest confirmation

**`/docs/CHANGELOG.md`**
- Every change made to the codebase
- What was changed and why
- Who made the change (Claude Code/Gumball)
- Date and version

**`/docs/TESTS.md`**
- Every test written
- What it tests
- Pass/fail history
- Current status

**`/docs/HANDOFF.md`**
- Everything a new developer needs to know
- How to set up the project locally
- Environment variables needed
- How to run tests
- Known issues and limitations

### Gumball's Documentation Responsibility
- Create the /docs folder at the start of every project
- Instruct Claude Code to update documentation with every change
- Never approve code that isn't documented
- Before reporting completion to VJ — verify all docs are current
- When pushing to GitHub — docs go with it. Always.

**A project without documentation is an incomplete project. No exceptions.**
