export type Task = { id: string; title: string; done: boolean };
export type DemoState = {
  configured: boolean;
  session: boolean;
  expiresAt: string | null;
  hasAccess: boolean;
  tasks: Task[];
  publicCode: string;
};

export const starterTitles = [
  "Plan the next sprint",
  "Review the onboarding flow",
  "Share the release notes",
];
export const sampleTasks = starterTitles.map((title, i) => ({ id: `sample-${i}`, title, done: false }));
