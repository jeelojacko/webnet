# Circle v1 Browser QA (production build, headless Chromium)

Spec: `tests-browser/cad-draw-circle-v1.spec.ts`, 5/5 green, 0 page errors,
0 console errors. Blank disposable drawings; evidence under
`docs/evidence/cad-draw-circle-v1/` (PNGs + `geometry.json`).

- A (ribbon truth): Circle face enabled ("Circle: Center, Radius"), CR/CD
  flyout rows runnable with correct command mapping, others planned.
- B (CR click flow): center pick, live circle preview (1 preview-circle),
  opposite pick commits, entity selected, exactly 2 grips; saved entity has
  no arc sweep fields.
- C (CD typed): center (0,0) + diameter 30 → center unmoved, radius 15.
- D (invalid/cancel): Esc with no picks, zero-diameter typed input, and
  post-cancel Esc all leave entity count at 0.
- E (save/reopen): CR + CD circles saved, drawing reloaded from file,
  all entities return with identical id/type/center/radius.

No browser behavior is claimed beyond what these flows exercise.
