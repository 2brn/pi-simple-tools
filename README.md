# Pi Simple Tools

A minimal [Pi](https://pi.dev) package with two extensions:

- **Simple Footer** replaces the interactive footer with the active model and Git branch.
- **Simple Subagent** adds `simple_subagent`, which runs one isolated foreground Pi child process.

## Install from Git

```bash
pi install git:github.com/2brn/pi-simple-tools@v0.1.0
```

For the Pi package gallery, publish this same package to npm after choosing an available package name or scope and retaining the `pi-package` keyword.

## Use

The footer loads automatically in interactive Pi sessions.

`simple_subagent` accepts a focused `task` and an optional `role`:

- `scout` (default): read-only exploration
- `reviewer`: read-only review
- `worker`: may use `bash`, `edit`, and `write`

Each child uses `--no-session`, `--no-extensions`, and `--no-mcp`. Set `PI_SIMPLE_TOOLS_PI` to an executable Pi path if `pi` is not on `PATH`.

## Development

```bash
npm test
npm run check
```

## Security

Extensions run with the permissions of the host Pi process. Review delegated tasks carefully, especially when selecting the `worker` role.

## License

MIT
