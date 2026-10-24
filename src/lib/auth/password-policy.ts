/**
 * Password rules (docs/security.md §3.2): length-based, no composition rules. Lengths are settings
 * (`identity.password.min_length`, A-SEC-03); the maximum is fixed at 128 to bound hashing cost.
 *
 * Deny list: a bundled offline list of very common and breached passwords (A-SEC-04). The full
 * "top 100k" list in the security policy is not bundled yet; this compact list covers the common
 * patterns of 8+ characters and is flagged for the security reviewer (A-W2E-03).
 */
export const PASSWORD_MAX_LENGTH = 128;

const COMMON = new Set(
  [
    "password", "password1", "password12", "password123", "password1234", "password12345", "password123456",
    "passw0rd", "p@ssw0rd", "p@ssword", "p@ssword123", "passwordpassword", "123456789", "1234567890", "12345678",
    "123456789012", "1234567890123", "qwertyuiop", "qwerty123", "qwerty123456", "qwertyuiop123", "1q2w3e4r",
    "1q2w3e4r5t", "1q2w3e4r5t6y", "1qaz2wsx", "1qaz2wsx3edc", "zaq12wsx", "asdfghjkl", "asdfghjkl123",
    "zxcvbnm123", "iloveyou", "iloveyou123", "iloveyou1234", "princess123", "sunshine123", "football123",
    "baseball123", "superman123", "batman12345", "welcome123", "welcome1234", "welcome2024", "welcome2025",
    "welcome2026", "letmein123", "letmeinplease", "trustno1trustno1", "monkey123456", "dragon123456",
    "abc123456789", "abcdefghijkl", "abcd1234abcd", "aa123456789", "11111111", "111111111111", "000000000000",
    "123123123123", "987654321", "9876543210", "changeme", "changeme123", "changemenow", "administrator",
    "admin123456", "admin1234567", "adminadmin", "adminpassword", "rootpassword", "default12345",
    "manila123456", "philippines", "philippines1", "philippines123", "pilipinas123", "mahalkita123",
    "mahalkoikaw", "iloveyoumahal", "jesuschrist", "godisgood123", "computer123", "internet123",
    "starwars1234", "pokemon12345", "minecraft123", "whatever123", "qwertyqwerty", "asdfasdfasdf",
    "summer2024!", "summer2025!", "spring2026!", "winter2025!", "december2025", "january2026",
    "october2026", "november2026", "company123", "company12345", "secret123456", "mypassword",
    "mypassword123", "newpassword", "newpassword123", "temppassword", "temporary123", "guest1234567",
    "soap12345678", "lotion123456", "demo1234demo",
  ].map((p) => p.toLowerCase()),
);

export type PasswordContext = { email: string; displayName: string; minLength: number };

/** Returns a plain-language reason the password is refused, or null when it is acceptable. */
export function passwordProblem(password: string, c: PasswordContext): string | null {
  if (password.length < c.minLength) return `Use at least ${c.minLength} characters. A short sentence is easy to remember.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return "This password is too common. Choose something less predictable.";
  if (/^(.)\1+$/.test(password)) return "Do not repeat a single character.";
  if (lower.includes("bryel")) return "The password must not contain the company name.";
  const local = c.email.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 3 && lower.includes(local)) return "The password must not contain your email name.";
  for (const part of c.displayName.toLowerCase().split(/\s+/)) {
    if (part.length >= 3 && lower.includes(part)) return "The password must not contain your name.";
  }
  return null;
}
