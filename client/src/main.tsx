import { createRoot } from "react-dom/client";
import { id, lookup, tx } from "@instantdb/react";
import type { AuthState, User } from "@instantdb/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { db, instantAppId } from "./instant";
import {
  bannedWordsForRound,
  findBlockedSubmissionPhrases,
  generateCode,
  mockJudgment,
  panicSubmission,
  pickScenario,
} from "./game";
import {
  aiProviderPresets,
  completeOpenRouterOAuthFromUrl,
  consumeOpenRouterOAuthNotice,
  defaultAiSettings,
  judgeSubmission,
  listAiModels,
  loadAiSettings,
  openRouterOAuthDebug,
  saveAiSettings,
  startOpenRouterOAuth,
  testAiEndpoint,
} from "./ai";
import { createDemoState, type DemoMode } from "./demo";
import type { AdminIdentity, AiSettings, Judgment, Player, Room, Submission } from "./types";
import type { AiModel } from "./ai";
import "./styles.css";

const localClientId = getLocal("jba.clientId", () => crypto.randomUUID());
const oldUnlinkedRoomMs = 7 * 24 * 60 * 60 * 1000;
function App() {
  const params = new URLSearchParams(window.location.search);
  const demosEnabled = params.get("demo") === "1";
  const adminEnabled = params.get("admin") === "1";
  const [demoMode, setDemoMode] = useState<DemoMode | null>(null);
  if (demoMode) {
    return <DemoView mode={demoMode} onExit={() => setDemoMode(null)} />;
  }
  if (!instantAppId || !db) {
    return <SetupScreen demosEnabled={demosEnabled} onDemo={setDemoMode} />;
  }
  return <GameApp demosEnabled={demosEnabled} adminEnabled={adminEnabled} onDemo={setDemoMode} />;
}

function GameApp({
  demosEnabled,
  adminEnabled,
  onDemo,
}: {
  demosEnabled: boolean;
  adminEnabled: boolean;
  onDemo: (mode: DemoMode) => void;
}) {
  const auth = db!.useAuth();
  const adminIdentityQuery = db!.useQuery(
    auth.user?.email
      ? {
          admins: {
            $: { where: { email: auth.user.email } },
          },
        }
      : null,
  );
  const [activeCode, setActiveCode] = useState(getInitialRoomCode());
  const roomQuery = db!.useQuery({
    rooms: { $: { where: { code: activeCode || "__none__" } } },
  });
  const room = (roomQuery.data?.rooms?.[0] as Room | undefined) ?? null;
  const roomId = room?.id ?? "__none__";
  const dataQuery = db!.useQuery({
    players: { $: { where: { roomId }, order: { seatIndex: "asc" } } },
    submissions: { $: { where: { roomId } } },
    judgments: { $: { where: { roomId } } },
  });

  const rawPlayers = (dataQuery.data?.players ?? []) as Player[];
  const submissions = (dataQuery.data?.submissions ?? []) as Submission[];
  const judgments = (dataQuery.data?.judgments ?? []) as Judgment[];
  const players = dedupePlayersByClient(
    rawPlayers,
    submissions,
    judgments,
    room?.status === "finished" ? undefined : room?.roundIndex,
  ).sort((a, b) => a.seatIndex - b.seatIndex);
  const me = players.find((player) => player.clientId === localClientId);
  const isHost = Boolean(room && room.hostClientId === localClientId);

  useEffect(() => {
    if (activeCode) localStorage.setItem("jba.roomCode", activeCode);
    else localStorage.removeItem("jba.roomCode");
  }, [activeCode]);

  useEffect(() => {
    if (!me) return;
    const heartbeat = setInterval(() => {
      void db!.transact(
        tx.players[me.id].update({ connected: true, lastSeenAt: Date.now() }),
      );
    }, 15_000);
    return () => clearInterval(heartbeat);
  }, [me?.id]);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [narratorEnabled, setNarratorEnabled] = useState(
    localStorage.getItem("jba.narrator") === "1",
  );
  const isAdmin = Boolean((adminIdentityQuery.data?.admins ?? []).length);
  const openRoom = (code: string) => {
    setActiveCode(code);
    const url = new URL(window.location.href);
    if (code) url.searchParams.set("room", code);
    else url.searchParams.delete("room");
    window.history.replaceState(null, "", url);
  };

  useEffect(() => {
    localStorage.setItem("jba.narrator", narratorEnabled ? "1" : "0");
  }, [narratorEnabled]);

  useEffect(() => {
    const storedNotice = consumeOpenRouterOAuthNotice();
    if (storedNotice) setNotice(storedNotice);
    void completeOpenRouterOAuthFromUrl()
      .then((message) => {
        if (message) setNotice(message);
      })
      .catch((error) => {
        setError(error instanceof Error ? error.message : "OpenRouter OAuth failed");
      });
  }, []);

  return (
    <main>
      <header className="topbar">
        <BrandTitle subtitle="Bad plans die fast. Good plans get judged anyway." />
        {room && (
          <button className="secondary" onClick={() => openRoom("")}>
            Home
          </button>
        )}
        {isAdmin && !adminEnabled && !room && (
          <button
            className="secondary"
            onClick={() => {
              const url = new URL(window.location.href);
              url.searchParams.set("admin", "1");
              window.history.replaceState(null, "", url);
              window.location.reload();
            }}
          >
            Admin
          </button>
        )}
        {adminEnabled && (
          <button
            className="secondary"
            onClick={() => {
              const url = new URL(window.location.href);
              url.searchParams.delete("admin");
              window.history.replaceState(null, "", url);
              window.location.reload();
            }}
          >
            Home
          </button>
        )}
        <AuthWidget auth={auth} onError={setError} />
      </header>

      {error && (
        <button className="error" onClick={() => setError("")}>
          {error}
        </button>
      )}
      {notice && (
        <button className="notice-message" onClick={() => setNotice("")}>
          {notice}
        </button>
      )}

      {adminEnabled ? (
        <AdminGate
          auth={auth}
          onRoom={(code) => {
            const url = new URL(window.location.href);
            url.searchParams.set("room", code);
            url.searchParams.delete("admin");
            window.history.replaceState(null, "", url);
            window.location.reload();
          }}
          onError={setError}
          onExit={() => {
            const url = new URL(window.location.href);
            url.searchParams.delete("admin");
            window.history.replaceState(null, "", url);
            window.location.reload();
          }}
        />
      ) : !room ? (
        <Home
          authUser={auth.user}
          onRoom={openRoom}
          onError={setError}
          demosEnabled={demosEnabled}
          onDemo={onDemo}
        />
      ) : (
        <RoomView
          room={room}
          players={players}
          allPlayers={rawPlayers}
          submissions={submissions}
          judgments={judgments}
          me={me}
          isHost={isHost}
          authUser={auth.user}
          onError={setError}
          readOnly={false}
          playersLoaded={!dataQuery.isLoading}
          narratorEnabled={narratorEnabled}
          onNarratorChange={setNarratorEnabled}
        />
      )}
    </main>
  );
}

function BrandTitle({ subtitle }: { subtitle?: string }) {
  return (
    <div className="brand">
      <img className="brand-logo" src={assetPath("logo.svg")} alt="" />
      <div>
        <h1>Judged by AI</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </div>
  );
}

function SetupScreen({
  demosEnabled,
  onDemo,
}: {
  demosEnabled: boolean;
  onDemo: (mode: DemoMode) => void;
}) {
  return (
    <main>
      <section className="panel auth">
        <BrandTitle />
        <h2>InstantDB app required</h2>
        <p className="muted">
          Set <code>VITE_INSTANT_APP_ID</code> in <code>.env</code>, then restart
          the dev server. The game is a static app and uses InstantDB for room
          sync.
        </p>
        {!demosEnabled && (
          <p className="muted">
            Demo screens are available at <code>?demo=1</code>.
          </p>
        )}
      </section>
      {demosEnabled && <DemoLauncher onDemo={onDemo} />}
    </main>
  );
}

function DemoView({ mode, onExit }: { mode: DemoMode; onExit: () => void }) {
  const demo = useMemo(() => createDemoState(mode), [mode]);
  return (
    <main>
      <header className="topbar">
        <BrandTitle subtitle="Demo mode for status updates. No InstantDB writes, no AI calls." />
        <button className="secondary" onClick={onExit}>
          Exit demo
        </button>
      </header>
      <div className="demo-banner">
        <strong>{demoLabel(mode)}</strong>
        <span>Read-only walkthrough state seeded locally in the browser.</span>
      </div>
      <RoomView
        room={demo.room}
        players={demo.players}
        allPlayers={demo.players}
        submissions={demo.submissions}
        judgments={demo.judgments}
        me={demo.me}
        isHost={false}
        authUser={null}
        onError={() => undefined}
        readOnly
        playersLoaded
        narratorEnabled={false}
        onNarratorChange={() => undefined}
      />
    </main>
  );
}

function Home({
  authUser,
  onRoom,
  onError,
  demosEnabled,
  onDemo,
}: {
  authUser?: User | null;
  onRoom: (code: string) => void;
  onError: (error: string) => void;
  demosEnabled: boolean;
  onDemo: (mode: DemoMode) => void;
}) {
  const [hostName, setHostName] = useState(localStorage.getItem("jba.name") ?? "Host");
  const [guestName, setGuestName] = useState(localStorage.getItem("jba.name") ?? "Guest");
  const [code, setCode] = useState("");
  const [roundCount, setRoundCount] = useState(5);
  const [submissionSeconds, setSubmissionSeconds] = useState(60);
  const [difficulty, setDifficulty] = useState<Room["difficulty"]>("normal");

  async function createRoom() {
    try {
      const roomId = id();
      const playerId = id();
      const roomCode = generateCode();
      const now = Date.now();
      localStorage.setItem("jba.name", hostName);
      await db!.transact([
        tx.rooms[roomId].update({
          code: roomCode,
          hostClientId: localClientId,
          ...(authUser
            ? {
                hostUserId: authUser.id,
                ...(authUser.email ? { hostEmail: authUser.email } : {}),
                hiddenFromHostHistory: false,
              }
            : {}),
          hostName,
          status: "lobby",
          roundIndex: 0,
          roundCount,
          submissionSeconds,
          difficulty,
          revealIndex: 0,
          createdAt: now,
          updatedAt: now,
        }),
        tx.players[playerId].update({
          roomId,
          clientId: localClientId,
          name: hostName,
          seatIndex: 0,
          isHost: true,
          connected: true,
          ready: true,
          score: 0,
          survivalCount: 0,
          deathCount: 0,
          joinedAt: now,
          lastSeenAt: now,
        }),
      ]);
      onRoom(roomCode);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not create room");
    }
  }

  async function joinRoom() {
    try {
      localStorage.setItem("jba.name", guestName);
      onRoom(code.toUpperCase());
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not join room");
    }
  }

  return (
    <>
      <section className="homegrid">
        <div className="panel">
          <div className="section-heading">
            <h2>Create room</h2>
            <AiSettingsLauncher compact />
          </div>
          <label>
            Host name
            <input value={hostName} onChange={(event) => setHostName(event.target.value)} />
          </label>
          <div className="settings">
            <label>
              Rounds
              <input
                type="number"
                min={1}
                max={10}
                value={roundCount}
                onChange={(event) => setRoundCount(Number(event.target.value))}
              />
            </label>
            <label>
              Seconds
              <input
                type="number"
                min={20}
                max={240}
                value={submissionSeconds}
                onChange={(event) => setSubmissionSeconds(Number(event.target.value))}
              />
            </label>
            <label>
              Difficulty
              <select
                value={difficulty}
                onChange={(event) => setDifficulty(event.target.value as Room["difficulty"])}
              >
                <option value="easy">Easy</option>
                <option value="normal">Normal</option>
                <option value="ruthless">Ruthless</option>
              </select>
            </label>
          </div>
          <button onClick={createRoom}>Create</button>
        </div>
        <div className="panel">
          <h2>Join as guest</h2>
          <label>
            Display name
            <input value={guestName} onChange={(event) => setGuestName(event.target.value)} />
          </label>
          <label>
            Code
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="B7KQ"
            />
          </label>
          <button onClick={joinRoom}>Join</button>
        </div>
      </section>
      <HostDashboard authUser={authUser} onRoom={onRoom} onError={onError} />
      {demosEnabled && <DemoLauncher onDemo={onDemo} />}
    </>
  );
}

function AuthWidget({
  auth,
  onError,
}: {
  auth: AuthState;
  onError: (error: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  async function sendCode() {
    try {
      await db!.auth.sendMagicCode({ email });
      setSent(true);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not send login code");
    }
  }

  async function verifyCode() {
    try {
      await db!.auth.signInWithMagicCode({ email, code });
      setCode("");
      setSent(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not verify login code");
    }
  }

  async function signOut() {
    try {
      await db!.auth.signOut();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not sign out");
    }
  }

  if (auth.isLoading) {
    return <div className="authbox muted">Checking login...</div>;
  }

  if (auth.user) {
    return (
      <div className="authbox signed-in">
        <span>{auth.user.email ?? "Signed in"}</span>
        {confirmSignOut ? (
          <div className="confirm-actions">
            <button className="secondary danger-action" onClick={signOut}>
              Confirm
            </button>
            <button className="secondary" onClick={() => setConfirmSignOut(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="secondary" onClick={() => setConfirmSignOut(true)}>
            Sign out
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="authbox">
      <input
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="host@example.com"
      />
      {sent && (
        <input
          inputMode="numeric"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="Code"
        />
      )}
      <button
        className="secondary"
        disabled={!email || (sent && !code)}
        onClick={sent ? verifyCode : sendCode}
      >
        {sent ? "Verify" : "Host login"}
      </button>
    </div>
  );
}

function HostDashboard({
  authUser,
  onRoom,
  onError,
}: {
  authUser?: User | null;
  onRoom: (code: string) => void;
  onError: (error: string) => void;
}) {
  const historyQuery = db!.useQuery(
    authUser
      ? {
          rooms: {
            $: {
              where: { hostUserId: authUser.id },
              order: { createdAt: "desc" },
            },
          },
        }
      : null,
  );

  if (!authUser) {
    return (
      <section className="panel dashboard">
        <h2>Host history</h2>
        <p className="muted">
          Sign in before creating a room to keep a host dashboard for finished
          games and share links.
        </p>
      </section>
    );
  }

  const rooms = ((historyQuery.data?.rooms ?? []) as Room[]).filter(
    (room) => !room.hiddenFromHostHistory,
  );
  const finished = rooms.filter((room) => room.status === "finished");
  const active = rooms.filter((room) => room.status !== "finished");

  async function hide(room: Room) {
    try {
      await db!.transact(
        tx.rooms[room.id].update({
          hiddenFromHostHistory: true,
          updatedAt: Date.now(),
        }),
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not remove game");
    }
  }

  return (
    <section className="panel dashboard">
      <div className="section-heading">
        <div>
          <h2>Host history</h2>
          <p className="muted">Finished games stay shareable by link or code.</p>
        </div>
        <span>{historyQuery.isLoading ? "Loading..." : `${rooms.length} game${rooms.length === 1 ? "" : "s"}`}</span>
      </div>
      {rooms.length === 0 ? (
        <p className="muted">No hosted games yet for {authUser.email}.</p>
      ) : (
        <div className="history-list">
          {[...active, ...finished].map((room) => (
            <article className="history-item" key={room.id}>
              <div>
                <strong>{room.code}</strong>
                <span>{room.status.replaceAll("_", " ")}</span>
                <small>{new Date(room.createdAt).toLocaleString()}</small>
              </div>
              <div className="history-actions">
                <button className="secondary" onClick={() => onRoom(room.code)}>
                  Open
                </button>
                <button className="secondary" onClick={() => copyRoomLink(room.code, onError)}>
                  Share
                </button>
                <button className="secondary danger-action" onClick={() => hide(room)}>
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function AdminGate({
  auth,
  onRoom,
  onError,
  onExit,
}: {
  auth: AuthState;
  onRoom: (code: string) => void;
  onError: (error: string) => void;
  onExit: () => void;
}) {
  const adminIdentityQuery = db!.useQuery(
    auth.user?.email
      ? {
          admins: {
            $: { where: { email: auth.user.email } },
          },
        }
      : null,
  );

  if (auth.isLoading) {
    return (
      <section className="panel admin-unlock">
        <h2>Admin</h2>
        <p className="muted">Checking login...</p>
      </section>
    );
  }

  if (!auth.user) {
    return (
      <section className="panel admin-unlock">
        <div>
          <span className="eyebrow">Admin</span>
          <h2>Operations panel</h2>
          <p className="muted">
            Sign in with an admin identity to manage games and run cleanups.
          </p>
        </div>
        <button className="secondary" onClick={onExit}>
          Back
        </button>
      </section>
    );
  }

  const adminIdentities = (adminIdentityQuery.data?.admins ?? []) as AdminIdentity[];
  if (adminIdentityQuery.isLoading) {
    return (
      <section className="panel admin-unlock">
        <h2>Admin</h2>
        <p className="muted">Checking admin membership for {auth.user.email}...</p>
      </section>
    );
  }

  if (adminIdentities.length === 0) {
    return (
      <section className="panel admin-unlock">
        <div>
          <span className="eyebrow">Admin</span>
          <h2>Access denied</h2>
          <p className="muted">
            {auth.user.email} is signed in, but is not linked to an admin identity.
            Add this user in the Instant dashboard or ask an existing admin to add it.
          </p>
        </div>
        <button className="secondary" onClick={onExit}>
          Back
        </button>
      </section>
    );
  }

  return (
    <AdminConsole
      authUser={auth.user}
      onRoom={onRoom}
      onError={onError}
      onExit={onExit}
    />
  );
}

function AdminConsole({
  authUser,
  onRoom,
  onError,
  onExit,
}: {
  authUser: User;
  onRoom: (code: string) => void;
  onError: (error: string) => void;
  onExit: () => void;
}) {
  const [filter, setFilter] = useState<"open" | "active" | "stale" | "unlinked" | "finished" | "archived">("open");
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [newAdminNote, setNewAdminNote] = useState("");
  const [adminNotice, setAdminNotice] = useState("");
  const [deleteConfirmRoomId, setDeleteConfirmRoomId] = useState<string | null>(null);
  const adminQuery = db!.useQuery({
    rooms: { $: { order: { updatedAt: "desc" } } },
    players: {},
    submissions: {},
    judgments: {},
    admins: { $: { order: { createdAt: "asc" } } },
  });

  const rooms = (adminQuery.data?.rooms ?? []) as Room[];
  const players = (adminQuery.data?.players ?? []) as Player[];
  const submissions = (adminQuery.data?.submissions ?? []) as Submission[];
  const judgments = (adminQuery.data?.judgments ?? []) as Judgment[];
  const admins = (adminQuery.data?.admins ?? []) as AdminIdentity[];
  const visibleRooms = rooms.filter((room) => {
    switch (filter) {
      case "active":
        return !room.archivedAt && room.status !== "finished";
      case "stale":
        return !room.archivedAt && isStaleRoom(room);
      case "unlinked":
        return !room.archivedAt && isOldUnlinkedRoom(room);
      case "finished":
        return !room.archivedAt && room.status === "finished";
      case "archived":
        return Boolean(room.archivedAt);
      case "open":
        return !room.archivedAt;
    }
  });
  const counts = {
    total: rooms.length,
    open: rooms.filter((room) => !room.archivedAt).length,
    active: rooms.filter((room) => !room.archivedAt && room.status !== "finished").length,
    stale: rooms.filter((room) => !room.archivedAt && isStaleRoom(room)).length,
    unlinked: rooms.filter((room) => !room.archivedAt && isOldUnlinkedRoom(room)).length,
    finished: rooms.filter((room) => !room.archivedAt && room.status === "finished").length,
    archived: rooms.filter((room) => room.archivedAt).length,
  };

  async function updateRoom(room: Room, patch: Partial<Room>) {
    try {
      await db!.transact(
        tx.rooms[room.id].update({
          ...patch,
          updatedAt: Date.now(),
        }),
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "Admin action failed");
    }
  }

  async function archive(room: Room, reason: string) {
    await updateRoom(room, {
      archivedAt: Date.now(),
      hiddenFromHostHistory: true,
      cleanupReason: reason,
    });
  }

  async function restore(room: Room) {
    await updateRoom(room, {
      archivedAt: 0,
      hiddenFromHostHistory: false,
      cleanupReason: "",
    });
  }

  async function finish(room: Room) {
    const now = Date.now();
    await updateRoom(room, {
      status: "finished",
      finishedAt: room.finishedAt ?? now,
      deadlineAt: 0,
      cleanupReason: room.cleanupReason ?? "Marked finished from admin panel.",
    });
  }

  async function cleanupStale() {
    const staleRooms = rooms.filter((room) => !room.archivedAt && isStaleRoom(room));
    if (staleRooms.length === 0) return;
    const now = Date.now();
    try {
      await db!.transact(
        staleRooms.map((room) =>
          tx.rooms[room.id].update({
            archivedAt: now,
            hiddenFromHostHistory: true,
            cleanupReason: `Archived by stale cleanup after ${formatDuration(now - room.updatedAt)} without updates.`,
            updatedAt: now,
          }),
        ),
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "Cleanup failed");
    }
  }

  async function cleanupOldFinished() {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const oldFinished = rooms.filter(
      (room) =>
        !room.archivedAt &&
        room.status === "finished" &&
        (room.finishedAt ?? room.updatedAt) < cutoff,
    );
    if (oldFinished.length === 0) return;
    const now = Date.now();
    try {
      await db!.transact(
        oldFinished.map((room) =>
          tx.rooms[room.id].update({
            archivedAt: now,
            hiddenFromHostHistory: true,
            cleanupReason: "Archived by old finished game cleanup.",
            updatedAt: now,
          }),
        ),
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "Cleanup failed");
    }
  }

  async function cleanupOldUnlinked() {
    const oldUnlinked = rooms.filter((room) => !room.archivedAt && isOldUnlinkedRoom(room));
    if (oldUnlinked.length === 0) return;
    const now = Date.now();
    try {
      await db!.transact(
        oldUnlinked.map((room) =>
          tx.rooms[room.id].update({
            archivedAt: now,
            hiddenFromHostHistory: true,
            cleanupReason: `Archived unlinked game after ${formatDuration(now - room.updatedAt)} without a host account link.`,
            updatedAt: now,
          }),
        ),
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "Cleanup failed");
    }
  }

  async function shareRoom(code: string) {
    const copied = await copyRoomLink(code, onError);
    if (copied) {
      setAdminNotice(`Copied share link for ${code}.`);
    }
  }

  async function deleteGame(room: Room) {
    try {
      await db!.transact([
        ...judgments
          .filter((judgment) => judgment.roomId === room.id)
          .map((judgment) => tx.judgments[judgment.id].delete()),
        ...submissions
          .filter((submission) => submission.roomId === room.id)
          .map((submission) => tx.submissions[submission.id].delete()),
        ...players
          .filter((player) => player.roomId === room.id)
          .map((player) => tx.players[player.id].delete()),
        tx.rooms[room.id].delete(),
      ]);
      setDeleteConfirmRoomId(null);
      setAdminNotice(`Deleted game ${room.code}.`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not delete game");
    }
  }

  async function addAdmin() {
    const email = newAdminEmail.trim().toLowerCase();
    if (!email) return;
    try {
      await db!.transact(
        tx.admins[id()]
          .update({
            email,
            note: newAdminNote.trim(),
            createdAt: Date.now(),
            createdBy: authUser.email ?? authUser.id,
          })
          .link({ user: lookup("email", email) }),
      );
      setNewAdminEmail("");
      setNewAdminNote("");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not add admin");
    }
  }

  async function removeAdmin(admin: AdminIdentity) {
    try {
      await db!.transact(tx.admins[admin.id].delete());
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not remove admin");
    }
  }

  return (
    <section className="admin-console">
      <div className="panel admin-hero">
        <div>
          <span className="eyebrow">Admin</span>
          <h2>Operations panel</h2>
          <p className="muted">
            Manage all games, inspect counts, and run soft cleanups. Archived games
            are hidden from dashboards but remain shareable if opened directly.
          </p>
        </div>
        <div className="actions">
          <button onClick={cleanupStale} disabled={counts.stale === 0}>
            Archive stale
          </button>
          <button className="secondary" onClick={cleanupOldFinished} disabled={counts.finished === 0}>
            Archive old finished
          </button>
          <button className="secondary" onClick={cleanupOldUnlinked} disabled={counts.unlinked === 0}>
            Archive unlinked
          </button>
          <button className="secondary" onClick={onExit}>
            Back
          </button>
        </div>
      </div>

      <div className="admin-stats">
        <button className={filter === "open" ? "stat active" : "stat"} onClick={() => setFilter("open")}>
          <span>Open</span>
          <strong>{counts.open}</strong>
        </button>
        <button className={filter === "active" ? "stat active" : "stat"} onClick={() => setFilter("active")}>
          <span>Active</span>
          <strong>{counts.active}</strong>
        </button>
        <button className={filter === "stale" ? "stat active" : "stat"} onClick={() => setFilter("stale")}>
          <span>Stale</span>
          <strong>{counts.stale}</strong>
        </button>
        <button className={filter === "unlinked" ? "stat active" : "stat"} onClick={() => setFilter("unlinked")}>
          <span>Unlinked</span>
          <strong>{counts.unlinked}</strong>
        </button>
        <button className={filter === "finished" ? "stat active" : "stat"} onClick={() => setFilter("finished")}>
          <span>Finished</span>
          <strong>{counts.finished}</strong>
        </button>
        <button className={filter === "archived" ? "stat active" : "stat"} onClick={() => setFilter("archived")}>
          <span>Archived</span>
          <strong>{counts.archived}</strong>
        </button>
      </div>

      <div className="panel admin-table">
        <div className="section-heading">
          <div>
            <h3>Games</h3>
            <p className="muted">
              {adminQuery.isLoading ? "Loading..." : `${visibleRooms.length} shown of ${counts.total}`}
            </p>
          </div>
        </div>
        {adminNotice && (
          <button className="submit-status ok notice-button" onClick={() => setAdminNotice("")}>
            {adminNotice}
          </button>
        )}
        {visibleRooms.length === 0 ? (
          <p className="muted">No games match this filter.</p>
        ) : (
          visibleRooms.map((room) => {
            const roomPlayers = players.filter((player) => player.roomId === room.id);
            const roomSubmissions = submissions.filter((submission) => submission.roomId === room.id);
            const roomJudgments = judgments.filter((judgment) => judgment.roomId === room.id);
            return (
              <article className="admin-row" key={room.id}>
                <div>
                  <strong>{room.code}</strong>
                  <span>{room.status.replaceAll("_", " ")}</span>
                  {room.archivedAt ? <small>Archived {new Date(room.archivedAt).toLocaleString()}</small> : null}
                </div>
                <div className="admin-meta">
                  <span>{roomPlayers.length} players</span>
                  <span>{roomSubmissions.length} submissions</span>
                  <span>{roomJudgments.length} judgments</span>
                  <span>Updated {formatDuration(Date.now() - room.updatedAt)} ago</span>
                </div>
                <div className="admin-actions">
                  <button className="secondary" onClick={() => onRoom(room.code)}>
                    Open
                  </button>
                  <button className="secondary" onClick={() => void shareRoom(room.code)}>
                    Share
                  </button>
                  {room.status !== "finished" && (
                    <button className="secondary" onClick={() => finish(room)}>
                      Finish
                    </button>
                  )}
                  {room.archivedAt ? (
                    <button className="secondary" onClick={() => restore(room)}>
                      Restore
                    </button>
                  ) : (
                    <button className="secondary danger-action" onClick={() => archive(room, "Archived from admin panel.")}>
                      Archive
                    </button>
                  )}
                  {deleteConfirmRoomId === room.id ? (
                    <>
                      <button className="secondary danger-action" onClick={() => deleteGame(room)}>
                        Confirm delete
                      </button>
                      <button className="secondary" onClick={() => setDeleteConfirmRoomId(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button className="secondary danger-action" onClick={() => setDeleteConfirmRoomId(room.id)}>
                      Delete
                    </button>
                  )}
                </div>
                {room.cleanupReason && <p className="muted admin-note">{room.cleanupReason}</p>}
              </article>
            );
          })
        )}
      </div>

      <div className="panel admin-table">
        <div className="section-heading">
          <div>
            <h3>Admin identities</h3>
            <p className="muted">
              Admins are Instant users linked by email. Permissions are enforced
              with <code>auth.ref("$user.adminRecords.id")</code>. The target user
              must have signed in at least once.
            </p>
          </div>
        </div>
        <div className="admin-add">
          <input
            type="email"
            value={newAdminEmail}
            onChange={(event) => setNewAdminEmail(event.target.value)}
            placeholder="admin@example.com"
          />
          <input
            value={newAdminNote}
            onChange={(event) => setNewAdminNote(event.target.value)}
            placeholder="Note"
          />
          <button disabled={!newAdminEmail.trim()} onClick={addAdmin}>
            Add admin
          </button>
        </div>
        <div className="history-list">
          {admins.map((admin) => (
            <article className="history-item" key={admin.id}>
              <div>
                <strong className="normal-text">{admin.email}</strong>
                {admin.note && <span>{admin.note}</span>}
                <small>Added {new Date(admin.createdAt).toLocaleString()}</small>
              </div>
              <div className="history-actions">
                <button className="secondary danger-action" onClick={() => removeAdmin(admin)}>
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function DemoLauncher({ onDemo }: { onDemo: (mode: DemoMode) => void }) {
  return (
    <section className="demo-grid">
      <button className="demo-card" onClick={() => onDemo("lobby")}>
        <strong>Lobby</strong>
        <span>Room code, anonymous guests, host ownership.</span>
      </button>
      <button className="demo-card" onClick={() => onDemo("submitting")}>
        <strong>Submissions</strong>
        <span>Scenario, countdown, hidden player answers.</span>
      </button>
      <button className="demo-card" onClick={() => onDemo("revealing")}>
        <strong>Reveal</strong>
        <span>One-by-one AI verdicts and scoring.</span>
      </button>
      <button className="demo-card" onClick={() => onDemo("scoreboard")}>
        <strong>Scoreboard</strong>
        <span>Leaderboard and round summary for the team update.</span>
      </button>
    </section>
  );
}

function demoLabel(mode: DemoMode) {
  switch (mode) {
    case "lobby":
      return "Demo: lobby and guest join";
    case "submitting":
      return "Demo: live submission phase";
    case "revealing":
      return "Demo: AI reveal sequence";
    case "scoreboard":
      return "Demo: scoreboard and results";
  }
}

function RoomView({
  room,
  players,
  allPlayers,
  submissions,
  judgments,
  me,
  isHost,
  authUser,
  onError,
  readOnly,
  playersLoaded,
  narratorEnabled,
  onNarratorChange,
}: {
  room: Room;
  players: Player[];
  allPlayers: Player[];
  submissions: Submission[];
  judgments: Judgment[];
  me?: Player;
  isHost: boolean;
  authUser?: User | null;
  onError: (error: string) => void;
  readOnly: boolean;
  playersLoaded: boolean;
  narratorEnabled: boolean;
  onNarratorChange: (enabled: boolean) => void;
}) {
  useEffect(() => {
    if (readOnly || !playersLoaded || me) return;
    const name = localStorage.getItem("jba.name") ?? (isHost ? room.hostName : "Guest");
    const now = Date.now();
    void db!.transact(
      tx.players[id()].update({
        roomId: room.id,
        clientId: localClientId,
        name,
        seatIndex: isHost ? 0 : players.length,
        isHost,
        connected: true,
        ready: isHost,
        score: 0,
        survivalCount: 0,
        deathCount: 0,
        joinedAt: now,
        lastSeenAt: now,
      }),
    );
  }, [room.id, me?.id, isHost, players.length, readOnly, playersLoaded]);

  useEffect(() => {
    if (readOnly || !isHost || !authUser || room.hostUserId) return;
    void db!.transact(
      tx.rooms[room.id].update({
        hostUserId: authUser.id,
        ...(authUser.email ? { hostEmail: authUser.email } : {}),
        hiddenFromHostHistory: false,
        updatedAt: Date.now(),
      }),
    );
  }, [readOnly, isHost, authUser?.id, authUser?.email, room.id, room.hostUserId]);

  const activePlayer = activePlayerForRoom(room, players);
  const isActivePlayer = Boolean(me && activePlayer?.id === me.id);
  const canControlRound = isHost || isActivePlayer;

  const roundSubmissions = submissions.filter(
    (submission) => submission.roundIndex === room.roundIndex,
  );
  const roundJudgments = judgments.filter(
    (judgment) => judgment.roundIndex === room.roundIndex,
  );

  useEffect(() => {
    if (
      readOnly ||
      !playersLoaded ||
      !isActivePlayer ||
      room.status !== "submitting" ||
      !room.deadlineAt
    ) {
      return;
    }

    if (allPlayersSubmitted(players, roundSubmissions)) {
      void closeSubmissions(room, players, roundSubmissions);
      return;
    }

    const delay = Math.max(0, room.deadlineAt - Date.now()) + 1_000;
    const timeout = window.setTimeout(() => {
      void closeSubmissions(room, players, roundSubmissions);
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [
    readOnly,
    playersLoaded,
    isActivePlayer,
    room.id,
    room.status,
    room.deadlineAt,
    room.roundIndex,
    players,
    roundSubmissions,
  ]);

  return (
    <section className="game">
      <aside className="panel sidebar">
        <div className="codebox">
          <span>Code</span>
          <strong>{room.code}</strong>
        </div>
        <div className="status">{room.status.replaceAll("_", " ")}</div>
        {activePlayer && room.status !== "lobby" && (
          <div className="active-player">
            <span>Active player</span>
            <strong>{activePlayer.name}</strong>
          </div>
        )}
        <PlayerList players={players} submittedIds={roundSubmissions.map((s) => s.playerId)} />
        <NarratorToggle enabled={narratorEnabled} onChange={onNarratorChange} />
        {(isHost || canControlRound) && <AiSettingsLauncher />}
      </aside>
      <section className="stage">
        {room.status === "lobby" ? (
          <Lobby room={room} me={me} players={players} isHost={isHost} readOnly={readOnly} />
        ) : room.status === "finished" ? (
          <GameSummary
            room={room}
            players={players}
            allPlayers={allPlayers}
            submissions={submissions}
            judgments={judgments}
            isHost={isHost}
            readOnly={readOnly}
          />
        ) : (
          <RoundView
            room={room}
            players={players}
            submissions={roundSubmissions}
            judgments={roundJudgments}
            me={me}
            isHost={isHost}
            canControl={canControlRound}
            activePlayer={activePlayer}
            onError={onError}
            readOnly={readOnly}
            narratorEnabled={narratorEnabled}
          />
        )}
      </section>
    </section>
  );
}

function PlayerList({ players, submittedIds }: { players: Player[]; submittedIds: string[] }) {
  return (
    <div className="players">
      {players.map((player) => (
        <div className="player" key={player.id}>
          <span className={Date.now() - player.lastSeenAt < 45_000 ? "dot on" : "dot"} />
          <Avatar player={player} size="sm" />
          <span>{player.name}</span>
          {player.isHost && <small>Host</small>}
          {submittedIds.includes(player.id) && <small>Submitted</small>}
          <strong>{player.score}</strong>
        </div>
      ))}
    </div>
  );
}

function NarratorToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <label className="narrator-toggle">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>Narrator</span>
    </label>
  );
}

function Lobby({
  room,
  me,
  players,
  isHost,
  readOnly,
}: {
  room: Room;
  me?: Player;
  players: Player[];
  isHost: boolean;
  readOnly: boolean;
}) {
  async function toggleReady() {
    if (!me || readOnly) return;
    await db!.transact(tx.players[me.id].update({ ready: !me.ready }));
  }

  async function startGame() {
    if (readOnly) return;
    const scenario = pickScenario(1);
    const activePlayer = players[0];
    await db!.transact(
      tx.rooms[room.id].update({
        status: "round_intro",
        roundIndex: 1,
        revealIndex: 0,
        activePlayerId: activePlayer?.id,
        scenarioTitle: scenario.title,
        scenarioText: scenario.scenarioText,
        immediateThreat: scenario.immediateThreat,
        timePressure: scenario.timePressure,
        category: scenario.category,
        bannedWords: bannedWordsForRound(1),
        updatedAt: Date.now(),
      }),
    );
  }

  return (
    <div className="panel">
      <h2>Lobby</h2>
      <p className="muted">
        {players.length} player{players.length === 1 ? "" : "s"} joined. The host
        starts the game, then round control rotates between players.
      </p>
      <div className="actions">
        {!isHost && (
          <button className={me?.ready ? "secondary" : ""} onClick={toggleReady}>
            {me?.ready ? "Not ready" : "Ready"}
          </button>
        )}
        {isHost && <button onClick={startGame}>Start game</button>}
      </div>
    </div>
  );
}

function RoundView({
  room,
  players,
  submissions,
  judgments,
  me,
  isHost,
  canControl,
  activePlayer,
  onError,
  readOnly,
  narratorEnabled,
}: {
  room: Room;
  players: Player[];
  submissions: Submission[];
  judgments: Judgment[];
  me?: Player;
  isHost: boolean;
  canControl: boolean;
  activePlayer?: Player;
  onError: (error: string) => void;
  readOnly: boolean;
  narratorEnabled: boolean;
}) {
  return (
    <>
      <ScenarioPanel room={room} />
      {room.status === "round_intro" && (
        <IntroControls
          room={room}
          canControl={canControl}
          activePlayer={activePlayer}
          readOnly={readOnly}
        />
      )}
      {room.status === "submitting" && (
        <SubmitPanel
          room={room}
          players={players}
          submissions={submissions}
          me={me}
          submission={submissions.find((s) => s.playerId === me?.id)}
          canControl={canControl}
          readOnly={readOnly}
        />
      )}
      {room.status === "judging" && (
        <JudgingPanel
          room={room}
          players={players}
          submissions={submissions}
          canControl={canControl}
          onError={onError}
          readOnly={readOnly}
        />
      )}
      {room.status === "revealing" && (
        <RevealPanel
          room={room}
          players={players}
          submissions={submissions}
          judgments={judgments}
          canControl={canControl}
          readOnly={readOnly}
          narratorEnabled={narratorEnabled}
        />
      )}
      {(room.status === "scoreboard" || room.status === "finished") && (
        <Scoreboard
          room={room}
          players={players}
          submissions={submissions}
          judgments={judgments}
          canControl={canControl}
          readOnly={readOnly}
        />
      )}
    </>
  );
}

function ScenarioPanel({ room }: { room: Room }) {
  return (
    <div className="scenario">
      <div className="roundline">
        <span>
          Round {room.roundIndex} of {room.roundCount}
        </span>
        <Timer deadlineAt={room.deadlineAt} />
      </div>
      <h2>{room.scenarioTitle}</h2>
      <p>{room.scenarioText}</p>
      <dl>
        <div>
          <dt>Threat</dt>
          <dd>{room.immediateThreat}</dd>
        </div>
        <div>
          <dt>Pressure</dt>
          <dd>{room.timePressure}</dd>
        </div>
      </dl>
      {room.bannedWords?.length ? (
        <div className="banned-words">
          <dt>Banned words</dt>
          <dd>
            {room.bannedWords.map((word) => (
              <span key={word}>{word}</span>
            ))}
          </dd>
        </div>
      ) : null}
    </div>
  );
}

function Timer({ deadlineAt }: { deadlineAt?: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, []);
  if (!deadlineAt) return null;
  const remaining = Math.max(0, Math.ceil((deadlineAt - now) / 1000));
  return <strong className={remaining <= 10 ? "timer danger" : "timer"}>{remaining}s</strong>;
}

function IntroControls({
  room,
  canControl,
  activePlayer,
  readOnly,
}: {
  room: Room;
  canControl: boolean;
  activePlayer?: Player;
  readOnly: boolean;
}) {
  const [customPrompt, setCustomPrompt] = useState("");

  async function openSubmissions() {
    if (readOnly || !canControl) return;
    await db!.transact(
      tx.rooms[room.id].update({
        status: "submitting",
        deadlineAt: Date.now() + room.submissionSeconds * 1000,
        updatedAt: Date.now(),
      }),
    );
  }

  async function rerollPrompt() {
    if (readOnly || !canControl) return;
    const scenario = pickScenario(room.roundIndex + Math.floor(Math.random() * 4) + 1);
    await db!.transact(
      tx.rooms[room.id].update({
        scenarioTitle: scenario.title,
        scenarioText: scenario.scenarioText,
        immediateThreat: scenario.immediateThreat,
        timePressure: scenario.timePressure,
        category: scenario.category,
        updatedAt: Date.now(),
      }),
    );
  }

  async function useCustomPrompt() {
    if (readOnly || !canControl || customPrompt.trim().length < 12) return;
    const text = customPrompt.trim().slice(0, 220);
    await db!.transact(
      tx.rooms[room.id].update({
        scenarioTitle: "Custom calamity",
        scenarioText: text,
        immediateThreat: "The danger is immediate.",
        timePressure: `${room.submissionSeconds} seconds.`,
        category: "custom",
        updatedAt: Date.now(),
      }),
    );
    setCustomPrompt("");
  }

  if (!canControl) {
    return (
      <div className="panel">
        <h3>Brace yourself</h3>
        <p className="muted">
          Waiting for {activePlayer?.name ?? "the active player"} to choose the
          prompt and open submissions.
        </p>
      </div>
    );
  }
  return (
    <div className="panel">
      <h3>Active player controls</h3>
      <p className="muted">Reroll this prompt, write your own, or start the timer.</p>
      <div className="custom-prompt">
        <textarea
          maxLength={220}
          value={customPrompt}
          onChange={(event) => setCustomPrompt(event.target.value)}
          placeholder="Write a one-sentence survival prompt..."
        />
        <span className="muted">{customPrompt.length}/220</span>
      </div>
      <div className="actions">
        <button className="secondary" disabled={readOnly} onClick={rerollPrompt}>
          Reroll prompt
        </button>
        <button
          className="secondary"
          disabled={readOnly || customPrompt.trim().length < 12}
          onClick={useCustomPrompt}
        >
          Use custom prompt
        </button>
        <button disabled={readOnly} onClick={openSubmissions}>
          Open submissions
        </button>
      </div>
    </div>
  );
}

function SubmitPanel({
  room,
  players,
  submissions,
  me,
  submission,
  canControl,
  readOnly,
}: {
  room: Room;
  players: Player[];
  submissions: Submission[];
  me?: Player;
  submission?: Submission;
  canControl: boolean;
  readOnly: boolean;
}) {
  const [text, setText] = useState(submission?.text ?? "");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(submission?.submittedAt ?? null);
  useEffect(() => setText(submission?.text ?? ""), [submission?.id]);
  useEffect(() => setSavedAt(submission?.submittedAt ?? null), [submission?.submittedAt]);

  const trimmedText = text.trim();
  const bannedWordHits = findBannedWords(trimmedText, room.bannedWords ?? []);
  const blockedPhraseHits = findBlockedSubmissionPhrases(trimmedText);
  const hasSubmitted = Boolean(submission);
  const hasUnsavedChanges = trimmedText !== (submission?.text ?? "").trim();
  const disabledReason = readOnly
    ? "Demo mode is read-only."
    : !me
      ? "Joining room..."
      : trimmedText.length < 5
        ? "Write at least 5 characters."
        : bannedWordHits.length > 0
          ? `Remove banned word${bannedWordHits.length === 1 ? "" : "s"}: ${bannedWordHits.join(", ")}.`
          : blockedPhraseHits.length > 0
            ? `Remove judge-control phrase${blockedPhraseHits.length === 1 ? "" : "s"}: ${blockedPhraseHits.join(", ")}.`
          : "";

  async function submit() {
    if (
      !me ||
      readOnly ||
      trimmedText.length < 5 ||
      bannedWordHits.length > 0 ||
      blockedPhraseHits.length > 0
    ) {
      return;
    }
    const now = Date.now();
    setSaving(true);
    try {
      await db!.transact(
        tx.submissions[submission?.id ?? id()].update({
          roomId: room.id,
          roundIndex: room.roundIndex,
          playerId: me.id,
          clientId: localClientId,
          text: trimmedText.slice(0, 500),
          submittedAt: now,
          locked: false,
        }),
      );
      setSavedAt(now);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (
      readOnly ||
      !me ||
      room.status !== "submitting" ||
      !room.deadlineAt ||
      trimmedText.length < 5 ||
      bannedWordHits.length > 0 ||
      blockedPhraseHits.length > 0 ||
      saving ||
      (hasSubmitted && !hasUnsavedChanges)
    ) {
      return;
    }

    const delay = Math.max(0, room.deadlineAt - Date.now() - 250);
    const timeout = window.setTimeout(() => {
      void submit();
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [
    readOnly,
    me?.id,
    room.status,
    room.deadlineAt,
    room.id,
    room.roundIndex,
    trimmedText,
    bannedWordHits.length,
    blockedPhraseHits.length,
    saving,
    hasSubmitted,
    hasUnsavedChanges,
  ]);

  async function close() {
    if (readOnly) return;
    await closeSubmissions(room, players, submissions);
  }

  return (
    <div className="panel submit">
      <h3>Your survival plan</h3>
      <textarea
        maxLength={500}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Describe a specific, plausible action..."
      />
      <div className="actions">
        <span className="muted">{text.length}/500</span>
        <button
          className={hasSubmitted && !hasUnsavedChanges ? "submitted-button" : ""}
          disabled={Boolean(disabledReason) || saving}
          onClick={submit}
        >
          {saving
            ? "Saving..."
            : !me
              ? "Joining..."
            : hasSubmitted && !hasUnsavedChanges
              ? "Submitted"
              : hasSubmitted
                ? "Update submission"
                : "Submit"}
        </button>
        {canControl && (
          <button className="secondary" onClick={close}>
            Close
          </button>
        )}
      </div>
      <div className={hasSubmitted && !hasUnsavedChanges ? "submit-status ok" : "submit-status"}>
        {disabledReason
          ? disabledReason
          : hasSubmitted
          ? hasUnsavedChanges
            ? "You have unsaved edits. Submit again to update your answer."
            : `Submitted${savedAt ? ` at ${new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}. You can still edit until submissions close.`
          : "Not submitted yet. A valid draft will auto-submit when the timer ends."}
      </div>
    </div>
  );
}

function JudgingPanel({
  room,
  players,
  submissions,
  canControl,
  onError,
  readOnly,
}: {
  room: Room;
  players: Player[];
  submissions: Submission[];
  canControl: boolean;
  onError: (error: string) => void;
  readOnly: boolean;
}) {
  const [running, setRunning] = useState(false);

  async function runJudging() {
    if (readOnly) return;
    setRunning(true);
    try {
      const settings = loadAiSettings();
      const chunks = [];
      const completeSubmissions = [...submissions];
      for (const player of players) {
        if (!completeSubmissions.some((submission) => submission.playerId === player.id)) {
          completeSubmissions.push(panicSubmission(player.id, room.id, room.roundIndex));
        }
      }

      for (const submission of completeSubmissions) {
        if (!submissions.some((existing) => existing.id === submission.id)) {
          const { id: _ignored, ...submissionData } = submission;
          chunks.push(tx.submissions[id()].update(submissionData));
        }
      }

      for (const submission of completeSubmissions) {
        const player = players.find((candidate) => candidate.id === submission.playerId);
        let judgment: Omit<Judgment, "id" | "createdAt">;
        try {
          judgment = await judgeSubmission({
            settings,
            scenario: {
              title: room.scenarioTitle ?? "",
              scenarioText: room.scenarioText ?? "",
              immediateThreat: room.immediateThreat ?? "",
              timePressure: room.timePressure ?? "",
            },
            submission,
            playerName: player?.name ?? "Player",
            difficulty: room.difficulty,
          });
        } catch (error) {
          onError(error instanceof Error ? error.message : "AI judging failed; using mock judgment");
          judgment = mockJudgment({ submission, difficulty: room.difficulty });
        }
        chunks.push(tx.judgments[id()].update({ ...judgment, createdAt: Date.now() }));
        if (player) {
          chunks.push(
            tx.players[player.id].update({
              score: player.score + judgment.pointsAwarded,
              survivalCount: player.survivalCount + (judgment.survived ? 1 : 0),
              deathCount: player.deathCount + (judgment.survived ? 0 : 1),
            }),
          );
        }
      }

      chunks.push(
        tx.rooms[room.id].update({
          status: "revealing",
          revealIndex: 1,
          updatedAt: Date.now(),
        }),
      );
      await db!.transact(chunks);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="panel">
      <h3>Judging</h3>
      <p className="muted">
        {canControl
          ? "Run the judge from this browser. Your AI token stays local."
          : "The active player is judging submissions."}
      </p>
      {canControl && (
        <button disabled={running} onClick={runJudging}>
          {running ? "Judging..." : "Run AI judge"}
        </button>
      )}
    </div>
  );
}

function RevealPanel({
  room,
  players,
  submissions,
  judgments,
  canControl,
  readOnly,
  narratorEnabled,
}: {
  room: Room;
  players: Player[];
  submissions: Submission[];
  judgments: Judgment[];
  canControl: boolean;
  readOnly: boolean;
  narratorEnabled: boolean;
}) {
  const visiblePlayers = players.slice(0, room.revealIndex);
  async function advance() {
    if (readOnly) return;
    if (room.revealIndex < players.length) {
      await db!.transact(tx.rooms[room.id].update({ revealIndex: room.revealIndex + 1 }));
    } else {
      await db!.transact(tx.rooms[room.id].update({ status: "scoreboard", updatedAt: Date.now() }));
    }
  }
  return (
    <div>
      <ResultCards
        players={visiblePlayers}
        submissions={submissions}
        judgments={judgments}
        autoNarrate={narratorEnabled}
        suspenseReveal
      />
      {canControl && <button onClick={advance}>Advance reveal</button>}
    </div>
  );
}

function Scoreboard({
  room,
  players,
  submissions,
  judgments,
  canControl,
  readOnly,
}: {
  room: Room;
  players: Player[];
  submissions: Submission[];
  judgments: Judgment[];
  canControl: boolean;
  readOnly: boolean;
}) {
  const leaders = [...players].sort((a, b) => b.score - a.score);
  async function next() {
    if (readOnly) return;
    if (room.roundIndex >= room.roundCount) {
      const now = Date.now();
      await db!.transact(
        tx.rooms[room.id].update({ status: "finished", finishedAt: now, updatedAt: now }),
      );
      return;
    }
    const nextIndex = room.roundIndex + 1;
    const scenario = pickScenario(nextIndex);
    const nextActivePlayer = activePlayerForRound(players, nextIndex);
    await db!.transact(
      tx.rooms[room.id].update({
        status: "round_intro",
        roundIndex: nextIndex,
        revealIndex: 0,
        deadlineAt: 0,
        activePlayerId: nextActivePlayer?.id,
        scenarioTitle: scenario.title,
        scenarioText: scenario.scenarioText,
        immediateThreat: scenario.immediateThreat,
        timePressure: scenario.timePressure,
        category: scenario.category,
        bannedWords: bannedWordsForRound(nextIndex),
        updatedAt: Date.now(),
      }),
    );
  }

  return (
    <div className="scoregrid">
      <div className="panel">
        <h3>{room.status === "finished" ? "Final leaderboard" : "Scoreboard"}</h3>
        {leaders.map((player, index) => (
          <div className="rank" key={player.id}>
            <span>{index + 1}</span>
            <Avatar player={player} size="sm" />
            <strong>{player.name}</strong>
            <b>{player.score}</b>
          </div>
        ))}
        {canControl && room.status !== "finished" && (
          <button onClick={next}>
            {room.roundIndex >= room.roundCount ? "Finish game" : "Next round"}
          </button>
        )}
      </div>
      <ResultCards players={players} submissions={submissions} judgments={judgments} />
    </div>
  );
}

function GameSummary({
  room,
  players,
  allPlayers,
  submissions,
  judgments,
  isHost,
  readOnly,
}: {
  room: Room;
  players: Player[];
  allPlayers: Player[];
  submissions: Submission[];
  judgments: Judgment[];
  isHost: boolean;
  readOnly: boolean;
}) {
  const leaders = [...players].sort((a, b) => b.score - a.score);
  const playerNames = new Map(allPlayers.map((player) => [player.id, player.name]));
  const roundIndexes = Array.from(
    new Set([
      ...submissions.map((submission) => submission.roundIndex),
      ...judgments.map((judgment) => judgment.roundIndex),
      ...Array.from({ length: room.roundIndex }, (_, index) => index + 1),
    ]),
  ).sort((a, b) => a - b);

  async function hideFromHistory() {
    if (readOnly) return;
    await db!.transact(
      tx.rooms[room.id].update({
        hiddenFromHostHistory: true,
        updatedAt: Date.now(),
      }),
    );
  }

  return (
    <div className="summary">
      <section className="panel summary-hero">
        <div>
          <span className="eyebrow">Game summary</span>
          <h2>{room.code}</h2>
          <p className="muted">
            {players.length} player{players.length === 1 ? "" : "s"} · {roundIndexes.length} round
            {roundIndexes.length === 1 ? "" : "s"} · Finished{" "}
            {new Date(room.finishedAt ?? room.updatedAt).toLocaleString()}
          </p>
        </div>
        <div className="actions">
          <button onClick={() => copyRoomLink(room.code)}>Copy share link</button>
          {isHost && (
            <button className="secondary danger-action" onClick={hideFromHistory}>
              Remove from history
            </button>
          )}
        </div>
      </section>

      <section className="panel">
        <h3>Final scoreboard</h3>
        {leaders.map((player, index) => (
          <div className="rank" key={player.id}>
            <span>{index + 1}</span>
            <Avatar player={player} size="sm" />
            <strong>{player.name}</strong>
            <b>{player.score}</b>
          </div>
        ))}
      </section>

      {roundIndexes.map((roundIndex) => {
        const scenario = pickScenario(roundIndex);
        const roundSubmissions = submissions.filter(
          (submission) => submission.roundIndex === roundIndex,
        );
        const roundJudgments = judgments.filter(
          (judgment) => judgment.roundIndex === roundIndex,
        );
        const judgmentsByPlayer = new Map(
          roundJudgments.map((judgment) => [judgment.playerId, judgment]),
        );

        return (
          <section className="panel round-summary" key={roundIndex}>
            <div className="section-heading">
              <div>
                <span className="eyebrow">Round {roundIndex}</span>
                <h3>{scenario.title}</h3>
              </div>
              <span>{roundSubmissions.length} submission{roundSubmissions.length === 1 ? "" : "s"}</span>
            </div>
            <p className="muted">{scenario.scenarioText}</p>
            <div className="results">
              {roundSubmissions.map((submission) => {
                const judgment = judgmentsByPlayer.get(submission.playerId);
                return (
                  <article className="result" key={submission.id}>
                    <h3 className="result-title">
                      <Avatar
                        player={allPlayers.find((player) => player.id === submission.playerId)}
                      />
                      {playerNames.get(submission.playerId) ?? "Player"}
                    </h3>
                    <p className="submission">{submission.text}</p>
                    {judgment ? (
                      <>
                        <div className={`verdict ${judgment.verdict}`}>
                          {judgment.verdict.replace("_", " ")}
                        </div>
                        <p>{judgment.outcome}</p>
                        <small>{judgment.judgeComment}</small>
                        <div className="breakdown">
                          <span>Logic {judgment.logicScore}/10</span>
                          <span>Creativity {judgment.creativityScore}/10</span>
                          <span>Feasibility {judgment.feasibilityScore}/10</span>
                          <span>Humor {judgment.humorScore}/5</span>
                          <strong>Points +{judgment.pointsAwarded}</strong>
                        </div>
                      </>
                    ) : (
                      <p className="muted">No judgment recorded.</p>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

async function closeSubmissions(
  room: Room,
  players: Player[],
  submissions: Submission[],
) {
  if (room.status !== "submitting") return;
  const chunks = [];
  const now = Date.now();
  const submittedPlayerIds = new Set(submissions.map((submission) => submission.playerId));

  for (const submission of submissions) {
    if (!submission.locked) {
      chunks.push(tx.submissions[submission.id].update({ locked: true }));
    }
  }

  for (const player of players) {
    if (submittedPlayerIds.has(player.id)) continue;
    const panic = panicSubmission(player.id, room.id, room.roundIndex);
    const { id: _ignored, ...panicData } = panic;
    chunks.push(
      tx.submissions[id()].update({
        ...panicData,
        submittedAt: now,
      }),
    );
  }

  chunks.push(
    tx.rooms[room.id].update({
      status: "judging",
      deadlineAt: 0,
      updatedAt: now,
    }),
  );

  await db!.transact(chunks);
}

function allPlayersSubmitted(players: Player[], submissions: Submission[]) {
  if (players.length === 0) return false;
  const submittedPlayerIds = new Set(submissions.map((submission) => submission.playerId));
  return players.every((player) => submittedPlayerIds.has(player.id));
}

function activePlayerForRoom(room: Room, players: Player[]) {
  return players.find((player) => player.id === room.activePlayerId) ?? activePlayerForRound(players, room.roundIndex);
}

function activePlayerForRound(players: Player[], roundIndex: number) {
  if (players.length === 0 || roundIndex <= 0) return undefined;
  return players[(roundIndex - 1) % players.length];
}

function ResultCards({
  players,
  submissions,
  judgments,
  autoNarrate = false,
  suspenseReveal = false,
}: {
  players: Player[];
  submissions: Submission[];
  judgments: Judgment[];
  autoNarrate?: boolean;
  suspenseReveal?: boolean;
}) {
  const lastNarratedId = useRef<string | null>(null);
  const byPlayer = useMemo(() => {
    return {
      submissions: new Map(submissions.map((submission) => [submission.playerId, submission])),
      judgments: new Map(judgments.map((judgment) => [judgment.playerId, judgment])),
    };
  }, [submissions, judgments]);
  const visibleEntries = players
    .filter((player) => byPlayer.submissions.has(player.id) || byPlayer.judgments.has(player.id))
    .map((player) => ({
      player,
      submission: byPlayer.submissions.get(player.id),
      judgment: byPlayer.judgments.get(player.id),
    }));
  const latestJudgmentId = [...visibleEntries].reverse().find((entry) => entry.judgment)?.judgment?.id;

  useEffect(() => {
    if (!autoNarrate) return;
    const latest = [...visibleEntries].reverse().find((entry) => entry.judgment);
    if (!latest?.judgment || latest.judgment.id === lastNarratedId.current) return;
    lastNarratedId.current = latest.judgment.id;
    narrateJudgment(latest.player, latest.judgment);
  }, [autoNarrate, visibleEntries]);

  return (
    <div className="results">
      {visibleEntries
        .map(({ player, submission, judgment }) => {
          return (
            <article
              className={judgment?.verdict === "perished" ? "result death-card" : "result"}
              key={player.id}
            >
              <h3 className="result-title">
                <Avatar player={player} doomed={judgment?.verdict === "perished"} />
                {player.name}
              </h3>
              {submission && <p className="submission">{submission.text}</p>}
              {judgment && (
                <>
                  <div className={`verdict ${judgment.verdict}`}>
                    {judgment.verdict.replace("_", " ")}
                  </div>
                  <JudgmentReveal
                    player={player}
                    judgment={judgment}
                    suspense={suspenseReveal && judgment.id === latestJudgmentId}
                  />
                </>
              )}
            </article>
          );
        })}
    </div>
  );
}

function JudgmentReveal({
  player,
  judgment,
  suspense,
}: {
  player: Player;
  judgment: Judgment;
  suspense: boolean;
}) {
  const [visibleChars, setVisibleChars] = useState(suspense ? 0 : judgment.outcome.length);

  useEffect(() => {
    if (!suspense) {
      setVisibleChars(judgment.outcome.length);
      return;
    }

    setVisibleChars(0);
    const stepMs = Math.max(18, Math.min(42, Math.floor(2400 / Math.max(1, judgment.outcome.length))));
    const interval = window.setInterval(() => {
      setVisibleChars((current) => {
        if (current >= judgment.outcome.length) {
          window.clearInterval(interval);
          return current;
        }
        return current + 1;
      });
    }, stepMs);

    return () => window.clearInterval(interval);
  }, [judgment.id, judgment.outcome, suspense]);

  const complete = visibleChars >= judgment.outcome.length;

  return (
    <>
      <p className={suspense && !complete ? "typed-outcome typing" : "typed-outcome"}>
        {judgment.outcome.slice(0, visibleChars)}
        {suspense && !complete && <span className="type-cursor">|</span>}
      </p>
      {complete && (
        <>
          <small>{judgment.judgeComment}</small>
          <div className="breakdown">
            <span>Logic {judgment.logicScore}/10</span>
            <span>Creativity {judgment.creativityScore}/10</span>
            <span>Feasibility {judgment.feasibilityScore}/10</span>
            <span>Humor {judgment.humorScore}/5</span>
            <strong>Points +{judgment.pointsAwarded}</strong>
          </div>
          <button className="secondary narrator-button" onClick={() => narrateJudgment(player, judgment)}>
            Narrate
          </button>
        </>
      )}
    </>
  );
}

function Avatar({
  player,
  size,
  doomed = false,
}: {
  player?: Player;
  size?: "sm";
  doomed?: boolean;
}) {
  const seed = player?.clientId ?? player?.id ?? "unknown";
  const palette = avatarPalette(seed);
  const initial = (player?.name ?? "?").trim().slice(0, 1).toUpperCase() || "?";
  return (
    <span
      className={[
        "avatar",
        size === "sm" ? "avatar-sm" : "",
        doomed ? "avatar-doomed" : "",
      ].filter(Boolean).join(" ")}
      style={{ background: palette }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}

function avatarPalette(seed: string) {
  const palettes = [
    "linear-gradient(135deg, #1f6f78, #91d0c9)",
    "linear-gradient(135deg, #8b3f6b, #f1a7c6)",
    "linear-gradient(135deg, #4c6f1f, #d8df73)",
    "linear-gradient(135deg, #8b2525, #f39b72)",
    "linear-gradient(135deg, #355d8f, #9bbcff)",
    "linear-gradient(135deg, #3f6b45, #a9e5a4)",
  ];
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palettes[hash % palettes.length];
}

function narrateJudgment(player: Player, judgment: Judgment) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(
    `${player.name}. ${judgment.verdict.replace("_", " ")}. ${judgment.outcome}`,
  );
  utterance.rate = 0.95;
  utterance.pitch = judgment.verdict === "perished" ? 0.75 : 1;
  window.speechSynthesis.speak(utterance);
}

function AiSettingsLauncher({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const settings = loadAiSettings();
  const preset = aiProviderPresets.find((candidate) => candidate.id === settings.provider);

  return (
    <>
      <button className="secondary ai-settings-open" onClick={() => setOpen(true)}>
        AI settings
        {!compact && (
          <span>
            {(preset?.label ?? settings.provider) || "Custom"} · {settings.model || "No model"}
          </span>
        )}
      </button>
      {open && <AiSettingsModal onClose={() => setOpen(false)} />}
    </>
  );
}

function AiSettingsModal({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<AiSettings>(() => loadAiSettings());
  const [models, setModels] = useState<AiModel[]>([]);
  const [modelStatus, setModelStatus] = useState("");
  const [testStatus, setTestStatus] = useState("");
  const [oauthDebug, setOauthDebug] = useState<Record<string, unknown> | null>(() => openRouterOAuthDebug());
  const [loadingModels, setLoadingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connectingOpenRouter, setConnectingOpenRouter] = useState(false);

  const selectedPreset =
    aiProviderPresets.find((preset) => preset.id === settings.provider) ?? aiProviderPresets.at(-1)!;
  const isMock = settings.provider === "mock" || settings.model === "mock";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function update(patch: Partial<AiSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveAiSettings(next);
  }

  function selectPreset(presetId: string) {
    const preset = aiProviderPresets.find((candidate) => candidate.id === presetId);
    if (!preset) return;
    setModels([]);
    setModelStatus("");
    setTestStatus("");
    update({
      provider: preset.id,
      baseUrl: preset.baseUrl,
      model: preset.model,
      responseFormat: preset.responseFormat,
      ...(preset.id === "mock" ? { apiKey: "" } : {}),
      httpReferer: settings.httpReferer || defaultAiSettings.httpReferer,
      appTitle: settings.appTitle || defaultAiSettings.appTitle,
    });
  }

  async function loadModels() {
    setLoadingModels(true);
    setModelStatus("");
    setTestStatus("");
    try {
      const loaded = await listAiModels(settings);
      setModels(loaded);
      if (!loaded.length) {
        setModelStatus("Endpoint responded, but did not return any models.");
      } else {
        setModelStatus(`Loaded ${loaded.length} model${loaded.length === 1 ? "" : "s"}.`);
        if (!loaded.some((model) => model.id === settings.model)) {
          update({ model: loaded[0].id });
        }
      }
    } catch (error) {
      setModelStatus(error instanceof Error ? error.message : "Could not load models.");
    } finally {
      setLoadingModels(false);
    }
  }

  async function testEndpoint() {
    setTesting(true);
    setTestStatus("");
    try {
      setTestStatus(await testAiEndpoint(settings));
    } catch (error) {
      setTestStatus(error instanceof Error ? error.message : "Endpoint test failed.");
    } finally {
      setTesting(false);
    }
  }

  async function connectOpenRouter() {
    setConnectingOpenRouter(true);
    setTestStatus("");
    setOauthDebug(null);
    try {
      await startOpenRouterOAuth();
    } catch (error) {
      setConnectingOpenRouter(false);
      setTestStatus(error instanceof Error ? error.message : "Could not start OpenRouter OAuth.");
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal ai-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">Host browser</span>
            <h2 id="ai-settings-title">AI judge settings</h2>
            <p className="muted">
              Saved in this browser and used when the host runs judging.
            </p>
          </div>
          <button className="secondary" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="provider-grid" role="list" aria-label="AI provider presets">
          {aiProviderPresets.map((preset) => (
            <button
              className={settings.provider === preset.id ? "provider-card selected" : "provider-card"}
              key={preset.id}
              onClick={() => selectPreset(preset.id)}
              type="button"
            >
              <strong>{preset.label}</strong>
              <span>{preset.description}</span>
              {preset.needsToken && <small>Token required</small>}
            </button>
          ))}
        </div>

        <div className="ai-form">
          <label>
            Base URL
            <input
              disabled={isMock}
              placeholder="https://api.example.com/v1"
              value={settings.baseUrl}
              onChange={(event) =>
                update({
                  provider: settings.provider === "mock" ? "custom" : settings.provider,
                  baseUrl: event.target.value,
                })
              }
            />
          </label>
          <label>
            API token
            <input
              autoComplete="off"
              disabled={isMock}
              placeholder={selectedPreset.needsToken ? "Required" : "Optional"}
              type="password"
              value={settings.apiKey}
              onChange={(event) => update({ apiKey: event.target.value })}
            />
            <span className={settings.apiKey ? "field-hint ok" : "field-hint"}>
              {settings.apiKey ? "Token saved in this browser." : "No token saved."}
            </span>
          </label>
          <label>
            Model
            <input
              disabled={isMock}
              placeholder="Choose below or type a model id"
              value={settings.model}
              onChange={(event) => update({ model: event.target.value })}
            />
          </label>
          <label>
            Discovered models
            <select
              disabled={isMock || models.length === 0}
              value={models.some((model) => model.id === settings.model) ? settings.model : ""}
              onChange={(event) => update({ model: event.target.value })}
            >
              <option value="">Manual model</option>
              {models.map((model) => (
                <option value={model.id} key={model.id}>
                  {model.id}
                  {model.ownedBy ? ` (${model.ownedBy})` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="ai-actions">
          <button
            className="secondary"
            disabled={connectingOpenRouter}
            onClick={connectOpenRouter}
          >
            {connectingOpenRouter ? "Opening OpenRouter..." : "Connect OpenRouter"}
          </button>
          <button className="secondary" disabled={isMock || loadingModels} onClick={loadModels}>
            {loadingModels ? "Loading models..." : "Load models"}
          </button>
          <button disabled={testing} onClick={testEndpoint}>
            {testing ? "Testing..." : "Test endpoint"}
          </button>
        </div>

        {(modelStatus || testStatus) && (
          <div className="status-stack">
            {modelStatus && <p className="submit-status">{modelStatus}</p>}
            {testStatus && <p className="submit-status ok">{testStatus}</p>}
          </div>
        )}
        {!settings.apiKey && oauthDebug && (
          <p className="submit-status">
            Last OpenRouter callback: code {oauthDebug.callbackHadCode ? "seen" : "missing"},
            verifier {oauthDebug.hadVerifier ? "found" : "missing"}.
          </p>
        )}

        <details className="advanced-settings">
          <summary>Advanced request options</summary>
          <div className="ai-form">
            <label>
              JSON mode
              <select
                value={settings.responseFormat}
                onChange={(event) =>
                  update({ responseFormat: event.target.value as AiSettings["responseFormat"] })
                }
              >
                <option value="json_object">On</option>
                <option value="none">Off</option>
              </select>
            </label>
            <label>
              HTTP-Referer
              <input
                value={settings.httpReferer}
                onChange={(event) => update({ httpReferer: event.target.value })}
              />
            </label>
            <label>
              X-Title
              <input
                value={settings.appTitle}
                onChange={(event) => update({ appTitle: event.target.value })}
              />
            </label>
          </div>
        </details>
      </section>
    </div>
  );
}

function dedupePlayersByClient(
  players: Player[],
  submissions: Submission[],
  judgments: Judgment[],
  roundIndex?: number,
) {
  const submittedPlayerIds = new Set(
    submissions
      .filter((submission) => submission.roundIndex === roundIndex)
      .map((submission) => submission.playerId),
  );
  const judgedPlayerIds = new Set(
    judgments
      .filter((judgment) => judgment.roundIndex === roundIndex)
      .map((judgment) => judgment.playerId),
  );
  const byClient = new Map<string, Player>();

  for (const player of players) {
    const existing = byClient.get(player.clientId);
    if (!existing || shouldReplacePlayer(existing, player, submittedPlayerIds, judgedPlayerIds)) {
      byClient.set(player.clientId, player);
    }
  }

  return [...byClient.values()];
}

function shouldReplacePlayer(
  existing: Player,
  candidate: Player,
  submittedPlayerIds: Set<string>,
  judgedPlayerIds: Set<string>,
) {
  const existingHasRoundData =
    submittedPlayerIds.has(existing.id) || judgedPlayerIds.has(existing.id);
  const candidateHasRoundData =
    submittedPlayerIds.has(candidate.id) || judgedPlayerIds.has(candidate.id);

  if (candidateHasRoundData !== existingHasRoundData) return candidateHasRoundData;
  if (candidate.isHost !== existing.isHost) return candidate.isHost;
  if (candidate.joinedAt !== existing.joinedAt) return candidate.joinedAt < existing.joinedAt;
  return candidate.id < existing.id;
}

function getLocal(key: string, create: () => string) {
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const value = create();
  localStorage.setItem(key, value);
  return value;
}

function getInitialRoomCode() {
  const params = new URLSearchParams(window.location.search);
  return params.get("room")?.toUpperCase() ?? localStorage.getItem("jba.roomCode") ?? "";
}

function roomLink(code: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", code);
  url.searchParams.delete("demo");
  url.searchParams.delete("admin");
  return url.toString();
}

async function copyRoomLink(code: string, onError?: (error: string) => void) {
  const link = roomLink(code);
  try {
    await navigator.clipboard.writeText(link);
    return true;
  } catch (error) {
    onError?.(error instanceof Error ? error.message : `Share link: ${link}`);
    return false;
  }
}

function isStaleRoom(room: Room) {
  if (room.status === "finished" || room.archivedAt) return false;
  return Date.now() - room.updatedAt > 24 * 60 * 60 * 1000;
}

function isOldUnlinkedRoom(room: Room) {
  if (room.hostUserId || room.archivedAt) return false;
  return Date.now() - room.updatedAt > oldUnlinkedRoomMs;
}

function findBannedWords(text: string, bannedWords: string[]) {
  const hits = new Set<string>();
  for (const word of bannedWords) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(text)) {
      hits.add(word);
    }
  }
  return [...hits];
}

function formatDuration(ms: number) {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function registerServiceWorker() {
  if (import.meta.env.DEV || !("serviceWorker" in navigator)) return;
  const localHostnames = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const canRegister =
    window.location.protocol === "https:" || localHostnames.has(window.location.hostname);
  if (!canRegister) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register(assetPath("sw.js")).catch(() => undefined);
  });
}

function assetPath(path: string) {
  const base = import.meta.env.BASE_URL;
  if (base.startsWith("http")) return new URL(path, base).toString();
  return `${base}${path}`.replace(/\/{2,}/g, "/");
}

registerServiceWorker();
createRoot(document.getElementById("root")!).render(<App />);
