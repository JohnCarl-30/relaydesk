/** Nimbus staff login the e2e server starts with; the inbox tests sign in with it. */
export const ADMIN_EMAIL = "staff@nimbus.demo";
export const ADMIN_PASSWORD = "nimbus-demo";

/** A second business, created by scripts/add-business.ts before the server starts. */
export const ACME = {
  id: "acme-coffee",
  name: "Acme Coffee",
  articles: "e2e/fixtures/acme-articles.json",
  email: "owner@acme.test",
  password: "acme-e2e-password",
};
