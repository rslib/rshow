# rshow completion

```sh
usage: rshow completion <bash|zsh|fish>

Prints a completion script for that shell on stdout. It lists every command
and its long options, and it completes files and folders for the commands that
take one. It is static: a completion never calls the API.

load it once per machine:
  bash  rshow completion bash > ~/.local/share/bash-completion/completions/rshow
  zsh   rshow completion zsh > ~/.local/share/zsh/site-functions/_rshow
        (that folder must be on $fpath, before compinit)
  fish  rshow completion fish > ~/.config/fish/completions/rshow.fish

The curl installer writes all three, and an npm install runs one of them.
```

