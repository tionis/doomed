import type { Scenario } from "./types.js";

export const scenarios: Scenario[] = [
  {
    title: "The Elevator That Forgot Gravity",
    category: "mundane_absurd",
    difficulty: 3,
    description:
      'You are trapped in a luxury elevator that is falling upward through an unfinished skyscraper. The ceiling hatch is welded shut, the emergency phone is whispering legal disclaimers, and the floor display says: "Penthouse impact in 58 seconds." Somewhere behind the control panel, the emergency brake is clicking like it wants to help but lacks confidence.',
    immediateThreat: "The elevator will slam into the penthouse maintenance deck.",
    timePressure: "58 seconds",
  },
  {
    title: "The Moonlit Vending Machine Tribunal",
    category: "fantasy",
    difficulty: 2,
    description:
      "At midnight, every vending machine in the train station rolls forward on tiny hidden wheels and accuses you of unpaid snack debts. The snack court has formed, the gavel is a frozen burrito, and the punishment is being sealed inside the claw machine until dawn.",
    immediateThreat: "The machines are closing a plastic-prize containment dome around you.",
    timePressure: "Three minutes before the final snack verdict.",
  },
  {
    title: "The Museum of Highly Conditional Dinosaurs",
    category: "sci_fi",
    difficulty: 4,
    description:
      "A museum exhibit uses experimental probability glass to display dinosaurs that only become real if visitors panic. The glass is cracking, the emergency lights are strobing, and a velociraptor-shaped possibility is already testing the gift shop door.",
    immediateThreat: "Your fear may fully materialize several prehistoric problems.",
    timePressure: "Ninety seconds before the containment field fails.",
  },
  {
    title: "The Office Printer Has Chosen Violence",
    category: "mundane_absurd",
    difficulty: 1,
    description:
      "The office printer has achieved awareness and jammed itself with every resignation letter ever written. It is firing warm paper at knee height, the toner cloud is spreading, and the only exit badge reader now requires a duplex print confirmation.",
    immediateThreat: "A choking toner haze and aggressive paper volleys block the exit.",
    timePressure: "Two minutes before the fire alarm seals the hallway.",
  },
  {
    title: "The Starship Airlock Etiquette Drill",
    category: "sci_fi",
    difficulty: 5,
    description:
      "Your starship's training AI has mistaken you for a reusable practice dummy during a live airlock etiquette drill. The outer door is politely counting down, magnetic boots are across the room, and the AI keeps complimenting your commitment to realism.",
    immediateThreat: "The airlock will open into vacuum.",
    timePressure: "Forty-five seconds.",
  },
];

export function pickScenario(roundIndex: number): Scenario {
  return scenarios[roundIndex % scenarios.length];
}
