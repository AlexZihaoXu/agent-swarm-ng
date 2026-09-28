/** A part of the agent settings page that can hold unsaved changes. Sections register with the page, which owns Save and Discard. */
export type SettingsSection = { label: string; dirty: boolean; save: () => Promise<void>; discard: () => void };
export type RegisterSection = (name: string, section?: SettingsSection) => void;
