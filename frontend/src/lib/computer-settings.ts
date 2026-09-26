export type ComputerLimits = {
  cpuCores: { min: number; max: number; default: number };
  memoryGiB: { min: number; max: number; default: number };
  timezoneDefault: string;
};
export type ComputerSettingsDraft = { cpuCores: string; memoryGiB: string; timezone: string };

export function defaultComputerSettings(limits: ComputerLimits): ComputerSettingsDraft {
  return { cpuCores: String(limits.cpuCores.default), memoryGiB: String(limits.memoryGiB.default), timezone: limits.timezoneDefault };
}

/** UI checks only; the API and Docker execution boundary validate again. */
export function parseComputerSettings(draft: ComputerSettingsDraft, limits: ComputerLimits) {
  const cpuCores = Number(draft.cpuCores), memoryGiB = Number(draft.memoryGiB);
  if (!draft.cpuCores.trim() || !Number.isInteger(cpuCores) || cpuCores < limits.cpuCores.min || cpuCores > limits.cpuCores.max ||
    !draft.memoryGiB.trim() || !Number.isInteger(memoryGiB) || memoryGiB < limits.memoryGiB.min || memoryGiB > limits.memoryGiB.max ||
    !draft.timezone || draft.timezone.length > 64) return null;
  try { new Intl.DateTimeFormat('en', { timeZone: draft.timezone }); }
  catch { return null; }
  return { cpuCores, memoryGiB, timezone: draft.timezone };
}
