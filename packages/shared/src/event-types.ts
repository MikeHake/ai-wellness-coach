// The built-in event types everyone sees. The migration seeds these rows, and a
// schema test checks the seed matches this list, so the agent and database agree.
// Descriptions are fed to the extraction prompt, so they say what each type covers.

export const BUILT_IN_EVENT_TYPES = [
  {
    name: "meal",
    description:
      "Breakfast, lunch, or dinner. Tags describe the food or setting, such as home_cooked, eating_out, heavy, late, or fried.",
  },
  {
    name: "snack",
    description:
      "Anything eaten between meals. Tags describe what it was, such as sweets or salty.",
  },
  {
    name: "drink",
    description:
      "Alcohol, caffeine, or another notable drink. Tags describe it, such as alcohol, coffee, or beer.",
  },
  {
    name: "activity",
    description:
      "Any movement, such as a hike, run, ride, lifting, class, or walk. Tags describe the kind and setting, such as hike, run, bike, weights, outdoor, indoor, with_friends, or solo.",
  },
  {
    name: "sleep",
    description:
      "A night's sleep or a nap, dated by the day the person woke up. Tags add detail, such as nap or woke_up_often.",
  },
  {
    name: "stress",
    description:
      "A stressful event or period. Tags name the source, such as work, family, or travel.",
  },
  {
    name: "feeling",
    description:
      "How the person feels, when it is not tied to another event. Tags name the aspect, such as energy, mood, sore, or sick.",
  },
] as const;

export type BuiltInEventTypeName =
  (typeof BUILT_IN_EVENT_TYPES)[number]["name"];
