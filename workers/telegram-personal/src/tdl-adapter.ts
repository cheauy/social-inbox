import { createRequire } from "node:module";
import type { Logger } from "./redact.ts";
import { redactString } from "./redact.ts";
import { TdRequestError, type TdClient, type TdClientFactory, type TdClientOptions, type TdObject } from "./tdlib-port.ts";

/** The exact TDLib build this worker was written against. TDLib has no stable interface. */
export const EXPECTED_TDLIB_VERSION = "1.8.67";

type TdlModule = typeof import("tdl");

/**
 * Real TDLib through `tdl` + `prebuilt-tdlib`. tdl sends setTdlibParameters
 * (including database_encryption_key) itself; the SessionRunner drives every
 * authorization step explicitly, so tdl's interactive `login()` is never used.
 */
export function createTdlFactory(options: { apiId: number; apiHash: string; useTestDc: boolean; log: Logger }): TdClientFactory {
  const require = createRequire(import.meta.url);
  const tdl = require("tdl") as TdlModule;
  const { getTdjson } = require("prebuilt-tdlib") as { getTdjson: () => string };

  tdl.configure({ tdjson: getTdjson(), verbosityLevel: 1 });
  // Route TDLib's own log through redaction; never to a file.
  tdl.setLogMessageCallback(1, (level, message) => {
    options.log(level <= 1 ? "error" : "warn", "tdlib_log", { reason: redactString(message).slice(0, 200) });
  });

  const version = (tdl.execute({ _: "getOption", name: "version" }) as { value?: string } | null)?.value;
  if (version !== EXPECTED_TDLIB_VERSION) {
    throw new Error(`TDLib ${version ?? "unknown"} loaded; this worker requires ${EXPECTED_TDLIB_VERSION}.`);
  }

  return {
    create(clientOptions: TdClientOptions): TdClient {
      const client = tdl.createClient({
        apiId: options.apiId,
        apiHash: options.apiHash,
        databaseDirectory: clientOptions.databaseDirectory,
        filesDirectory: clientOptions.filesDirectory,
        databaseEncryptionKey: clientOptions.databaseEncryptionKey,
        useTestDc: options.useTestDc,
        tdlibParameters: {
          use_message_database: true,
          use_chat_info_database: true,
          use_file_database: false,
          use_secret_chats: false,
          system_language_code: "en",
          device_model: "TENH Chat",
          system_version: "Server",
          application_version: "telegram-personal-worker/0.0.0",
        },
      });
      client.on("error", (error) => options.log("error", "tdlib_client_error", { error }));
      return {
        async invoke(request: TdObject) {
          try {
            return (await client.invoke(request as never)) as unknown as TdObject;
          } catch (error) {
            const e = error as { code?: number; message?: string };
            if (typeof e?.code === "number") throw new TdRequestError(e.code, e.message ?? "");
            throw error;
          }
        },
        onUpdate(listener) {
          client.on("update", (update) => listener(update as unknown as TdObject));
        },
        close: () => client.close(),
        isClosed: () => client.isClosed(),
      };
    },
  };
}
