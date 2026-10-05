# Portable native PayWay concurrency packet

This packet is for an empty, disposable **native PostgreSQL** database on an isolated test computer. It installs nothing, connects only to IPv4 loopback, makes no provider request, and includes no production captures, credentials or customer records. The current SQL compatibility core is included byte-for-byte. The previously verified application/build snapshot is untouched.

Prerequisites: Python 3, an existing `psql` executable, and an isolated PostgreSQL server with a superuser named `postgres`. Prepare an empty database named `tenh_native_test_<suffix>` using that isolated server's normal tools. Creating fixture roles is allowed only in that isolated cluster. The harness refuses other database names, uses explicit loopback connection arguments, removes connection-service overrides, refuses a nonempty database, and requires an explicit write flag. Prefer the production PostgreSQL major version once it is known; record the actual version returned by the harness.

From this packet's root, with the isolated test database already created:

```sh
python3 tests/native-payway-concurrency.py --database tenh_native_test_billing --port 5432 --allow-isolated-db-write > native-results.json
```

On Windows use the installed `python` executable and pass `--psql` with the installed client path if needed. No Python database driver or package installation is required. Authentication is the isolated server's local configuration; the harness never obtains or changes production credentials. Do not point local tunnels at production.

The harness creates one observer and two independent native sessions. It verifies real `pg_blocking_pids()` waits before releasing the holder; timeouts bound every query. Seventeen assertions cover PayWay/PayWay, manual/manual and both cross-provider creator orders; creators waiting for either provider's approval commit; fresh-state visibility; competing conflicting approvals; callback replay with one invoice; creation versus already-approved replay; subscription-before-payment locking using a NOWAIT probe; nonlocking sibling conflict reads; invoice-failure subtransaction rollback with a blocked creator; terminal reactivation denial; merchant-unverified recovery; and private permit/function privileges. The native deadlock counter must not increase. Fixtures use newly generated UUIDs and synthetic transaction IDs. They are retained in the disposable database for inspection; the harness does not drop any database.

**Scope of proof:** default private activation/invoice bodies are explicitly labelled synthetic models. They preserve the relevant locking and mutation shape so the unchanged core can be tested, but a passing default run proves only native concurrency behavior of that core with those models. It does not certify production activation, pricing, invoice bodies, RLS or actual production schema. A separately reviewed local SQL overlay can replace private activation and invoice bodies through `--reviewed-private-functions-sql`; its checksum is recorded. Such confidential source is deliberately excluded from this packet. An overlay must preserve the public RPC signatures/private ACLs, fit the fixture schema and provide any required helpers. It has no connection or transaction commands. Re-run on a newly created empty test database; verify overlay provenance separately before treating those results as production-body evidence.

The current production installer generator is **not** included: its fixed allowlist embeds six real historical transaction identifiers, incompatible with the requested synthetic-only transfer. `generator-reference.json` records its exact unchanged checksum and local source path. This harness does not invoke that generator or use its historical allowlist. The core and the reviewed generic migration sources are included with checksums for source comparison, but the migration sources are not automatically installed by the harness.

Local pre-transfer validation consists of Python syntax/help, a synthetic PGlite fixture compilation/approval/replay check, packet checksums and privacy screening. None is claimed as native concurrency execution. The application previously passed 193 tests, webpack and TypeScript; those results remain separate from this new packet.
# Targeted account-release races

The separate `native-payway-account-release.py` runs nine release/creation/closure/Auth SET NULL race checks using the exact current core. Run it in a **new empty disposable database**, separately from the original 17-check harness:

```sh
python3 tests/native-payway-account-release.py --database tenh_native_test_release --psql /path/to/psql --port 5432 --allow-isolated-db-write
```

It confirms actual PostgreSQL lock waits and unchanged financial snapshots. It uses synthetic activation models and rejects production overlays. Python AST/help and PGlite checks alone do not establish native concurrency; retain the execution output and core hash from the independent native run. Neither harness uses production credentials or contacts a payment provider.
