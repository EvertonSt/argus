# Docs assets

`demo.gif` — a terminal recording of `npm run run:mock` running start to finish,
referenced at the top of the README.

To record one:

```bash
# asciinema (then upload, or convert with agg)
asciinema rec demo.cast -c "npm run run:mock"
agg demo.cast demo.gif

# or any screen recorder cropped to the terminal
```

Keep it under ~8MB so it loads on the GitHub README, and start the recording
from a clean state (`rm -rf data generated-tests`) so the run shows the full
pipeline rather than a cached one.
