# WebNet CAD Field-to-Finish

## Purpose
Describe the future field-to-finish direction for Survey CAD.

## Goals
- feature-code libraries
- point style and symbol mapping
- auto-linework and figure control
- breakline/surface participation flags
- auditable import report

## Suggested library capabilities
- code aliases
- symbol/style/layer mapping
- figure begin/continue/end behavior
- curve instructions
- label rules
- breakline and surface inclusion
- import profile overrides by collector format

## Workflow sketch

```txt
raw point/collector data
  -> normalize codes
  -> apply feature library
  -> create points, figures, symbols, labels, breaklines
  -> optional surface input set
  -> import report
```
