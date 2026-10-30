# Exit codes

Every rshow command exits with one of these codes. On a failure it prints `rshow: <message>` on stderr first.

| Code | Name | When |
| --- | --- | --- |
| 0 | ok | the work was done. |
| 2 | usage | a usage error: an unknown flag, an argument that is not valid, or a missing value. The usage line goes with it. |
| 4 | auth | the API refused the token with 401 or 403. |
| 5 | api | the API returned another error. |
| 5 | build | the `--build` command failed. |
| 6 | check | `rshow check`, `rshow publish` or `rshow theme publish` found an error, or `rshow skills install` found a skill folder that is not from rshow. |
| 7 | compare | `rshow compare` found a difference. |
