import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import { api, post } from "./api";
import type { Judgment, Player, Snapshot, Submission, User } from "./types";
import "./styles.css";

type AuthConfig = {
  provider: string;
  oidcConfigured: boolean;
  devLoginEnabled: boolean;
};

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [gameId, setGameId] = useState(localStorage.getItem("gameId") ?? "");
  const [error, setError] = useState("");

  useEffect(() => {
    void api<{ user: User | null }>("/api/me").then((data) => setUser(data.user));
    void api<AuthConfig>("/api/auth/config").then(setAuthConfig);
  }, []);

  useEffect(() => {
    if (!user || !gameId) return;
    localStorage.setItem("gameId", gameId);
    let closed = false;
    api<{ snapshot: Snapshot }>(`/api/games/${gameId}`)
      .then((data) => {
        if (!closed) setSnapshot(data.snapshot);
      })
      .catch((err: Error) => {
        setError(err.message);
        localStorage.removeItem("gameId");
      });

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "subscribe_game", gameId }));
    });
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data as string) as { snapshot?: Snapshot };
      if (message.snapshot) setSnapshot(message.snapshot);
    });
    ws.addEventListener("error", () => setError("Realtime connection failed"));
    return () => {
      closed = true;
      ws.close();
    };
  }, [user, gameId]);

  async function logout() {
    await post("/auth/logout");
    localStorage.removeItem("gameId");
    setUser(null);
    setSnapshot(null);
  }

  return (
    <main>
      <header className="topbar">
        <div>
          <h1>Judged by AI</h1>
          <p>Survive the scenario. Convince the judge. Do not trust the client.</p>
        </div>
        {user && (
          <div className="userline">
            <span>{user.displayName}</span>
            <button onClick={logout}>Logout</button>
          </div>
        )}
      </header>

      {error && (
        <button className="error" onClick={() => setError("")}>
          {error}
        </button>
      )}

      {!user ? (
        <LoginPanel authConfig={authConfig} />
      ) : !snapshot ? (
        <Home user={user} onGame={setGameId} />
      ) : (
        <GameView
          user={user}
          snapshot={snapshot}
          onLeaveLocal={() => {
            localStorage.removeItem("gameId");
            setGameId("");
            setSnapshot(null);
          }}
          onError={setError}
        />
      )}
    </main>
  );
}

function LoginPanel({ authConfig }: { authConfig: AuthConfig | null }) {
  const [name, setName] = useState("Player");
  const provider = authConfig?.provider ?? "authentik";
  const useDevLogin = authConfig?.devLoginEnabled ?? true;
  return (
    <section className="panel auth">
      <h2>Login</h2>
      {useDevLogin && (
        <label>
          Display name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
      )}
      <button
        onClick={() => {
          const suffix = useDevLogin ? `?name=${encodeURIComponent(name)}` : "";
          window.location.href = `/auth/login/${provider}${suffix}`;
        }}
      >
        {useDevLogin ? "Continue in dev mode" : `Continue with ${provider}`}
      </button>
    </section>
  );
}

function Home({ user, onGame }: { user: User; onGame: (id: string) => void }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [code, setCode] = useState("");
  const [roundCount, setRoundCount] = useState(5);
  const [submissionSeconds, setSubmissionSeconds] = useState(60);
  const [difficulty, setDifficulty] = useState("normal");

  async function create() {
    const result = await post<{ gameId: string }>("/api/games", {
      displayName,
      settings: {
        roundCount,
        submissionSeconds,
        difficulty,
        mode: "score",
        revealMode: "one_by_one",
      },
    });
    onGame(result.gameId);
  }

  async function join() {
    const result = await post<{ gameId: string }>("/api/games/join", {
      code,
      displayName,
    });
    onGame(result.gameId);
  }

  return (
    <section className="homegrid">
      <div className="panel">
        <h2>Create game</h2>
        <label>
          Display name
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
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
              min={15}
              max={180}
              value={submissionSeconds}
              onChange={(event) => setSubmissionSeconds(Number(event.target.value))}
            />
          </label>
          <label>
            Difficulty
            <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
              <option value="easy">Easy</option>
              <option value="normal">Normal</option>
              <option value="ruthless">Ruthless</option>
            </select>
          </label>
        </div>
        <button onClick={create}>Create</button>
      </div>
      <div className="panel">
        <h2>Join game</h2>
        <label>
          Code
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="B7KQ"
          />
        </label>
        <button onClick={join}>Join</button>
      </div>
    </section>
  );
}

function GameView({
  user,
  snapshot,
  onLeaveLocal,
  onError,
}: {
  user: User;
  snapshot: Snapshot;
  onLeaveLocal: () => void;
  onError: (error: string) => void;
}) {
  const me = snapshot.players.find((player) => player.userId === user.id);
  const isHost = Boolean(me?.isHost);

  async function command(path: string, body?: unknown) {
    try {
      await post(path, body);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Command failed");
    }
  }

  return (
    <section className="game">
      <aside className="panel sidebar">
        <div className="codebox">
          <span>Code</span>
          <strong>{snapshot.game.code}</strong>
        </div>
        <div className="status">{snapshot.game.status.replaceAll("_", " ")}</div>
        <PlayerList players={snapshot.players} submittedIds={snapshot.submittedPlayerIds} />
        <button className="secondary" onClick={onLeaveLocal}>
          Back to menu
        </button>
      </aside>
      <section className="stage">
        {snapshot.game.status === "lobby" && (
          <Lobby snapshot={snapshot} me={me} isHost={isHost} command={command} />
        )}
        {snapshot.currentRound && snapshot.game.status !== "lobby" && (
          <RoundView snapshot={snapshot} me={me} isHost={isHost} command={command} />
        )}
      </section>
    </section>
  );
}

function PlayerList({
  players,
  submittedIds,
}: {
  players: Player[];
  submittedIds: string[];
}) {
  return (
    <div className="players">
      {players.map((player) => (
        <div className="player" key={player.id}>
          <span className={player.connected ? "dot on" : "dot"} />
          <span>{player.displayName}</span>
          {player.isHost && <small>Host</small>}
          {submittedIds.includes(player.id) && <small>Submitted</small>}
          <strong>{player.score}</strong>
        </div>
      ))}
    </div>
  );
}

function Lobby({
  snapshot,
  me,
  isHost,
  command,
}: {
  snapshot: Snapshot;
  me?: Player;
  isHost: boolean;
  command: (path: string, body?: unknown) => void;
}) {
  return (
    <div className="panel">
      <h2>Lobby</h2>
      <p className="muted">Round count: {snapshot.game.roundCount}</p>
      <div className="actions">
        <button
          className={me?.ready ? "secondary" : ""}
          onClick={() => command(`/api/games/${snapshot.game.id}/ready`, { ready: !me?.ready })}
        >
          {me?.ready ? "Not ready" : "Ready"}
        </button>
        {isHost && (
          <button onClick={() => command(`/api/games/${snapshot.game.id}/start`)}>
            Start game
          </button>
        )}
      </div>
    </div>
  );
}

function RoundView({
  snapshot,
  me,
  isHost,
  command,
}: {
  snapshot: Snapshot;
  me?: Player;
  isHost: boolean;
  command: (path: string, body?: unknown) => void;
}) {
  const round = snapshot.currentRound!;
  return (
    <>
      <div className="scenario">
        <div className="roundline">
          <span>
            Round {snapshot.game.currentRoundIndex} of {snapshot.game.roundCount}
          </span>
          <Timer deadline={round.submissionDeadlineAt} />
        </div>
        <h2>{round.scenarioTitle}</h2>
        <p>{round.scenarioText}</p>
        <dl>
          <div>
            <dt>Threat</dt>
            <dd>{round.immediateThreat}</dd>
          </div>
          <div>
            <dt>Pressure</dt>
            <dd>{round.timePressure}</dd>
          </div>
        </dl>
      </div>

      {snapshot.game.status === "round_intro" && (
        <div className="panel">
          <h3>Brace yourself</h3>
          {isHost && (
            <button onClick={() => command(`/api/rounds/${round.id}/open-submissions`)}>
              Open submissions
            </button>
          )}
        </div>
      )}

      {snapshot.game.status === "submitting" && (
        <SubmitPanel snapshot={snapshot} me={me} isHost={isHost} command={command} />
      )}

      {snapshot.game.status === "judging" && (
        <div className="panel">
          <h3>Judging</h3>
          <p className="muted">The server is evaluating submissions. Results stay hidden until reveal.</p>
        </div>
      )}

      {snapshot.game.status === "revealing" && (
        <RevealPanel snapshot={snapshot} isHost={isHost} command={command} />
      )}

      {(snapshot.game.status === "scoreboard" || snapshot.game.status === "finished") && (
        <Scoreboard snapshot={snapshot} isHost={isHost} command={command} />
      )}
    </>
  );
}

function Timer({ deadline }: { deadline: string | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, []);
  if (!deadline) return null;
  const remaining = Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000));
  return <strong className={remaining <= 10 ? "timer danger" : "timer"}>{remaining}s</strong>;
}

function SubmitPanel({
  snapshot,
  me,
  isHost,
  command,
}: {
  snapshot: Snapshot;
  me?: Player;
  isHost: boolean;
  command: (path: string, body?: unknown) => void;
}) {
  const ownSubmission = snapshot.visibleSubmissions.find((submission) => submission.playerId === me?.id);
  const [text, setText] = useState(ownSubmission?.text ?? "");

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
        <button onClick={() => command(`/api/rounds/${snapshot.currentRound!.id}/submit`, { text })}>
          Submit
        </button>
        {isHost && (
          <button
            className="secondary"
            onClick={() => command(`/api/rounds/${snapshot.currentRound!.id}/close-submissions`)}
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}

function RevealPanel({
  snapshot,
  isHost,
  command,
}: {
  snapshot: Snapshot;
  isHost: boolean;
  command: (path: string, body?: unknown) => void;
}) {
  return (
    <div>
      <ResultCards snapshot={snapshot} />
      {isHost && (
        <button onClick={() => command(`/api/rounds/${snapshot.currentRound!.id}/advance-reveal`)}>
          Advance reveal
        </button>
      )}
    </div>
  );
}

function Scoreboard({
  snapshot,
  isHost,
  command,
}: {
  snapshot: Snapshot;
  isHost: boolean;
  command: (path: string, body?: unknown) => void;
}) {
  const leaders = [...snapshot.players].sort((a, b) => b.score - a.score);
  return (
    <div className="scoregrid">
      <div className="panel">
        <h3>{snapshot.game.status === "finished" ? "Final leaderboard" : "Scoreboard"}</h3>
        {leaders.map((player, index) => (
          <div className="rank" key={player.id}>
            <span>{index + 1}</span>
            <strong>{player.displayName}</strong>
            <b>{player.score}</b>
          </div>
        ))}
        {isHost && snapshot.game.status !== "finished" && (
          <button onClick={() => command(`/api/games/${snapshot.game.id}/next-round`)}>
            {snapshot.game.currentRoundIndex >= snapshot.game.roundCount
              ? "Finish game"
              : "Next round"}
          </button>
        )}
      </div>
      <ResultCards snapshot={snapshot} />
    </div>
  );
}

function ResultCards({ snapshot }: { snapshot: Snapshot }) {
  const byPlayer = useMemo(() => {
    const submissions = new Map<string, Submission>();
    const judgments = new Map<string, Judgment>();
    for (const submission of snapshot.visibleSubmissions) submissions.set(submission.playerId, submission);
    for (const judgment of snapshot.visibleJudgments) judgments.set(judgment.playerId, judgment);
    return { submissions, judgments };
  }, [snapshot.visibleSubmissions, snapshot.visibleJudgments]);

  return (
    <div className="results">
      {snapshot.players
        .filter((player) => byPlayer.submissions.has(player.id) || byPlayer.judgments.has(player.id))
        .map((player) => {
          const submission = byPlayer.submissions.get(player.id);
          const judgment = byPlayer.judgments.get(player.id);
          return (
            <article className="result" key={player.id}>
              <h3>{player.displayName}</h3>
              {submission && <p className="submission">{submission.text}</p>}
              {judgment && (
                <>
                  <div className={`verdict ${judgment.verdict}`}>{judgment.verdict.replace("_", " ")}</div>
                  <p>{judgment.outcome}</p>
                  <small>{judgment.judgeComment}</small>
                  <div className="breakdown">
                    <span>L {judgment.logicScore}</span>
                    <span>C {judgment.creativityScore}</span>
                    <span>F {judgment.feasibilityScore}</span>
                    <span>H {judgment.humorScore}</span>
                    <strong>+{judgment.pointsAwarded}</strong>
                  </div>
                </>
              )}
            </article>
          );
        })}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
