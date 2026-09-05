export type Scenario = {
  title: string;
  category: string;
  scenarioText: string;
  immediateThreat: string;
  timePressure: string;
};

export const scenarios: Scenario[] = [
  {
    title: "The Elevator That Forgot Gravity",
    category: "mundane_absurd",
    scenarioText:
      "A luxury elevator is falling upward and will smash into the penthouse in 58 seconds.",
    immediateThreat: "The elevator will slam into the penthouse maintenance deck.",
    timePressure: "58 seconds",
  },
  {
    title: "The Moonlit Vending Machine Tribunal",
    category: "fantasy",
    scenarioText:
      "A snack-machine court is rolling toward you to seal you inside the claw machine until dawn.",
    immediateThreat: "The machines are closing a plastic-prize containment dome around you.",
    timePressure: "Three minutes before the final snack verdict.",
  },
  {
    title: "The Museum of Highly Conditional Dinosaurs",
    category: "sci_fi",
    scenarioText:
      "Panic-powered dinosaurs are becoming real as probability glass cracks around the museum.",
    immediateThreat: "Your fear may fully materialize several prehistoric problems.",
    timePressure: "Ninety seconds before the containment field fails.",
  },
  {
    title: "The Office Printer Has Chosen Violence",
    category: "mundane_absurd",
    scenarioText:
      "The office printer has become self-aware and is firing paper through a spreading toner cloud.",
    immediateThreat: "A choking toner haze and aggressive paper volleys block the exit.",
    timePressure: "Two minutes before the fire alarm seals the hallway.",
  },
  {
    title: "The Starship Airlock Etiquette Drill",
    category: "sci_fi",
    scenarioText:
      "A training AI has mistaken you for a practice dummy during a live starship airlock drill.",
    immediateThreat: "The airlock will open into vacuum.",
    timePressure: "Forty-five seconds.",
  },
];

export function pickScenario(roundIndex: number): Scenario {
  return scenarios[(roundIndex - 1) % scenarios.length];
}

const staticBannedWords = [
  "survive",
  "survives",
  "survived",
  "surviving",
  "safe",
  "safety",
  "escape",
  "escaped",
  "escaping",
  "win",
  "wins",
  "won",
  "invincible",
  "immortal",
];

export function bannedWordsForRound() {
  return staticBannedWords;
}
