# rshow login

```sh
usage: rshow login [--url u]

Reads the token from stdin, checks it against the API, then saves it in the
macOS Keychain. On a terminal it asks for the token with echo off, so it is
never typed on a command line or pasted anywhere. The API base URL is the
account, so each server keeps its own token; --url logs in to another one.
RSHOW_TOKEN still wins over the saved token.
```

