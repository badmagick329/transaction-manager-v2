# Transaction Manager

## Home server deployment

Copy `.env.example` to `.env` to customize deployment settings. `HOST_PORT` selects the port exposed on your LAN and Tailscale network. The app listens on `0.0.0.0` inside the container; this Compose configuration does not add public ingress.

```bash
docker compose up -d --build
docker compose logs -f
docker compose down
```

No environment variables are required: `HOST_PORT`, `PORT`, `DATA_DIR`, `DATABASE_PATH`, and `IMPORTS_DIR` have working defaults in `.env.example` and normally should remain unchanged.

## Deploy

Copy `.env.deploy.example` to `.env.deploy` and fill in the server connection and application-directory settings. The optional health URL is requested from the server after deployment.

```sh
bun run deploy
```

The deploy command connects over SSH, fast-forwards the server checkout, rebuilds and restarts Compose, then shows service status. It leaves the mounted `data` directory intact, preserving SQLite and imported files.

All mutable state is stored in `./data`, including the SQLite database at `./data/app.db` (and its SQLite WAL files) and watched import files under `./data/imports/{incoming,processing,processed,failed}`. New JSON imports should be placed in `./data/imports/incoming`.

To safely upload generated standard-import JSON files from your main PC, use:

```bash
bun scripts/upload-imports-to-server.mjs --host <ssh-host> notes/temp_files/example.json
```

The script validates the JSON, transfers it over SSH under a temporary non-watched name, and atomically places it in the watched `incoming` directory. Set `IMPORT_SERVER` instead of passing `--host` each time if preferred.

Migrations run automatically each time the app starts. On first run, the database and import directories are created automatically.

To back up, stop the app with `docker compose down` and copy the complete `./data` directory to your backup destination. To restore, stop the app, replace `./data` with the backed-up directory, then start it with `docker compose up -d`. Rebuilding or recreating the container does not delete data because `./data` is mounted from the host.
