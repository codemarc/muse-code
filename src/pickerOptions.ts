/**
 * Options for the in-chat model / effort / mode pickers.
 *
 * Muse has no command that lists its model catalog (`muse model-profile show`
 * accepts any id), so the model list is: a short known list, plus every model
 * named in the user's Muse settings.json, plus the currently configured one.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface PickerOption {
  value: string;
  label: string;
  detail?: string;
}

export const KNOWN_MODELS = ["muse-wonder-1.0", "muse-spark-1.3"];

/** Mirrors the muse.reasoningEffort enum in package.json ("" = Muse default). */
export const EFFORT_VALUES = ["", "minimal", "low", "medium", "high", "xhigh", "ultra"] as const;

export const CUSTOM_MODEL_VALUE = "__custom__";

const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

export function isValidModelId(value: string): boolean {
  return value === "" || MODEL_ID_RE.test(value);
}

export function isValidEffort(value: string): boolean {
  return (EFFORT_VALUES as readonly string[]).includes(value);
}

export function museSettingsPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const base = env.XDG_CONFIG_HOME?.trim() || join(home, ".config");
  return join(base, "muse", "settings.json");
}

/** Model ids mentioned in Muse's own settings.json (`model`, `model_reasoning_efforts`). */
export function modelsFromMuseSettings(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  try {
    const json = JSON.parse(raw) as {
      model?: unknown;
      model_reasoning_efforts?: Record<string, unknown>;
    };
    const out: string[] = [];
    if (typeof json.model === "string") {
      out.push(json.model);
    }
    if (json.model_reasoning_efforts && typeof json.model_reasoning_efforts === "object") {
      out.push(...Object.keys(json.model_reasoning_efforts));
    }
    return out.filter((m) => MODEL_ID_RE.test(m));
  } catch {
    return [];
  }
}

export function readMuseSettingsRaw(path = museSettingsPath()): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export function buildModelOptions(current: string, museSettingsRaw: string | null): PickerOption[] {
  const ids = new Set<string>();
  for (const id of [...KNOWN_MODELS, ...modelsFromMuseSettings(museSettingsRaw), current.trim()]) {
    if (id && MODEL_ID_RE.test(id)) {
      ids.add(id);
    }
  }
  return [
    { value: "", label: "Auto", detail: "Muse default" },
    ...[...ids].sort().map((id) => ({ value: id, label: id })),
    { value: CUSTOM_MODEL_VALUE, label: "Other model…", detail: "Type a model id" },
  ];
}

export function buildEffortOptions(): PickerOption[] {
  return EFFORT_VALUES.map((v) => ({
    value: v,
    label: v === "" ? "Default" : v.charAt(0).toUpperCase() + v.slice(1),
    detail: v === "" ? "Muse default (high)" : undefined,
  }));
}
