# Docs assets

## `demo.gif`

The README's hero animation: a real `argus run --mock`, start to finish.

It is generated from an actual run rather than staged. `scripts/capture-run.ts`
spawns the real CLI and records every stdout chunk together with the
millisecond offset it arrived at; `scripts/render_demo_gif.py` replays those
chunks onto a terminal-styled canvas. The pacing you see is the run's own
pacing, and the elapsed clock in the title bar shows true wall-clock time.

Regenerate it after any change to the CLI output:

```bash
rm -rf data generated-tests     # so the run files bugs as new, not duplicates
npm run demo:capture            # real run -> docs/run-capture.json
npm run demo:gif                # -> docs/demo.gif
```

Requires Python with Pillow (`pip install pillow`).

Notes:

- Long triage reasoning lines run to ~270 characters; the renderer soft-wraps
  them at the terminal width the way a real terminal would, instead of letting
  them clip at the right edge.
- Dead air during the Playwright stage is compressed so the loop stays around
  six seconds. The clock still reports real elapsed time, so the animation
  never implies the run was faster than it was.
- `capture-run.ts` silences npm's own warnings and notices. They come from the
  local npm configuration, not from Argus, and would otherwise open the
  recording with three lines of unrelated noise.

`run-capture.json` is committed alongside the GIF so the recording can be
re-rendered (different size, font, or pacing) without re-running the pipeline.
