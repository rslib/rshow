# rshow upgrade

```sh
usage: rshow upgrade [--check] [--version <x.y.z>] [--force]

Updates rshow to the newest release, or to the release --version names, which
may be an older one.
A single executable is replaced in place, and an npm global install runs
npm install -g rshow@<version>.
Any other install, such as a source checkout, an npx cache or a local
dependency, is left alone and named with the tool that owns it.
Running the command is the consent: there is no --yes.
No config and no token are read, so it works before rshow init.

--check prints the current and the newest version and changes nothing, and
exits 0 either way; --json prints {current, latest, upgrade_available}.
A run prints upgraded <old> -> <new>, or already at <version>. --json prints
{previous, version, upgraded, kind}, where kind is binary or npm.
--version takes x.y.z with an optional leading v; --force reinstalls the same
version, which is how a broken binary comes back.
Skills that rshow installed are refreshed by the new rshow, and a bash, zsh or
fish completion that is already there is replaced; RSHOW_NO_COMPLETIONS=1
leaves the completions alone.
RSHOW_DOWNLOAD_BASE downloads from a mirror instead of the release, and takes
an http or https url; it cannot be used with --check.

A release older than this one has no upgrade command, so after a downgrade
come back with curl -fsSL https://rslib.github.io/rshow/install.sh | sh.
```

