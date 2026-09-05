import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { findBlockedSubmissionPhrases, pickScenario } from "./game";
import { createDemoState, type DemoMode } from "./demo";
import type { Judgment, Player, Room, Submission } from "./types";
import {
  decodeHostToken,
  startOidcLogin,
  useHostIdentity,
  type HostIdentity,
} from "./serverAuth";
import {
  addAdminIdentity,
  adminCleanup,
  adminDeleteRoom,
  adminUpdateRoom,
  advanceReveal,
  closeSubmissions,
  controlRoom,
  createRoom as createRoomOnServer,
  fetchAdminRooms,
  fetchAdmins,
  fetchHostRooms,
  fetchSnapshot,
  heartbeat,
  hideFromHistory as hideFromHistoryOnServer,
  joinRoom as joinRoomOnServer,
  nextRound,
  removeAdminIdentity,
  requestJudge,
  setReady,
  startGame as startGameOnServer,
  submitText,
  useRoomSnapshot,
  getLocalClientId,
  type AdminIdentity,
  type AdminRoomRow,
} from "./serverSync";
import "./styles.css";

const localClientId = getLocalClientId();
function App() {
  const params = new URLSearchParams(window.location.search);
  const demosEnabled = params.get("demo") === "1";
  const adminEnabled = params.get("admin") === "1";
  const [demoMode, setDemoMode] = useState<DemoMode | null>(null);
  if (demoMode) {
    return <DemoView mode={demoMode} onExit={() => setDemoMode(null)} />;
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
  const { identity } = useHostIdentity();
  const [activeCode, setActiveCode] = useState(getInitialRoomCode());
  const { snapshot, connected, notFound } = useRoomSnapshot(activeCode || null);

  const room = snapshot?.room ?? null;
  const players = useMemo(
    () => Object.values(snapshot?.players ?? {}).sort((a, b) => a.seatIndex - b.seatIndex),
    [snapshot],
  );
  const submissions = useMemo(() => Object.values(snapshot?.submissions ?? {}), [snapshot]);
  const judgments = useMemo(() => Object.values(snapshot?.judgments ?? {}), [snapshot]);
  const me = players.find((player) => player.clientId === localClientId);
  const isHost = Boolean(me?.isHost || (room && room.hostClientId === localClientId));

  const [joining, setJoining] = useState(false);
  useEffect(() => {
    if (!room || me || joining) return;
    setJoining(true);
    joinRoomOnServer(room.code, localStorage.getItem("jba.name") ?? (isHost ? room.hostName : "Guest"))
      .catch(() => undefined)
      .finally(() => setJoining(false));
  }, [room?.code, me?.id, joining]);

  useEffect(() => {
    if (activeCode) localStorage.setItem("jba.roomCode", activeCode);
    else localStorage.removeItem("jba.roomCode");
  }, [activeCode]);

  useEffect(() => {
    if (!me || !activeCode) return;
    const timer = setInterval(() => {
      void heartbeat(activeCode, me.id).catch(() => undefined);
    }, 15_000);
    return () => clearInterval(timer);
  }, [me?.id, activeCode]);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [narratorEnabled, setNarratorEnabled] = useState(
    localStorage.getItem("jba.narrator") === "1",
  );
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!decodeHostToken()) {
      setIsAdmin(false);
      return;
    }
    fetchAdmins()
      .then(() => setIsAdmin(true))
      .catch(() => setIsAdmin(false));
  }, [identity?.sub]);
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
        <AuthWidget onError={setError} />
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
        notFound && activeCode ? (
          <section className="panel auth">
            <BrandTitle />
            <h2>Room {activeCode} not found</h2>
            <p className="muted">Check the code or create a new room.</p>
            <button className="secondary" onClick={() => openRoom("")}>
              Back home
            </button>
          </section>
        ) : (
        <Home
          identity={identity}
          onRoom={openRoom}
          onError={setError}
          demosEnabled={demosEnabled}
          onDemo={onDemo}
        />
        )
      ) : (
          <RoomView
            room={room}
            players={players}
          allPlayers={players}
          submissions={submissions}
          judgments={judgments}
            me={me}
            isHost={isHost}
            onError={setError}
          readOnly={false}
          playersLoaded={Boolean(snapshot)}
          connected={connected}
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
        <h1>Promptly Doomed</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </div>
  );
}

function DemoView({ mode, onExit }: { mode: DemoMode; onExit: () => void }) {
  const demo = useMemo(() => createDemoState(mode), [mode]);
  return (
    <main>
      <header className="topbar">
        <BrandTitle subtitle="Demo mode for status updates. No backend writes, no AI calls." />
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
        onError={() => undefined}
        readOnly
        playersLoaded
        connected={false}
        narratorEnabled={false}
        onNarratorChange={() => undefined}
      />
    </main>
  );
}

function Home({
  identity,
  onRoom,
  onError,
  demosEnabled,
  onDemo,
}: {
  identity: HostIdentity | null;
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
  const [busy, setBusy] = useState(false);

  async function createRoom() {
    if (busy) return;
    setBusy(true);
    try {
      localStorage.setItem("jba.name", hostName);
      const { room } = await createRoomOnServer({ hostName, roundCount, submissionSeconds, difficulty });
      await joinRoomOnServer(room.code, hostName).catch(() => undefined);
      onRoom(room.code);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not create room");
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom() {
    try {
      localStorage.setItem("jba.name", guestName);
      const target = code.toUpperCase();
      await fetchSnapshot(target);
      await joinRoomOnServer(target, guestName).catch(() => undefined);
      onRoom(target);
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
          </div>
          <p className="setup-note">
            The backend runs the judge with a server-side key. Guests join with
            the room code, no login needed.
          </p>
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
          <button disabled={busy} onClick={createRoom}>Create</button>
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
      <FirstTimeGuide />
      <HostDashboard identity={identity} onRoom={onRoom} onError={onError} />
      {demosEnabled && <DemoLauncher onDemo={onDemo} />}
    </>
  );
}

function FirstTimeGuide() {
  return (
    <section className="panel first-run-guide">
      <div className="section-heading">
        <div>
          <span className="eyebrow">First round survival kit</span>
          <h2>How the game works</h2>
        </div>
        <span>5 steps</span>
      </div>
      <div className="help-grid">
        <article className="help-card">
          <strong>1. Host creates the room</strong>
          <p>
            Sign in with your organization account to host. The backend runs
            the AI judge with a server-side key.
          </p>
        </article>
        <article className="help-card">
          <strong>2. Guests join by code</strong>
          <p>
            Only the host needs to sign in. Players can join anonymously from
            their own browser with the room code.
          </p>
        </article>
        <article className="help-card">
          <strong>3. Survive the prompt</strong>
          <p>
            Each round gives one short disaster prompt. Write a specific plan
            before the timer ends.
          </p>
        </article>
        <article className="help-card">
          <strong>4. Avoid lazy words</strong>
          <p>
            Words like “survive” and “escape” are banned, so players must explain
            what they actually do.
          </p>
        </article>
        <article className="help-card">
          <strong>5. The judge reveals fate</strong>
          <p>
            The active player advances reveals. The AI scores logic, creativity,
            feasibility, and humor.
          </p>
        </article>
      </div>
    </section>
  );
}

function AuthWidget({ onError }: { onError: (error: string) => void }) {
  const { identity, refresh, signOut } = useHostIdentity();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);

  async function login() {
    setLoggingIn(true);
    try {
      await startOidcLogin();
    } catch (error) {
      setLoggingIn(false);
      onError(error instanceof Error ? error.message : "Could not start login");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  if (identity) {
    return (
      <div className="authbox signed-in">
        <span>{identity.email ?? "Signed in"}</span>
        {confirmSignOut ? (
          <div className="confirm-actions">
            <button className="secondary danger-action" onClick={() => { signOut(); setConfirmSignOut(false); }}>
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
      <button className="secondary" disabled={loggingIn} onClick={login}>
        {loggingIn ? "Redirecting..." : "Host login"}
      </button>
    </div>
  );
}

function HostDashboard({
  identity,
  onRoom,
  onError,
}: {
  identity: HostIdentity | null;
  onRoom: (code: string) => void;
  onError: (error: string) => void;
}) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!identity) {
      setRooms([]);
      return;
    }
    setLoading(true);
    fetchHostRooms()
      .then(setRooms)
      .catch((error) => onError(error instanceof Error ? error.message : "Could not load host history"))
      .finally(() => setLoading(false));
  }, [identity?.sub]);

  if (!identity) {
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

  const finished = rooms.filter((room) => room.status === "finished");
  const active = rooms.filter((room) => room.status !== "finished");

  async function hide(room: Room) {
    try {
      await hideFromHistoryOnServer(room.code);
      setRooms((current) => current.filter((candidate) => candidate.id !== room.id));
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
        <span>{loading ? "Loading..." : `${rooms.length} game${rooms.length === 1 ? "" : "s"}`}</span>
      </div>
      {rooms.length === 0 ? (
        <p className="muted">No hosted games yet{identity.email ? ` for ${identity.email}` : ""}.</p>
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
  onRoom,
  onError,
  onExit,
}: {
  onRoom: (code: string) => void;
  onError: (error: string) => void;
  onExit: () => void;
}) {
  const { identity } = useHostIdentity();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (!decodeHostToken()) {
      setChecking(false);
      setAllowed(false);
      return;
    }
    fetchAdmins()
      .then(() => {
        setAllowed(true);
        setChecking(false);
      })
      .catch(() => {
        setAllowed(false);
        setChecking(false);
      });
  }, [identity?.sub]);

  if (checking) {
    return (
      <section className="panel admin-unlock">
        <h2>Admin</h2>
        <p className="muted">Checking login...</p>
      </section>
    );
  }

  if (!decodeHostToken()) {
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

  if (!allowed) {
    return (
      <section className="panel admin-unlock">
        <div>
          <span className="eyebrow">Admin</span>
          <h2>Access denied</h2>
          <p className="muted">
            {identity?.email ?? "This account"} is signed in, but is not an admin.
            Ask an existing admin to add it.
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
      onRoom={onRoom}
      onError={onError}
      onExit={onExit}
    />
  );
}

function AdminConsole({
  onRoom,
  onError,
  onExit,
}: {
  onRoom: (code: string) => void;
  onError: (error: string) => void;
  onExit: () => void;
}) {
  const [filter, setFilter] = useState<"open" | "active" | "stale" | "unlinked" | "finished" | "archived">("open");
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [newAdminNote, setNewAdminNote] = useState("");
  const [adminNotice, setAdminNotice] = useState("");
  const [deleteConfirmRoomCode, setDeleteConfirmRoomCode] = useState<string | null>(null);
  const [rows, setRows] = useState<AdminRoomRow[]>([]);
  const [admins, setAdmins] = useState<AdminIdentity[]>([]);
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    try {
      const [roomRows, adminList] = await Promise.all([fetchAdminRooms(), fetchAdmins()]);
      setRows(roomRows);
      setAdmins(adminList);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not load admin data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  const rooms = rows.map((row) => row.room);
  const visibleRooms = rows.filter(({ room }) => {
    switch (filter) {
      case "active":
        return !room.archivedAt && room.status !== "finished";
      case "stale":
        return !room.archivedAt && isStaleRoom(room);
      case "unlinked":
        return !room.archivedAt && isUnlinkedRoom(room);
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
    unlinked: rooms.filter((room) => !room.archivedAt && isUnlinkedRoom(room)).length,
    finished: rooms.filter((room) => !room.archivedAt && room.status === "finished").length,
    archived: rooms.filter((room) => room.archivedAt).length,
  };

  async function updateRoom(room: Room, patch: Partial<Room>) {
    try {
      await adminUpdateRoom(room.code, patch);
      await reload();
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
    if (counts.stale === 0) return;
    try {
      const { archived } = await adminCleanup("stale");
      setAdminNotice(`Archived ${archived} stale game${archived === 1 ? "" : "s"}.`);
      await reload();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Cleanup failed");
    }
  }

  async function cleanupOldFinished() {
    if (counts.finished === 0) return;
    try {
      const { archived } = await adminCleanup("oldFinished");
      setAdminNotice(`Archived ${archived} old finished game${archived === 1 ? "" : "s"}.`);
      await reload();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Cleanup failed");
    }
  }

  async function cleanupOldUnlinked() {
    if (counts.unlinked === 0) return;
    try {
      const { archived } = await adminCleanup("unlinked");
      setAdminNotice(`Archived ${archived} unlinked game${archived === 1 ? "" : "s"}.`);
      await reload();
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
      await adminDeleteRoom(room.code);
      setDeleteConfirmRoomCode(null);
      setAdminNotice(`Deleted game ${room.code}.`);
      await reload();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not delete game");
    }
  }

  async function addAdmin() {
    const email = newAdminEmail.trim().toLowerCase();
    if (!email) return;
    try {
      await addAdminIdentity(email, newAdminNote.trim());
      setNewAdminEmail("");
      setNewAdminNote("");
      await reload();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not add admin");
    }
  }

  async function removeAdmin(admin: AdminIdentity) {
    try {
      await removeAdminIdentity(admin.id);
      await reload();
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
              {loading ? "Loading..." : `${visibleRooms.length} shown of ${counts.total}`}
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
          visibleRooms.map(({ room, playerCount, submissionCount, judgmentCount }) => {
            return (
              <article className="admin-row" key={room.code}>
                <div>
                  <strong>{room.code}</strong>
                  <span>{room.status.replaceAll("_", " ")}</span>
                  {room.archivedAt ? <small>Archived {new Date(room.archivedAt).toLocaleString()}</small> : null}
                </div>
                <div className="admin-meta">
                  <span>{playerCount} players</span>
                  <span>{submissionCount} submissions</span>
                  <span>{judgmentCount} judgments</span>
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
                  {deleteConfirmRoomCode === room.code ? (
                    <>
                      <button className="secondary danger-action" onClick={() => deleteGame(room)}>
                        Confirm delete
                      </button>
                      <button className="secondary" onClick={() => setDeleteConfirmRoomCode(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button className="secondary danger-action" onClick={() => setDeleteConfirmRoomCode(room.code)}>
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
              Admins are organization users authenticated via OIDC. Admin rights
              can also be provisioned through SCIM or <code>ADMIN_EMAILS</code> on
              the backend.
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
  onError,
  readOnly,
  playersLoaded,
  connected,
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
  onError: (error: string) => void;
  readOnly: boolean;
  playersLoaded: boolean;
  connected: boolean;
  narratorEnabled: boolean;
  onNarratorChange: (enabled: boolean) => void;
}) {
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
      void closeSubmissions(room.code).catch(() => undefined);
      return;
    }

    const delay = Math.max(0, room.deadlineAt - Date.now()) + 1_000;
    const timeout = window.setTimeout(() => {
      void closeSubmissions(room.code).catch(() => undefined);
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
        {!readOnly && (
          <div className="muted">{connected ? "Live" : me ? "Reconnecting..." : "Joining..."}</div>
        )}
        {activePlayer && room.status !== "lobby" && (
          <div className="active-player">
            <span>Active player</span>
            <strong>{activePlayer.name}</strong>
          </div>
        )}
        <PlayerList players={players} submittedIds={roundSubmissions.map((s) => s.playerId)} />
        <NarratorToggle enabled={narratorEnabled} onChange={onNarratorChange} />
        {(isHost || canControlRound) && !readOnly && (
          <p className="muted setup-note">The backend judge runs with a server-side key.</p>
        )}
      </aside>
      <section className="stage">
        {room.status === "lobby" ? (
          <Lobby
            room={room}
            me={me}
            players={players}
            isHost={isHost}
            readOnly={readOnly}
            onError={onError}
          />
        ) : room.status === "finished" ? (
          <GameSummary
            room={room}
            players={players}
            allPlayers={allPlayers}
            submissions={submissions}
            judgments={judgments}
            isHost={isHost}
            readOnly={readOnly}
            onError={onError}
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
  onError,
}: {
  room: Room;
  me?: Player;
  players: Player[];
  isHost: boolean;
  readOnly: boolean;
  onError: (error: string) => void;
}) {
  const [starting, setStarting] = useState(false);

  async function toggleReady() {
    if (!me || readOnly) return;
    try {
      await setReady(room.code, me.id, !me.ready);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not update ready state");
    }
  }

  async function startGame() {
    if (readOnly || starting) return;
    setStarting(true);
    try {
      await startGameOnServer(room.code);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not start game.");
    } finally {
      setStarting(false);
    }
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
        {isHost && (
          <button disabled={starting} onClick={startGame}>
            {starting ? "Starting..." : "Start game"}
          </button>
        )}
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
          onError={onError}
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
          onError={onError}
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
          onError={onError}
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
          onError={onError}
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
  onError,
}: {
  room: Room;
  canControl: boolean;
  activePlayer?: Player;
  readOnly: boolean;
  onError: (error: string) => void;
}) {
  const [customPrompt, setCustomPrompt] = useState("");

  async function openSubmissions() {
    if (readOnly || !canControl) return;
    try {
      await controlRoom(room.code, {
        status: "submitting",
        deadlineAt: Date.now() + room.submissionSeconds * 1000,
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not open submissions");
    }
  }

  async function rerollPrompt() {
    if (readOnly || !canControl) return;
    const scenario = pickScenario(room.roundIndex + Math.floor(Math.random() * 4) + 1);
    try {
      await controlRoom(room.code, {
        scenarioTitle: scenario.title,
        scenarioText: scenario.scenarioText,
        immediateThreat: scenario.immediateThreat,
        timePressure: scenario.timePressure,
        category: scenario.category,
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not reroll prompt");
    }
  }

  async function useCustomPrompt() {
    if (readOnly || !canControl || customPrompt.trim().length < 12) return;
    const text = customPrompt.trim().slice(0, 220);
    try {
      await controlRoom(room.code, {
        scenarioTitle: "Custom calamity",
        scenarioText: text,
        immediateThreat: "The danger is immediate.",
        timePressure: `${room.submissionSeconds} seconds.`,
        category: "custom",
      });
      setCustomPrompt("");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not set prompt");
    }
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
  onError,
}: {
  room: Room;
  players: Player[];
  submissions: Submission[];
  me?: Player;
  submission?: Submission;
  canControl: boolean;
  readOnly: boolean;
  onError: (error: string) => void;
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
    setSaving(true);
    try {
      const saved = await submitText(room.code, { playerId: me.id, text: trimmedText.slice(0, 500) });
      setSavedAt(saved.submittedAt);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not submit");
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
    try {
      await closeSubmissions(room.code);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not close submissions");
    }
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
    if (readOnly || running) return;
    setRunning(true);
    try {
      await requestJudge(room.code);
    } catch (error) {
      onError(error instanceof Error ? error.message : "AI judging failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="panel">
      <h3>Judging</h3>
      <p className="muted">
        {canControl
          ? "Run the backend judge. Scores appear in the reveal."
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
  onError,
}: {
  room: Room;
  players: Player[];
  submissions: Submission[];
  judgments: Judgment[];
  canControl: boolean;
  readOnly: boolean;
  narratorEnabled: boolean;
  onError?: (error: string) => void;
}) {
  const visiblePlayers = players.slice(0, room.revealIndex);
  const [advancing, setAdvancing] = useState(false);
  async function advance() {
    if (readOnly || advancing) return;
    setAdvancing(true);
    try {
      await advanceReveal(room.code);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "Could not advance reveal");
    } finally {
      setAdvancing(false);
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
      {canControl && <button disabled={advancing} onClick={advance}>{advancing ? "Advancing..." : "Advance reveal"}</button>}
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
  onError,
}: {
  room: Room;
  players: Player[];
  submissions: Submission[];
  judgments: Judgment[];
  canControl: boolean;
  readOnly: boolean;
  onError: (error: string) => void;
}) {
  const leaders = [...players].sort((a, b) => b.score - a.score);
  const [moving, setMoving] = useState(false);
  async function next() {
    if (readOnly || moving) return;
    setMoving(true);
    try {
      await nextRound(room.code);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not advance round");
    } finally {
      setMoving(false);
    }
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
          <button disabled={moving} onClick={next}>
            {moving ? "Working..." : room.roundIndex >= room.roundCount ? "Finish game" : "Next round"}
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
  onError,
}: {
  room: Room;
  players: Player[];
  allPlayers: Player[];
  submissions: Submission[];
  judgments: Judgment[];
  isHost: boolean;
  readOnly: boolean;
  onError: (error: string) => void;
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
    try {
      await hideFromHistoryOnServer(room.code);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not remove game");
    }
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

function isUnlinkedRoom(room: Room) {
  if (room.hostUserId || room.archivedAt) return false;
  return Date.now() - room.updatedAt > 7 * 24 * 60 * 60 * 1000;
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
