import { describe, expect, it } from "vitest";

import {
  assessDesktopPortalEnvironment,
  buildPortalOpenUriCommand,
  detectDesktopEnvironment,
  detectSandboxType,
  detectSessionType,
  validatePortalUri,
} from "./desktopPortals";

describe("desktopPortals", () => {
  it("detects desktop environments properly", () => {
    expect(detectDesktopEnvironment({ XDG_CURRENT_DESKTOP: "KDE" })).toBe("KDE");
    expect(detectDesktopEnvironment({ XDG_CURRENT_DESKTOP: "ubuntu:GNOME" })).toBe("GNOME");
    expect(detectDesktopEnvironment({ XDG_CURRENT_DESKTOP: "XFCE" })).toBe("XFCE");
    expect(detectDesktopEnvironment({})).toBe("unknown");
  });

  it("detects Wayland and X11 sessions", () => {
    expect(detectSessionType({ XDG_SESSION_TYPE: "wayland" })).toBe("wayland");
    expect(detectSessionType({ WAYLAND_DISPLAY: "wayland-0" })).toBe("wayland");
    expect(detectSessionType({ XDG_SESSION_TYPE: "x11" })).toBe("x11");
    expect(detectSessionType({ DISPLAY: ":0" })).toBe("x11");
    expect(detectSessionType({})).toBe("unknown");
  });

  it("evaluates portal requirements for sandboxed and Wayland sessions", () => {
    const waylandKde = assessDesktopPortalEnvironment({
      XDG_CURRENT_DESKTOP: "KDE",
      XDG_SESSION_TYPE: "wayland",
    });
    expect(waylandKde.isWayland).toBe(true);
    expect(waylandKde.portalRequired).toBe(true);
    expect(waylandKde.availablePortals).toContain("org.freedesktop.portal.FileChooser");
    expect(waylandKde.availablePortals).toContain("org.freedesktop.portal.OpenURI");

    const x11Native = assessDesktopPortalEnvironment({
      XDG_CURRENT_DESKTOP: "XFCE",
      XDG_SESSION_TYPE: "x11",
    });
    expect(x11Native.isWayland).toBe(false);
    expect(x11Native.portalRequired).toBe(false);
    expect(x11Native.availablePortals).toEqual([]);
  });

  it("validates safe URIs and rejects malicious schemes or shell injections", () => {
    expect(() => validatePortalUri("https://www.nexusmods.com/skyrimspecialedition")).not.toThrow();
    expect(() => validatePortalUri("steam://run/489830")).not.toThrow();
    expect(() => validatePortalUri("heroic://launch/489830")).not.toThrow();
    expect(() => validatePortalUri("lutris:rungame/skyrim")).not.toThrow();

    // Dangerous schemes
    expect(() => validatePortalUri("javascript:alert(1)")).toThrowError(
      /Refusing to open unsafe protocol/,
    );
    expect(() => validatePortalUri("data:text/html,test")).toThrowError(
      /Refusing to open unsafe protocol/,
    );

    // Shell metacharacters
    expect(() => validatePortalUri("https://nexusmods.com; rm -rf /")).toThrowError(
      /shell metacharacters/,
    );
    expect(() => validatePortalUri("steam://run/489830`reboot`")).toThrowError(
      /shell metacharacters/,
    );
  });

  it("builds safe portal open command", () => {
    expect(buildPortalOpenUriCommand("https://nexusmods.com")).toBe(
      "xdg-open 'https://nexusmods.com'",
    );
  });
});
