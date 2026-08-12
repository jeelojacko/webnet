# Codex Instructions

Process ONLY the requested content job files in study-content\ai\runs\ai-map-4b1-pilot-s100-seed42/jobs using study-content/ai/specs/study-map-v2.md.
Write JSONL results to the matching file under results/, for example batch-001.results.jsonl.
Write only the requested result file(s). Use one JSON object per line.
Do not wrap JSONL in Markdown code fences. Do not add commentary to JSONL.
Do not modify application source code.
Do not edit prompt/spec/schema files.
Do not use external legal research or web browsing.
Do not use legal memory to supplement supplied source.
Preserve jobId, runId, inputHash, corpusContentHash, and promptSpecVersion.
Follow promptSpecVersion study-map-v2.
Resume by skipping jobIds that already have valid result lines.
Never rewrite valid existing result lines unless explicitly told to regenerate them.
