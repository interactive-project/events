# Interactive Project Events

Portable shared event envelope and typed lifecycle/domain event catalog.

- [Identity, correlation, catalog and evolution contract](docs/events-v1.md)
- [Draft 2020-12 event schema](schemas/event.v1.schema.json)
- [Local delivery, replay and engine isolation](docs/delivery-v1.md)
- [Machine-readable typed catalog](catalogs/events.v1.json)

The pure entry exports headless types and immutable catalog names. Optional Node validation resolves exact Protocol schemas offline. The optional bus provides bounded local delivery and explicit replay. Privacy-aware sinks remain issue #3.

Run npm ci --ignore-scripts, install scripts/requirements.txt and npm test. CI pins Protocol 0280e004ba863621a257b96819f34295c8db0ea7; no package publication is claimed.
