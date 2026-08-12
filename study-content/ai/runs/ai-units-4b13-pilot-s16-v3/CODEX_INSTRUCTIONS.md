# Codex Instructions

Process ONLY the requested content job files in study-content\ai\runs\ai-units-4b13-pilot-s16-v3/jobs using study-content/ai/specs/unit-authoring-v3.md.
Write JSONL results to the matching file under results/, for example batch-001.results.jsonl.
Write only the requested result file(s). Use one JSON object per line.
Do not wrap JSONL in Markdown code fences. Do not add commentary to JSONL.
Do not modify application source code.
Do not edit prompt/spec/schema files.
Do not use external legal research or legal memory.
Do not browse web/external legal sources.
Do not use legal memory to supplement supplied source.
The approvedGroup is the AUTHORING SOURCE. The context block is CONTEXT FOR UNDERSTANDING ONLY.
Do not author objectives or study answers from context-only law or unselected sibling focus.
Preserve jobId, runId, inputHash, corpusContentHash, and promptSpecVersion.
Follow promptSpecVersion unit-authoring-v3.
Keep official source, AI study answers, and inference notes separate.
Resume by skipping jobIds that already have valid result lines.
Never rewrite valid existing result lines unless explicitly told to regenerate them.
