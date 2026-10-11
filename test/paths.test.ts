// Where Selah keeps its files on each system (HAL-2624).
import { describe, expect, test } from "bun:test"
import { resolveRoot } from "../src/data/paths"

describe("data, config and cache locations", () => {
  test("Windows: settings roam in %APPDATA%, everything else stays in %LOCALAPPDATA%", () => {
    const env = { APPDATA: "C:\\Users\\ruth\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\ruth\\AppData\\Local" }
    expect(resolveRoot("config", env, "win32", "C:\\Users\\ruth")).toBe("C:\\Users\\ruth\\AppData\\Roaming\\selah")
    expect(resolveRoot("data", env, "win32", "C:\\Users\\ruth")).toBe("C:\\Users\\ruth\\AppData\\Local\\selah\\data")
    expect(resolveRoot("cache", env, "win32", "C:\\Users\\ruth")).toBe("C:\\Users\\ruth\\AppData\\Local\\selah\\cache")
  })

  test("Windows without the variables falls back under the profile", () => {
    expect(resolveRoot("data", {}, "win32", "C:\\Users\\ruth")).toBe("C:\\Users\\ruth\\AppData\\Local\\selah\\data")
    expect(resolveRoot("config", {}, "win32", "C:\\Users\\ruth")).toBe("C:\\Users\\ruth\\AppData\\Roaming\\selah")
  })

  test("Linux and macOS follow XDG, and an absolute XDG variable wins anywhere", () => {
    expect(resolveRoot("data", {}, "linux", "/home/ruth")).toBe("/home/ruth/.local/share/selah")
    expect(resolveRoot("config", {}, "darwin", "/Users/ruth")).toBe("/Users/ruth/.config/selah")
    expect(resolveRoot("cache", { XDG_CACHE_HOME: "/tmp/c" }, "linux", "/home/ruth")).toBe("/tmp/c/selah")
    expect(resolveRoot("data", { XDG_DATA_HOME: "relative/no" }, "linux", "/home/ruth")).toBe("/home/ruth/.local/share/selah")
  })

  test("SELAH_HOME puts everything in one directory", () => {
    expect(resolveRoot("data", { SELAH_HOME: "/tmp/s", APPDATA: "x" }, "win32", "C:\\u")).toBe("/tmp/s/data")
  })
})
