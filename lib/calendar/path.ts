/** Edge-safe (no Node APIs): the only /api/cal paths the sign-in gate lets through — a 43-character token + ".ics". */
export const FEED_PATH_RE = /^\/api\/cal\/[A-Za-z0-9_-]{43}\.ics$/;
