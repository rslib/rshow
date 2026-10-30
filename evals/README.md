# rshow evals

`evals/run.py` mirrors the skills repo in a temp root, so the rshow skills compete with every other skill and nothing in that repo is touched.
The runner itself lives in a separate skills repo: set `SKILLS_REPO` to its checkout.

```bash
uv run evals/run.py triggers                # does the right skill load, and do the neighbors stay quiet
uv run evals/run.py outcome --skill rshow   # is a page better with the skill than without it
```

Results land in `evals/results/<stamp>/` and `uv run evals/run.py report <path>` prints the table, while `--check` builds the mirror and lists what would load with no model call.
