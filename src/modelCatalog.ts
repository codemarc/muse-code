import { MuseClient, readSessionDurability, spawnMspConnection } from "@muse-code/sdk";
import { isValidModelId, type PickerOption } from "./pickerOptions";

const cache = new Map<string, { expires: number; result: Promise<PickerOption[]> }>();

export function listModelOptions(binary: string): Promise<PickerOption[]> {
  const existing = cache.get(binary);
  if (existing && existing.expires > Date.now()) return existing.result;
  const result = readCatalog(binary).catch((error) => {
    if (cache.get(binary)?.result === result) cache.delete(binary);
    throw error;
  });
  cache.clear();
  cache.set(binary, { expires: Date.now() + 60_000, result });
  return result;
}

async function readCatalog(binary: string): Promise<PickerOption[]> {
  const transport = spawnMspConnection({
    command: binary,
    args: ["serve", "--provider", "meta", "--no-session-log"],
    shutdownTimeoutMs: 2000,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const host = await transport.initialize({ clientInfo: { name: "muse_cli_chat", version: "0.5.1" } });
        const client = new MuseClient(host.connection, { host, durability: readSessionDurability(host.initializeResult) });
        const catalog = await client.listModels();
        const models = Array.isArray(catalog.models) ? catalog.models : [];
        const options = models
          .filter((row) => typeof row?.modelId === "string" && row.modelId !== "" && isValidModelId(row.modelId))
          .map((row) => ({
            value: row.modelId,
            label: typeof row.displayLabel === "string" ? row.displayLabel.trim().slice(0, 100) || row.modelId : row.modelId,
            detail: typeof row.displayLabel === "string" && row.displayLabel.trim() && row.displayLabel !== row.modelId
              ? row.modelId : undefined,
          }));
        if (!options.length) throw new Error("Muse returned an empty model catalog.");
        return options;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Muse model catalog timed out.")), 4500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await transport.close().catch(() => undefined);
  }
}
