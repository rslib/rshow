# rshow login

```sh
usage: rshow login [--url u]

Reads the token from stdin, checks it with the API, then saves it in the macOS
Keychain, in the Linux keyring, or in $XDG_CONFIG_HOME/rshow/credentials with
mode 600: the first store this machine has, and it reads it back to confirm.
On a terminal it asks for the token with echo off, so it is never typed on a
command line or pasted anywhere. The API base URL is the account, so each
server keeps its own token; --url logs in to another one.
Prints the email, the scope and where the token went.
RSHOW_TOKEN still wins over the saved token, and RSHOW_TOKEN_STORE forces one
of keychain, keyring or file.
```

