# Codex Instructions

Process ONLY the requested content job files in study-content\ai\runs\ai-units-4b21-expanded-s48-v4fix/jobs using study-content/ai/specs/unit-authoring-v4.md.
Write JSONL results to the matching file under results/, for example batch-001.results.jsonl.
Write one JSON object per line and no Markdown fences.
Use genuine per-job legal/educational reasoning from the supplied approvedGroup focus.
Do not use deterministic templates for main questions, guided questions, study answers, or mapRevisionSuggestion prose.
Do not use fixed-length source substrings or append ellipses because a limit was reached.
Definition objectives must answer the actual defined term, not the generic definitions-section preamble.
The approvedGroup is the AUTHORING SOURCE. Context is for understanding only.
Do not browse, use outside legal research, or add legal memory.
Preserve jobId as proposalId or generationMetadata.sourceJobId, runId, corpusContentHash, promptSpecVersion, and inputHash in generationMetadata.sourceJobInputHash.
