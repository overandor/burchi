# YTL_MCP.md — YouTube Automation Research Lab

## Principle

**This is a compliant research and production lab, not a spam or engagement bot.**

## Prohibited

- Spam bot
- Fake engagement
- Scraping abuse
- Quota evasion
- Copyright reupload
- Misleading metadata

## Safe Flow

```
idea → research query → dataset → transcript/frame analysis → hypothesis
→ script → asset plan → policy check → human approval
→ private/unlisted upload package → metrics → learning loop → receipt
```

## Components

| Component | Purpose |
|-----------|---------|
| Research Query | Search YouTube Data API v3 for relevant videos |
| Transcript Analysis | Extract and analyze transcripts via YouTube Transcript API |
| Metadata Analysis | Analyze video tags, descriptions, categories |
| Hypothesis Generator | Generate content hypotheses from research |
| Script Generator | Generate scripts from approved hypotheses |
| Shotlist Generator | Generate shot lists from scripts |
| Asset Planner | Plan assets needed for production |
| Policy Checker | Check against YouTube policies before upload |
| Human Approval Gate | All uploads require explicit human approval |
| Upload Package | Prepare metadata, thumbnail, tags for upload |
| Analytics Review | Review performance metrics post-upload |
| Learning Loop | Feed metrics back into hypothesis generation |
| Receipt | Every step produces a receipt in HyperFlow ledger |

## MCP Integration

Controlled via MCP tools:
- `ytl.research` — search and gather dataset
- `ytl.transcript` — extract transcript
- `ytl.hypothesis` — generate hypothesis
- `ytl.script` — generate script
- `ytl.policy_check` — run policy check
- `ytl.upload_package` — prepare upload (requires human approval)

## Implementation Status

- Spec: Complete (this document)
- Implementation: Spec complete, awaiting implementation phase
