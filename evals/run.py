#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Run the rshow evals through the skills repo runner, from a throwaway mirror.

  uv run evals/run.py triggers [--split train|val] [--skill NAME] [--runs N]
  uv run evals/run.py outcome  [--skill NAME] [--runs N]
  uv run evals/run.py --check triggers
  uv run evals/run.py report evals/results/<stamp>/aggregate-result.json

The skills repo eval runner builds one plugin from ROOT/skills and reads its
cases from ROOT/evals. It only sees this repo if every skill sits in the same
tree, so each run builds a temporary mirror root:

  <mirror>/evals/*.py                 copied from the skills repo
  <mirror>/evals/triggers/<name>.toml symlinked to every skills repo file
  <mirror>/evals/triggers/web.toml    this repo's evals/triggers/rshow.toml
  <mirror>/evals/outcome/<skill>/     symlinked, plus this repo's own cases
  <mirror>/skills/<topic>/<name>      symlinked, plus web/rshow and web/rshow-slides
  <mirror>/user, <mirror>/.downloaded symlinked

Nothing in the skills repo is written. SKILLS_REPO names its checkout and
has no default. `--check` prints what the runner would load and runs
no model, which is how to prove the mirror without paying for an eval.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path
from typing import Final

REPO: Final = Path(__file__).resolve().parent.parent
RESULTS: Final = REPO / "evals" / "results"
OWN_SKILLS: Final = ("rshow", "rshow-implement", "rshow-slides")
OWN_TOPIC: Final = "web"
OWN_TRIGGERS: Final = "web.toml"
SKIP_DIRS: Final = ("__pycache__",)


def skills_repo() -> Path:
    raw = os.environ.get("SKILLS_REPO", "").strip()
    if not raw:
        sys.exit("error: set SKILLS_REPO to a checkout of a skills repo with an evals/run.py runner")
    root = Path(raw).expanduser()
    if not (root / "evals" / "run.py").is_file():
        sys.exit(f"error: no evals/run.py under {root} (set SKILLS_REPO)")
    return root


def link_dir(src: Path, dst: Path) -> None:
    dst.symlink_to(src.resolve(), target_is_directory=True)


def link_file(src: Path, dst: Path) -> None:
    dst.symlink_to(src.resolve())


def build_mirror(repo: Path) -> Path:
    root = Path(tempfile.mkdtemp(prefix="rshow-eval-"))
    (root / "evals").mkdir()
    (root / "skills").mkdir()

    for script in sorted((repo / "evals").glob("*.py")):
        shutil.copy2(script, root / "evals" / script.name)

    triggers = root / "evals" / "triggers"
    triggers.mkdir()
    taken = {OWN_TRIGGERS}
    for file in sorted((repo / "evals" / "triggers").glob("*.toml")):
        if file.name not in taken:
            link_file(file, triggers / file.name)
            taken.add(file.name)
    link_file(REPO / "evals" / "triggers" / "rshow.toml", triggers / OWN_TRIGGERS)

    outcome = root / "evals" / "outcome"
    outcome.mkdir()
    for topic in sorted((repo / "evals" / "outcome").iterdir()):
        if not topic.is_dir() or topic.name in SKIP_DIRS:
            continue
        if (outcome / topic.name).exists():
            sys.exit(f"error: outcome skill '{topic.name}' exists in both repos")
        link_dir(topic, outcome / topic.name)
    for name in OWN_SKILLS:
        if (outcome / name).exists():
            sys.exit(f"error: outcome skill '{name}' exists in both repos")
        link_dir(REPO / "evals" / "outcome" / name, outcome / name)

    for topic in sorted((repo / "skills").iterdir()):
        if topic.is_dir() and topic.name not in SKIP_DIRS:
            link_dir(topic, root / "skills" / topic.name)
    own = root / "skills" / OWN_TOPIC
    if own.is_symlink() or own.exists():
        sys.exit(f"error: the skills repo already has a skills/{OWN_TOPIC} topic")
    own.mkdir()
    for name in OWN_SKILLS:
        link_dir(REPO / "skills" / name, own / name)

    for name in ("user", ".downloaded"):
        src = repo / name
        if src.exists():
            link_dir(src, root / name)
    for name in ("rules", "pi.py"):
        src = repo / "evals" / name
        if src.exists() and not (root / "evals" / name).exists():
            if src.is_dir():
                link_dir(src, root / "evals" / name)
            else:
                link_file(src, root / "evals" / name)
    return root


def load_runner(mirror: Path):
    spec = importlib.util.spec_from_file_location("rshow_mirror_runner", mirror / "evals" / "run.py")
    if spec is None or spec.loader is None:
        sys.exit("error: cannot import the mirror runner")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def check(mirror: Path) -> int:
    runner = load_runner(mirror)
    skills = runner.skill_dirs()
    print(f"mirror: {mirror}")
    print(f"skills: {len(skills)} -> {', '.join(sorted(skills))}")
    missing = [name for name in OWN_SKILLS if name not in skills]
    if missing:
        sys.exit(f"error: the runner cannot see {', '.join(missing)}")

    try:
        cases = runner.load_triggers()
    except SystemExit as err:
        sys.exit(f"error: {err}")
    per_file = Counter(case["file"] for case in cases)
    print(f"triggers: {len(cases)} cases from {len(per_file)} files")
    for file, count in sorted(per_file.items()):
        print(f"  {file:16} {count:3} cases")
    own = Counter(case["skill"] or "none" for case in cases if case["file"] == Path(OWN_TRIGGERS).stem)
    for stem, count in sorted(own.items()):
        print(f"  {OWN_TRIGGERS} -> {stem:16} {count:3} cases")

    outcome = sorted(path.parent for path in runner.EVALS.glob("outcome/*/*/prompt.md"))
    print(f"outcome: {len(outcome)} cases")
    for case in outcome:
        if case.parent.name in OWN_SKILLS:
            print(f"  {case.parent.name}-{case.name}")
    if len(outcome) == 0:
        sys.exit("error: the runner cannot see any outcome case")
    return 0


def run(mirror: Path, args: list[str]) -> int:
    cmd = ["uv", "run", str(mirror / "evals" / "run.py"), *args]
    print("+", " ".join(cmd), file=sys.stderr)
    code = subprocess.run(cmd, cwd=mirror, env=os.environ.copy()).returncode
    results = mirror / "evals" / "results"
    if results.is_dir():
        RESULTS.mkdir(parents=True, exist_ok=True)
        for found in sorted(results.iterdir()):
            shutil.copytree(found, RESULTS / found.name, dirs_exist_ok=True)
        print(f"results: {RESULTS}", file=sys.stderr)
    return code


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="build the mirror, print what would load, run nothing")
    ap.add_argument("--keep-mirror", action="store_true", help="leave the temporary mirror on disk")
    args, rest = ap.parse_known_args()

    repo = skills_repo()
    mirror = build_mirror(repo)
    try:
        if args.check:
            return check(mirror)
        if not rest:
            ap.error("give the runner a kind, such as triggers or outcome")
        return run(mirror, rest)
    finally:
        if args.keep_mirror:
            print(f"mirror kept: {mirror}", file=sys.stderr)
        else:
            shutil.rmtree(mirror, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
