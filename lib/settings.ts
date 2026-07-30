import {
  DEFAULT_PRIVACY_CLASS,
  DEFAULT_TRUTH_STATUS,
  PRIVACY_CLASSES,
  TRUTH_STATUSES,
  type PrivacyClass,
  type TruthStatus,
} from "./types";

// P0A Settings per v2.2.2 C1: profile placeholder (name, target role) plus
// defaults for new entries. C1 locks Settings to a UI-only surface with no
// schema impact, so these persist in localStorage on the capturing device.

export interface UserSettings {
  profile_name: string;
  target_role: string;
  default_truth_status: TruthStatus;
  default_privacy_class: PrivacyClass;
}

const STORAGE_KEY = "ccc-settings-v1";

export const DEFAULT_SETTINGS: UserSettings = {
  profile_name: "",
  target_role: "",
  default_truth_status: DEFAULT_TRUTH_STATUS,
  default_privacy_class: DEFAULT_PRIVACY_CLASS,
};

export function normalizeSettings(raw: unknown): UserSettings {
  const out: UserSettings = { ...DEFAULT_SETTINGS };
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (typeof r.profile_name === "string") out.profile_name = r.profile_name.slice(0, 200);
    if (typeof r.target_role === "string") out.target_role = r.target_role.slice(0, 200);
    if (TRUTH_STATUSES.includes(r.default_truth_status as TruthStatus)) {
      out.default_truth_status = r.default_truth_status as TruthStatus;
    }
    if (PRIVACY_CLASSES.includes(r.default_privacy_class as PrivacyClass)) {
      out.default_privacy_class = r.default_privacy_class as PrivacyClass;
    }
  }
  return out;
}

export function loadSettings(): UserSettings {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: UserSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
}
