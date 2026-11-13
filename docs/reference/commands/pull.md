# rshow pull

```sh
usage: rshow pull <slug>[@v<n>] [dir] [--force]

Downloads every file of the served version, or of version n, into dir
(default ./<slug>) and checks each file against its hash. The data store is
not downloaded. dir must be empty or missing unless --force is given.
Publish the folder back with: rshow publish <dir> --slug <slug>
```

