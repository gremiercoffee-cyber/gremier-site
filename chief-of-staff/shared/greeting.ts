/**
 * The name to use after "Hi" for {first_name}: someone with a title keeps it with the surname ("R' Heyman",
 * "Rabbi Cohen", "Dr. Levi"); everyone else gets their first name ("Moshe Katz" → "Moshe").
 */
const TITLE = /^(rabbi|rav|harav|reb|r['’׳]|r\.|mr|mrs|ms|dr|prof|הרב|ר['׳])\.?\s/i;
export function greetingName(name: string) {
  const n = name.trim();
  return TITLE.test(n) ? n : n.split(/\s+/)[0] || n;
}
