import { DEMO_BUSINESS_ID, DEMO_BUSINESS_NAME } from "./help-center";

/** The Nimbus marketing site's widget and help pages. */
export const DEMO_WIDGET = {
  business: { id: DEMO_BUSINESS_ID, name: DEMO_BUSINESS_NAME },
  helpBase: "/help",
  suggestions: [
    "Why does my invoice show extra seats?",
    "SSO loops back to Google.",
    "Where do I find API keys?",
  ],
};

export const DEMO_HELP_INTRO =
  "These are the articles the widget searches. Billing, SSO, API keys, empty funnels.";

export const DEMO_CATEGORY_BLURBS: Record<string, string> = {
  "Getting started": "Workspaces, projects, first events.",
  Billing: "Seats, event quotas, failed cards.",
  Security: "SSO, Google Workspace, Okta.",
  Developers: "Write keys, read keys, rate limits.",
  Privacy: "Retention windows and exports.",
  Team: "Invites, owners, editors, viewers.",
  Charts: "Funnels, zeros, CSV dumps.",
};
