export const GENERAL_USAGE = `usage: rshow <command> [options]

commands:
  publish <file-or-dir>   publish a folder, or a single file as index.html
  check <dir>             check a folder against the page contract
  handoff <slug>@v<n>     write a design handoff folder from a published design
  compare --against <dir> compare an implementation with a handoff folder
  preview <dir>           serve a folder on 127.0.0.1 for a look, offline
  config [dir]            print the merged config as JSON
  init --url u --art a    write the global config file
  doctor [dir]            check node, config, token, api, art, theme, skills
  theme new <name>        write a preset folder from a built-in theme
  theme check <dir>       check a theme folder, preset or full
  theme preview <dir>     build a theme, serve it on 127.0.0.1 for a look
  theme publish <dir>     publish a theme folder as theme-<name>
  theme list              list theme artifacts
  skills <cmd>            install, remove or show the agent skills, per target
  project <cmd>           create, list, show, share or delete a project
  tag <slug>              add or remove tags on an artifact
  list [filters]          list artifacts you own or share
  show <slug>             artifact, versions and shares
  share <slug>            set mode or change shares
  pin <slug> <n|live>     serve version n, or live for the newest
  delete <slug> --yes     delete an artifact
  login [--url u]         save the API token in the macOS Keychain
  logout [--url u]        remove the saved token for a server

global:
  --json                  print the API reply JSON
  --help                  show this help
  --version, -v           print rshow <version>

environment:
  RSHOW_URL               API base URL, overrides the config file
  RSHOW_ART               art base URL, overrides the config file
  RSHOW_TOKEN             the API token, else the token saved by rshow login
                          in the macOS Keychain; never read from a file
  XDG_CONFIG_HOME         where to find rshow/config.json (default ~/.config)

Start here: rshow init --url <admin-url> --art <viewer-url>, then rshow login.

config files, later wins:
  ~/.config/rshow/config.json   {"url", "art", "theme", "tokens"}
  <dir>/rshow.json              {"slug", "title", "theme", "tokens", "project", "tags", "build", "out"}`;

export const PUBLISH_USAGE = `usage: rshow publish <file-or-dir> [--slug s] [--title t] [--label l] [--project p] [--tag t ...] [--build cmd] [--no-check] [--force]

A folder must contain index.html. A single file is published as index.html.
Slug and title fall back to <dir>/rshow.json, then to the file or folder name.
--build (or build in rshow.json) runs the command in <dir> with your shell,
then <dir>/<out> (out defaults to dist) is published.
--project (or project in rshow.json) moves the artifact into a project.
--tag (or tags in rshow.json) sets its tags; repeat the flag, or list several
tags after it.
The folder is checked first (see rshow check --help) and an error stops the
publish with exit 6. --no-check skips the check.
When the newest version already holds the same paths and hashes, nothing is
uploaded: it prints unchanged: <slug> is already v<n>. --force publishes a
new version anyway.`;

export const CHECK_USAGE = `usage: rshow check <dir> [--offline] [--json]

Checks a folder against the rshow page contract before publish.
Prints one line per finding, <path>:<line>: error|warning: <message>, then a
summary line. Exit 0 when there is no error, 6 when there is an error, 2 on a
usage error. --offline skips the theme version lookup on the art host.

errors:
  no index.html at the root, unless theme.json makes the folder a theme
  a local href, src, poster, srcset, CSS url() or @import with no file behind it
  a root-relative reference other than /_themes/<name>@<n>/<path>
  a /_themes/<name>@<n>/ path whose version the art host does not have
  a script from a host other than cdnjs.cloudflare.com, cdn.jsdelivr.net,
    unpkg.com, or one of those without an exact version (@1.2.3, /1.2.3/ on cdnjs)
  a stylesheet from a host other than fonts.googleapis.com, cdn.jsdelivr.net,
    cdnjs.cloudflare.com
  a fetch, WebSocket, EventSource or XMLHttpRequest.open to an absolute http
    or https url, because connect-src is 'self' only
  a path with a backslash or a .. segment, a file over 25 MiB, more than 2000
    files, or over 100 MiB in total

warnings:
  index.html without <meta name="viewport">, or without <title>
  an <img> without alt
  a deck that links deck.js and has no <section class="slide">

Mockup warnings:
  Warnings for a page whose <main> carries the class mockup, and for any
  element with the class tui. They are warnings, never errors.
  a flow through href="#id" inside an artboard, or data-goto="id", that names
    no artboard id in the same file
  two artboards with the same id
  an artboard without data-title
  a block with data-state="x" whose artboard does not list x in data-states
    (default is always allowed)
  an artboard that lists a state in data-states that no block uses
  a tui with data-cols below 80 or data-rows below 24 and no data-allow-small
  a key hint in .tui-keys, .tui-statusbar or .tui-dialog that binds Ctrl+C,
    Ctrl+Z or Ctrl+\ (also ^C, ^Z, c-c), which the terminal owns

Style warnings:
  Warnings for AI-design defaults, never errors. They look at .html and .css
  files in the folder, and skip anything under fonts/ and vendored *.min.css
  or *.min.js. --no-style skips all of them.
  eyebrow labels: text-transform: uppercase with letter-spacing of 0.05em or
    more, or 1px or more
  decorative numbering: three or more elements whose whole text is a
    zero-padded number (01, 02, 03)
  gradient text: background-clip: text or -webkit-background-clip: text
  trendy default fonts in font-family: Inter, Space Grotesk, Geist, Fraunces,
    Instrument Serif, Poppins, Montserrat
  a font-family name that nothing loads: not a generic family, no @font-face in
    the folder, no /_themes/ fonts link, and no fonts.googleapis.com link
  cream plus terracotta: a background over 90% lightness at hue 30-50 next to a
    color or border over 45% saturation at hue 5-30
  emoji in visible text
  glass and heavy shadow: backdrop-filter: blur, or a box-shadow blur of 24px
    or more
  purple-blue gradients: a linear-gradient whose stops hold both a 250-290 hue
    and a 200-240 hue`;

export const PREVIEW_USAGE = `usage: rshow preview <dir> [--theme <dir>] [--offline] [--no-reload] [--port 4321]

Serves <dir> on 127.0.0.1: index.html for a folder, content types for files.
Works offline: /_themes/<name>@<n>/ is served from --theme when it names that
theme, then from the built-in themes on disk, and only then proxied to the art
URL from config, which --offline turns off.
The page is reloaded on its own when a file changes; --no-reload turns that off.
Scripts that use <artifact>/_data/<key> get a local store in that same session.`;

export const CONFIG_USAGE = `usage: rshow config [dir] [--offline]

Prints the merged config as JSON: ~/.config/rshow/config.json first, then
<dir>/rshow.json (default: the current folder). RSHOW_URL overrides url and
RSHOW_ART overrides art. <dir>/rshow.json also takes project and tags; later
files win. Run rshow init to write url and art.
A theme with no version, or @latest, is looked up on the art host and printed
as <name>@<n>; when that fails a warning goes to stderr. --offline skips it, and
so does a config with no art host.
The token is RSHOW_TOKEN, else the token saved by rshow login in the macOS
Keychain; never read from a file.`;

export const INIT_USAGE = `usage: rshow init --url <admin-url> --art <viewer-url> [--theme <name>] [--force]

Writes the global config file that rshow reads first:
$XDG_CONFIG_HOME/rshow/config.json, or ~/.config/rshow/config.json.
Both urls are required and must be https://; http://127.0.0.1 and
http://localhost are allowed for local development. A trailing slash is
removed. Other fields in an existing file are kept, and so is its theme unless
--theme is given.
When the file already sets a different url or art, init refuses instead of
overwriting; --force replaces them.
Prints the path it wrote and the next step: rshow login. --json prints
{path, url, art}.`;

export const DOCTOR_USAGE = `usage: rshow doctor [dir] [--json]

Checks the rshow version, the node version against the engines.node of the
package, the config files, the token, the api, the art host, the theme and the
skills, one line each: ok|warn|fail  <check>  <detail>. With [dir] it reads
<dir>/rshow.json too. A skill line warns and never fails.
Network calls time out after 5 s. Exit 0 when no check failed, 6 when one did.
The token is never printed.`;

export const THEME_USAGE = `usage: rshow theme <new|check|preview|publish|list> [options]

  theme new <name>        write a preset folder from a built-in theme
  theme check <dir>       check a theme folder, preset or full
  theme preview <dir>     build a theme, serve it on 127.0.0.1 for a look
  theme publish <dir>     publish a theme folder as theme-<name> and go public
  theme list              list theme artifacts and their served version`;

export const THEME_NEW_USAGE = `usage: rshow theme new <name> [--dir <parent>] [--from default]

Writes <parent>/<name>/theme.json with "extends", an empty "tokens" object and
modeTokens light and dark filled with the base values of --bg, --fg, --muted,
--accent and --layer-01, so you edit values and not token names.
<parent> is the current folder by default. --from names the built-in theme to
extend, default "default". It refuses to overwrite an existing folder.
Prints the path it wrote and the next step: rshow theme check <dir>.`;

export const THEME_CHECK_USAGE = `usage: rshow theme check <dir>

Checks a preset or a full theme folder. Prints one line per finding,
theme.json:<line>: error|warning: <message>, then a summary line. Exit 0 when
there is no error, 6 when there is an error, 2 on a usage error.

errors:
  a token in tokens or modeTokens that the base tokens.css does not define
  a colour token whose value is not #hex, rgb() or var(--known-token)
  --fg, --muted or --accent under 4.5:1 on --bg or --layer-01, in light,
    in dark and in print
  a fonts[].file that does not exist
  a name that is not [a-z0-9-]{1,40}, or that starts with theme-

warnings:
  fonts listed without a licence file in fonts/ (OFL.txt, LICENSE,
    LICENSE.txt or LICENSE.md)`;

export const THEME_PREVIEW_USAGE = `usage: rshow theme preview <dir> [--offline] [--no-reload] [--port 4321]

Builds the theme folder into a temporary folder, serves that on 127.0.0.1 and
prints the URL of index.html, the preview page that shows every layout. The
built folder answers /_themes/<name>@<n>/ and is rebuilt, and the page reloaded,
when the folder changes; --no-reload turns the reload off. A /_themes/ path for
another theme comes from the built-in themes on disk, then from the art URL
from config, which --offline turns off. The temporary folder goes when the
server stops.`;

export const THEME_PUBLISH_USAGE = `usage: rshow theme publish <dir> [--label l] [--build cmd] [--no-check] [--force]

<dir> needs theme.json with a name. The folder is published as theme-<name>,
then set to mode public, which needs a full-scope token.
The folder is checked first (see rshow check --help) and an error stops the
publish with exit 6. --no-check skips the check.
A theme.json with "extends" is a preset: it is checked with rshow theme check,
built on top of its base theme, and the built folder is what gets published.
When the newest version already holds the built folder's paths and hashes, it
prints unchanged: theme-<name> is already v<n> and publishes nothing.
--force publishes a new version anyway.
Prints /_themes/<name>@<n>/.`;

export const THEME_LIST_USAGE = `usage: rshow theme list

Lists artifacts whose slug starts with theme- and their served version.`;

export const SKILLS_USAGE = `usage: rshow skills <install|uninstall|status> [target ...] [options]

  skills install [target ...]    link or copy the three skills into an agent
  skills uninstall [target ...]  remove the links and copies rshow made
  skills status [target ...]     say what each target holds, per skill

A target is where an agent reads its skills from:
  claude   $HOME/.claude/skills
  pi       $HOME/.pi/agent/skills
  codex    $HOME/.codex/skills
With no target, every target whose parent folder exists is used.`;

export const SKILLS_INSTALL_USAGE = `usage: rshow skills install [target ...] [--link|--copy] [--dry-run]

Puts the three skills rshow ships, rshow, rshow-slides and rshow-implement, in
the skills folder of every target, so that claude, pi and codex read them:
$HOME/.claude/skills, $HOME/.pi/agent/skills and $HOME/.codex/skills. With no
target, every target whose parent folder exists is used; naming one of claude,
pi and codex picks it, and a usage error names them when none is detected.
Each skill is a symlink to the folder rshow reads it from, so an upgrade of
rshow is nothing to do. --copy copies the folder and writes a .rshow-skill
marker in it, {"version": <rshow version>, "source": "rshow"}, which is how a
newer rshow knows the copy is its own. The default is a link, and a copy when
that folder sits in an npx cache, which npm may delete under a link.
A skill that is ours and current prints ok, and one of ours from another path or
another version is replaced and prints updated. Anything else, a folder, a file
or a link that rshow did not make, is left alone: skip goes to stderr, the rest
is still installed, and the run exits 6.
--dry-run prints what would happen, with would, and changes nothing.
Prints one line per skill, then installed <n> skills for <targets>; --json
prints {targets, actions: [{target, skill, action, path}]}.
RSHOW_SKILLS_DIR reads the skills from another folder.`;

export const SKILLS_UNINSTALL_USAGE = `usage: rshow skills uninstall [target ...] [--dry-run]

Removes the skills rshow put in every target: a symlink into a skills folder
that holds rshow skills, and a copy that carries the .rshow-skill marker.
It removes nothing else, with no line and no error. With no target, every
target whose parent folder exists is used.
Prints removed <path> per skill, then removed <n> skills for <targets>, and
--dry-run prints what would happen, with would, and changes nothing.`;

export const SKILLS_STATUS_USAGE = `usage: rshow skills status [target ...] [--json]

Prints one line per target and skill, <target>  <skill>  <state>, where the
state is link -> <path>, copy v<version>, missing or foreign. It prints nothing
for a target whose parent folder does not exist, and --json prints {targets,
actions: [{target, skill, action, path}]}.
A copy of another version also warns on stderr, because rshow skills install
replaces it.`;

export const LIST_USAGE = `usage: rshow list [--project p] [--tag t] [--q text]

Lists artifacts you own or that are shared with you.
--project keeps the artifacts of one project, --tag the ones with a tag, and
--q the ones whose slug or title holds the text. The filters combine with AND.`;

export const SHOW_USAGE = `usage: rshow show <slug>

Prints the artifact, its versions and its shares.`;

export const SHARE_USAGE = `usage: rshow share <slug> [--mode private|people|public] [--add email ...] [--editor email ...] [--remove email ...]

--add      share as viewer
--editor   share as editor
--remove   drop the share`;

export const PIN_USAGE = `usage: rshow pin <slug> <n|live>

Pins version n, or live to serve the newest version again.`;

export const DELETE_USAGE = `usage: rshow delete <slug> --yes

Deletes the artifact and needs --yes.`;

export const LOGIN_USAGE = `usage: rshow login [--url u]

Reads the token from stdin, checks it against the API, then saves it in the
macOS Keychain. On a terminal it asks for the token with echo off, so it is
never typed on a command line or pasted anywhere. The API base URL is the
account, so each server keeps its own token; --url logs in to another one.
RSHOW_TOKEN still wins over the saved token.`;

export const LOGOUT_USAGE = `usage: rshow logout [--url u]

Removes the token this server has in the macOS Keychain.`;

export const PROJECT_USAGE = `usage: rshow project <create|list|show|share|delete> [options]

  project create <slug> [--title t] [--description d]
  project list
  project show <slug>
  project share <slug> [--add email ...] [--editor email ...] [--remove email ...]
  project delete <slug> --yes`;

export const PROJECT_CREATE_USAGE = `usage: rshow project create <slug> [--title t] [--description d]

Creates a project and prints its slug, title and url. A project groups
artifacts and shares them at once; artifact urls do not change. The slug uses
the artifact pattern and has its own namespace. --description is at most 500
characters.`;

export const PROJECT_LIST_USAGE = `usage: rshow project list

Lists the projects you own or are a member of.`;

export const PROJECT_SHOW_USAGE = `usage: rshow project show <slug>

Prints the project, its members and the artifacts you may see in it.`;

export const PROJECT_SHARE_USAGE = `usage: rshow project share <slug> [--add email ...] [--editor email ...] [--remove email ...]

Adds and removes members on a project, as viewer or editor.
--add      add as viewer
--editor   add as editor
--remove   drop the member
Only the project owner may change members.`;

export const PROJECT_DELETE_USAGE = `usage: rshow project delete <slug> --yes

Deletes the project and needs --yes. Its artifacts stay and lose the project.`;

export const TAG_USAGE = `usage: rshow tag <slug> [--add t ...] [--remove t ...]

Adds and removes tags on an artifact you own or edit, then prints its tags.
A tag is [a-z0-9][a-z0-9-]{0,31} and is stored lowercase; at most 10 per
artifact. Repeat the flag, or list several tags after one flag.`;

export const HANDOFF_USAGE = `usage: rshow handoff <slug>@v<n> | <dir> [--out dir] [--widths 1440,390] [--modes light,dark]

Writes a handoff folder, default ./handoff-<slug>-v<n>, so that a coding agent
can build the design without drifting from it:
  tokens.json     every CSS custom property on :root from the linked
                  tokens.css and skin css, the dark values as a dark group,
                  in W3C DTCG 2025.10 form ($value, $type color, dimension,
                  fontFamily, fontWeight, number), grouped by name prefix
  spec.json       per screen, state and mode: components (name, box x y w h
                  in CSS px, computed colour, background, font-family,
                  font-size, font-weight, border-radius, gap and padding for a
                  container, and the token each value matches), flows from one
                  screen to another, annotation pins with their position,
                  focus order and a normative or placeholder flag
  HANDOFF.md      the source URL, the screens and states, the component
                  table, the token summary, the rules and the exact
                  rshow compare command
  baseline/       <screen>__<state>__<width>__<mode>.png screenshots

A component is named by data-component, then by its wf-* class, then by its
role or tag. data-normative means the text, box and style must match;
data-placeholder, and anything without data-normative, is free: text, data and
images are placeholder by default. A mockup is shot artboard by artboard and
state by state, in focus mode through mockup.js when it exposes one, else by
its URL hash and the artboard clip. A deck, a report and a page are one screen
each (a deck one screen per section.slide).

Chrome or Chromium is driven headless over the DevTools protocol; set CHROME
to pick a binary. Only a public version can be read headless: if <slug>@v<n>
is not public, make it public or run rshow handoff on a local folder.
A starter rshow.map.json is written in the current folder when there is none.

rshow.map.json, kept next to the app:
  {"components": {"wf-button": "src/ui/Button.tsx",
                  "PrimaryButton": "src/ui/Button.tsx#primary"},
   "tokens": {"--accent": "theme.colors.accent"},
   "screens": {"gallery": "http://localhost:5173/",
               "share": "http://localhost:5173/a/demo#share",
               "cli": "tmux:mysession:0.1",
               "desktop": "file:shots/desktop.png",
               "settings": "window:My App"}}`;

export const COMPARE_USAGE = `usage: rshow compare --against <handoff-dir> [--map rshow.map.json] [--threshold 0.1] [--max-diff-ratio 0.02] [--native-max-diff-ratio 0.15] [--tui-colors] [--publish]

Opens every screen in the handoff that has a url in map.screens, at the same
widths and modes, and compares the result with baseline/:
  pixels      per pixel YIQ colour distance like pixelmatch, anti-aliasing
              ignored; writes diff/<screen>__<state>__<width>__<mode>.png and
              fails above --max-diff-ratio of differing pixels
  structure   every data-normative component must exist in the implementation,
              matched by data-component then by role and text, with its box
              within 4px or 2% and the same colour, font-size, font-weight and
              radius, or the value of its mapped token
  tokens      a value that equals a token is fine; a raw colour within a small
              distance of a token colour is reported as drift
Writes compare-report/index.html, compare-report/report.json and the three
images per screen. Exit 0 when everything matches, 7 when it does not, 2 on a
usage error.
A map.screens entry that starts with tmux: (tmux:mysession:0.1) is captured
with tmux capture-pane -pet and compared cell by cell with
baseline/<screen>.txt, written on the first run; ANSI colour is ignored unless
--tui-colors.
A native desktop app has no DOM, so a screen entry is a screenshot of it:
  file:shots/gallery.png      a screenshot, relative to rshow.map.json
  window:MyApp                the window whose owner name or title matches, on
                              macOS with screencapture -x -o -l and on Linux
                              with xdotool search --name plus import -window;
                              anywhere else the run exits 2, so use file:
The capture is scaled to the baseline width with a box filter, so a Retina 2x
shot lines up, then diffed with the looser --native-max-diff-ratio, checked
against the token colours of every normative component (delta E 76 in Lab) and
turned into compare-report/rubric-<screen>.md, a checklist to tick beside the
baseline and the capture. Such a screen reports review, and exits 7 only when
the pixels or a token colour fail hard.
--publish publishes compare-report as <slug>-compare, private by default.`;

export const DOCS_USAGE = `usage: rshow docs --out <dir>

Writes the reference Markdown that the docs site reads, from the same usage
text and the same exit codes the CLI prints, so help and docs never differ:
  <dir>/commands/index.md      every command, with its one-line summary
  <dir>/commands/<name>.md     one page per command and per subcommand, named
                               theme-new.md for "rshow theme new"
  <dir>/theme-tokens.md        every token of the built-in default theme
  <dir>/exit-codes.md          the exit codes
The output is deterministic: no timestamp, no path from the machine, and the
same bytes on every run. Run it from the repository root as
node packages/cli/src/main.ts docs --out docs/reference.`;

export function usageLine(usage: string): string {
  return usage.split('\n')[0] ?? '';
}
