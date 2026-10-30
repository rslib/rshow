# rshow doctor

```sh
usage: rshow doctor [dir] [--json]

Checks the rshow version, the node version against the engines.node of the
package, the config files, the token, the api, the art host, the theme and the
skills, one line each: ok|warn|fail  <check>  <detail>. With [dir] it reads
<dir>/rshow.json too. A skill line warns and never fails.
Network calls time out after 5 s. Exit 0 when no check failed, 6 when one did.
The token is never printed.
```

