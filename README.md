# Transaction Manager

## Home server deployment

Copy `.env.example` to `.env` to customize deployment settings. By default, the app is available on port `4121` on your LAN and Tailscale network. It listens on `0.0.0.0` inside the container; this Compose configuration does not add public ingress.

```bash
docker compose up -d --build
docker compose logs -f
docker compose down
```

No environment variables are required: `HOST_PORT` defaults to `4121`, while `PORT`, `DATA_DIR`, `DATABASE_PATH`, and `IMPORTS_DIR` have working defaults in `.env.example` and normally should remain unchanged.

All mutable state is stored in `./data`, including the SQLite database at `./data/app.db` (and its SQLite WAL files) and watched import files under `./data/imports/{incoming,processing,processed,failed}`. New JSON imports should be placed in `./data/imports/incoming`.

Migrations run automatically each time the app starts. On first run, the database and import directories are created automatically.

To back up, stop the app with `docker compose down` and copy the complete `./data` directory to your backup destination. To restore, stop the app, replace `./data` with the backed-up directory, then start it with `docker compose up -d`. Rebuilding or recreating the container does not delete data because `./data` is mounted from the host.
