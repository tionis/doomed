export type ScimUser = {
  id: string;
  userName: string;
  emails: Array<{ value: string }>;
  active: boolean;
  entitlements?: string[];
};

const PATH = new URL(
  process.env.SCIM_DATA_PATH ?? "../../data/scim-users.json",
  import.meta.url,
);

let cache: Map<string, ScimUser> | null = null;

export async function scimUsers(): Promise<Map<string, ScimUser>> {
  if (cache) return cache;
  cache = new Map();
  try {
    const file = Bun.file(PATH);
    if (await file.exists()) {
      const users = (await file.json()) as ScimUser[];
      for (const u of users) cache.set(u.id, u);
    }
  } catch {
    // start empty
  }
  return cache;
}

export async function saveScimUsers() {
  if (!cache) return;
  await Bun.write(PATH, JSON.stringify([...cache.values()]));
}

export async function findScimUserByEmail(email: string): Promise<ScimUser | null> {
  const users = await scimUsers();
  const lower = email.toLowerCase();
  for (const u of users.values()) {
    if (!u.active) continue;
    if (u.userName.toLowerCase() === lower) return u;
    if (u.emails.some((e) => e.value.toLowerCase() === lower)) return u;
  }
  return null;
}

export async function isOrgAdmin(email: string): Promise<boolean> {
  const user = await findScimUserByEmail(email);
  return Boolean(user?.entitlements?.some((e) => e.toLowerCase() === "admin"));
}
