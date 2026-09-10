import * as fs from "node:fs";

import { isVortexInFlatpak } from "./flatpakSupport";
import { isVortexInSnap } from "./snapSupport";

export type LinuxSessionType = "wayland" | "x11" | "unknown";
export type LinuxSandboxType = "flatpak" | "snap" | "none";

export interface IDesktopPortalEnvironment {
  desktop: string;
  sessionType: LinuxSessionType;
  sandbox: LinuxSandboxType;
  isWayland: boolean;
  isSandboxed: boolean;
  portalRequired: boolean;
  portalFileChooserActive: boolean;
  availablePortals: string[];
}

const KNOWN_PORTAL_INTERFACES = [
  "org.freedesktop.portal.FileChooser",
  "org.freedesktop.portal.OpenURI",
  "org.freedesktop.portal.AppChooser",
  "org.freedesktop.portal.Inhibit",
];

/**
 * Визначення активного графічного середовища (Desktop Environment) згідно з XDG-специфікацією.
 * Підтримує GNOME, KDE Plasma, XFCE, Cinnamon, MATE, LXQt, Hyprland, Sway тощо.
 */
export function detectDesktopEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  const raw =
    env.XDG_CURRENT_DESKTOP || env.XDG_SESSION_DESKTOP || env.DESKTOP_SESSION || "unknown";
  // Деякі дистрибутиви повертають "ubuntu:GNOME" або "pop:GNOME"
  if (raw.toLowerCase().includes("gnome")) return "GNOME";
  if (raw.toLowerCase().includes("kde") || raw.toLowerCase().includes("plasma")) return "KDE";
  if (raw.toLowerCase().includes("xfce")) return "XFCE";
  if (raw.toLowerCase().includes("cinnamon")) return "Cinnamon";
  return raw;
}

/**
 * Визначення типу сесії дисплея: Wayland або X11.
 *
 * Освітній коментар:
 * На Wayland прямий доступ до віконного менеджера, захоплення екрана та глобальних координат
 * обмежений з міркувань безпеки. Діалоги вибору файлів та відкриття посилань
 * мають делегуватися XDG Desktop Portals (через D-Bus).
 */
export function detectSessionType(env: NodeJS.ProcessEnv = process.env): LinuxSessionType {
  const session = env.XDG_SESSION_TYPE?.toLowerCase();
  if (session === "wayland" || Boolean(env.WAYLAND_DISPLAY)) {
    return "wayland";
  }
  if (session === "x11" || Boolean(env.DISPLAY)) {
    return "x11";
  }
  return "unknown";
}

/**
 * Визначення активної пісочниці процесу (Flatpak або Snap).
 */
export function detectSandboxType(env: NodeJS.ProcessEnv = process.env): LinuxSandboxType {
  if (isVortexInFlatpak()) return "flatpak";
  if (isVortexInSnap(env)) return "snap";
  return "none";
}

/**
 * Комплексна оцінка інтеграції з XDG Desktop Portals для робочого столу Linux.
 */
export function assessDesktopPortalEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): IDesktopPortalEnvironment {
  const desktop = detectDesktopEnvironment(env);
  const sessionType = detectSessionType(env);
  const sandbox = detectSandboxType(env);

  const isWayland = sessionType === "wayland";
  const isSandboxed = sandbox !== "none";

  // На Wayland або у пісочницях Flatpak/Snap портали є обов'язковими для файлових діалогів та URL
  const portalRequired = isSandboxed || isWayland;

  // Чи активний портал вибору файлів (у Flatpak/Snap або коли встановлено GTK_USE_PORTAL=1)
  const portalFileChooserActive = isSandboxed || env.GTK_USE_PORTAL === "1";

  return {
    desktop,
    sessionType,
    sandbox,
    isWayland,
    isSandboxed,
    portalRequired,
    portalFileChooserActive,
    availablePortals: portalRequired ? KNOWN_PORTAL_INTERFACES : [],
  };
}

/**
 * Валідація URI для безпечного відкриття через портал OpenURI або xdg-open.
 * Запобігає ін'єкціям небезпечних команд або протоколів.
 */
export function validatePortalUri(uri: string): void {
  if (!uri || typeof uri !== "string") {
    throw new Error("Target URI must be a non-empty string");
  }

  // Заборона null-байтів та символів нового рядка
  if (/[\0\r\n]/.test(uri)) {
    throw new Error(`URI contains forbidden control characters: ${uri}`);
  }

  const match = uri.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (!match) {
    throw new Error(`Invalid URI scheme: ${uri}`);
  }

  const scheme = match[1].toLowerCase();
  const allowedSchemes = new Set(["http", "https", "steam", "heroic", "lutris", "mailto", "file"]);
  if (!allowedSchemes.has(scheme)) {
    throw new Error(`Refusing to open unsafe protocol via portal: ${scheme}`);
  }

  // Перевірка на ін'єкції оболонки у xdg-open
  if (/[;&|`$]/.test(uri)) {
    throw new Error(`URI contains shell metacharacters: ${uri}`);
  }
}

/**
 * Генерація безпечної команди виклику порталу OpenURI через xdg-open.
 */
export function buildPortalOpenUriCommand(uri: string): string {
  validatePortalUri(uri);
  const quote = (val: string) => `'${val.replace(/'/g, `'\\''`)}'`;
  return `xdg-open ${quote(uri)}`;
}
