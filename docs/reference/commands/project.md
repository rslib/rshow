# rshow project

```sh
usage: rshow project <create|list|show|share|delete> [options]

  project create <slug> [--title t] [--description d]
  project list
  project show <slug>
  project share <slug> [--add email ...] [--editor email ...] [--remove email ...]
  project delete <slug> --yes
```

## Commands

| Command | What it does |
| --- | --- |
| [`rshow project create`](project-create.md) | creates a project and prints its slug, title and url |
| [`rshow project list`](project-list.md) | lists the projects you own or are a member of |
| [`rshow project show`](project-show.md) | prints the project, its members and the artifacts you may see in it |
| [`rshow project share`](project-share.md) | adds and removes members on a project, as viewer or editor |
| [`rshow project delete`](project-delete.md) | deletes the project and needs --yes |

