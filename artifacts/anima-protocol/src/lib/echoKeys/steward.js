// @ts-check
/**
 * The full Echo Key Codex is granted only to Dàvīn Smith (the Protocol steward).
 * Other operators keep the starter-Shard discovery path.
 *
 * Match on the already-known identity — primary email, GitHub login, or the
 * existing profile `admin` role that ADMIN_EMAILS already sets for this steward.
 * Do not invent extra emails here.
 */

export const ECHO_LIBRARY_STEWARD_EMAIL = "davins56@gmail.com";
export const ECHO_LIBRARY_STEWARD_GITHUB = "davins56";

/**
 * @param {unknown} value
 * @param {Set<string>} into
 */
function addEmail(value, into) {
  if (typeof value !== "string") return;
  const email = value.trim().toLowerCase();
  if (email.includes("@")) into.add(email);
}

/**
 * @param {unknown} value
 * @param {Set<string>} into
 */
function addHandle(value, into) {
  if (typeof value !== "string") return;
  const handle = value.trim().toLowerCase().replace(/^@/, "");
  if (handle && !handle.includes("@") && !handle.includes(" ")) into.add(handle);
}

/**
 * @param {Record<string, unknown>} user
 * @returns {Set<string>}
 */
function emailsOf(user) {
  const emails = new Set();
  addEmail(user.email, emails);
  addEmail(user.email_address, emails);
  addEmail(user.primary_email, emails);
  addEmail(user.primaryEmail, emails);
  const rows = user.email_addresses || user.emailAddresses;
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (typeof row === "string") addEmail(row, emails);
      else if (row && typeof row === "object") {
        addEmail(/** @type {{ email_address?: unknown, emailAddress?: unknown }} */ (row).email_address, emails);
        addEmail(/** @type {{ emailAddress?: unknown }} */ (row).emailAddress, emails);
      }
    }
  }
  return emails;
}

/**
 * @param {Record<string, unknown>} user
 * @returns {Set<string>}
 */
function handlesOf(user) {
  const handles = new Set();
  addHandle(user.username, handles);
  addHandle(user.github, handles);
  addHandle(user.github_username, handles);
  addHandle(user.github_login, handles);
  addHandle(user.githubUsername, handles);
  const accounts = user.external_accounts || user.externalAccounts;
  if (Array.isArray(accounts)) {
    for (const acc of accounts) {
      if (!acc || typeof acc !== "object") continue;
      const row = /** @type {{ provider?: unknown, username?: unknown, login?: unknown }} */ (acc);
      if (!String(row.provider || "").toLowerCase().includes("github")) continue;
      addHandle(row.username, handles);
      addHandle(row.login, handles);
    }
  }
  return handles;
}

/**
 * @param {unknown} user
 */
export function isEchoLibrarySteward(user) {
  if (!user || typeof user !== "object") return false;
  const record = /** @type {Record<string, unknown>} */ (user);
  if (String(record.role || "").toLowerCase() === "admin") return true;
  if (emailsOf(record).has(ECHO_LIBRARY_STEWARD_EMAIL)) return true;
  if (handlesOf(record).has(ECHO_LIBRARY_STEWARD_GITHUB)) return true;
  return false;
}
