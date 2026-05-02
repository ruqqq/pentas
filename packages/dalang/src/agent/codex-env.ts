export interface BuildCodexChildEnvOptions {
  preserveProcessKeys?: readonly string[];
}

export function buildCodexChildEnv(
  extra?: Record<string, string>,
  options: BuildCodexChildEnvOptions = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  const merged = { ...env, ...extra };
  for (const key of options.preserveProcessKeys ?? []) {
    const value = process.env[key];
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}
