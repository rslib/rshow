# Commands

Every rshow command and subcommand. Each page holds the text that `rshow <command> --help` prints, and `rshow docs` writes both, so the two never differ.

| Command | What it does |
| --- | --- |
| [`rshow publish`](publish.md) | publish a folder, or a single file as index.html |
| [`rshow check`](check.md) | check a folder against the page contract |
| [`rshow handoff`](handoff.md) | write a design handoff folder from a published design |
| [`rshow compare`](compare.md) | compare an implementation with a handoff folder |
| [`rshow preview`](preview.md) | serve a folder on 127.0.0.1 for a look, offline |
| [`rshow config`](config.md) | print the merged config as JSON |
| [`rshow init`](init.md) | write the global config file |
| [`rshow doctor`](doctor.md) | check node, config, token, api, art, theme, skills |
| [`rshow theme`](theme.md) | new, check, preview, publish or list |
| [`rshow theme new`](theme-new.md) | write a preset folder from a built-in theme |
| [`rshow theme check`](theme-check.md) | check a theme folder, preset or full |
| [`rshow theme preview`](theme-preview.md) | build a theme, serve it on 127.0.0.1 for a look |
| [`rshow theme publish`](theme-publish.md) | publish a theme folder as theme-<name> and go public |
| [`rshow theme list`](theme-list.md) | list theme artifacts and their served version |
| [`rshow skills`](skills.md) | install, remove or show the agent skills, per target |
| [`rshow skills install`](skills-install.md) | link or copy the three skills into an agent |
| [`rshow skills uninstall`](skills-uninstall.md) | remove the links and copies rshow made |
| [`rshow skills status`](skills-status.md) | say what each target holds, per skill |
| [`rshow project`](project.md) | create, list, show, share or delete a project |
| [`rshow project create`](project-create.md) | creates a project and prints its slug, title and url |
| [`rshow project list`](project-list.md) | lists the projects you own or are a member of |
| [`rshow project show`](project-show.md) | prints the project, its members and the artifacts you may see in it |
| [`rshow project share`](project-share.md) | adds and removes members on a project, as viewer or editor |
| [`rshow project delete`](project-delete.md) | deletes the project and needs --yes |
| [`rshow tag`](tag.md) | add or remove tags on an artifact |
| [`rshow list`](list.md) | list artifacts you own or share |
| [`rshow show`](show.md) | artifact, versions and shares |
| [`rshow pull`](pull.md) | download the files of a published version |
| [`rshow share`](share.md) | set mode or change shares |
| [`rshow pin`](pin.md) | serve version n, or live for the newest |
| [`rshow delete`](delete.md) | delete an artifact, or one version of it |
| [`rshow upgrade`](upgrade.md) | update rshow to the newest release |
| [`rshow login`](login.md) | save the API token for this account |
| [`rshow logout`](logout.md) | remove the saved token for a server |
| [`rshow completion`](completion.md) | print a completion script for bash, zsh or fish |
