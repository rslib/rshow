# Security

## Reporting a vulnerability

Report it through GitHub's private vulnerability reporting: https://github.com/rslib/rshow/security/advisories/new

Do not open a public issue, and do not post the details anywhere else until there is a fix.

Please include what the problem is, which version and command or endpoint it affects, the steps to reproduce it, and what an attacker gets out of it. A small proof of concept helps more than a long report.

## Supported versions

The latest minor version gets fixes. Older ones do not.

## Scope

- The Worker's sign-in, sharing and mode checks: who can read an artifact, a version, a page's data, or the admin API.
- Tokens: how the CLI reads, stores and sends them, and what a `publish` or `full` token can do.
- The `_data` store: reading and writing another person's values, or one beyond its size or key limits.
