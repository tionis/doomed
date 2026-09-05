import { afterEach, describe, expect, test } from "bun:test";
import { isOrgAdmin, saveScimUsers, scimUsers } from "./scimStore.js";

process.env.SCIM_DATA_PATH = "../test-scim-users.json";

afterEach(async () => {
  const users = await scimUsers();
  users.clear();
  await saveScimUsers();
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(new URL(process.env.SCIM_DATA_PATH!, import.meta.url).pathname);
  } catch {
    // ignore
  }
});

describe("scimStore", () => {
  test("unknown email is not an org admin", async () => {
    expect(await isOrgAdmin("nobody@example.com")).toBe(false);
  });

  test("admin entitlement grants org admin, deactivation revokes", async () => {
    const users = await scimUsers();
    users.set("u1", {
      id: "u1",
      userName: "boss@example.com",
      emails: [{ value: "boss@example.com" }],
      active: true,
      entitlements: ["admin"],
    });
    expect(await isOrgAdmin("boss@example.com")).toBe(true);
    users.get("u1")!.active = false;
    expect(await isOrgAdmin("boss@example.com")).toBe(false);
  });
});
