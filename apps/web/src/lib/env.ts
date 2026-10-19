/** The API's public origin. The browser calls it directly; the session cookie lives there. */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(
  /\/$/,
  "",
);
