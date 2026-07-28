# PDML Cloudflare Bridge

This bridge runs on the GY Windows database machine and exposes a narrow HTTP surface for Bambook and the future macOS PDML client.

It proxies to the existing local FastServer at `http://127.0.0.1:49090`, but only allows authenticated `SELECT` queries against the PDML fabric read whitelist and image reads under `/firewebv/MLXX/`.

## Environment

- `PDML_BRIDGE_KEY`: required shared secret for Bambook/macOS clients.
- `PDML_BRIDGE_PORT`: defaults to `49190`.
- `PDML_FASTSERVER_URL`: defaults to `http://127.0.0.1:49090`.
- `PDML_FASTSERVER_TOKEN`: defaults to `111111`.
- `PDML_PUBLIC_BASE_URL`: optional public Cloudflare base URL for rewriting `TPDZ` image URLs.

## Bambook / macOS PDML client

Set:

```bash
PDML_ENDPOINT=https://pdml.jiangsupanda.com/api/myapi/apidoing
PDML_BRIDGE_KEY=your-shared-secret
```

Then use the existing `/api/v1/pdml/sync` flow.
