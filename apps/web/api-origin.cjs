/** @param {NodeJS.ProcessEnv} [env] */
function apiOrigin(env = process.env) {
  const value = env.API_URL ?? "http://localhost:3001";
  let url;
  try { url = new URL(value); } catch { throw new Error("Configure uma API_URL válida para o backend."); }
  if (url.origin !== value || url.username || url.password || (url.protocol !== "https:"
    && (env.NODE_ENV === "production" || url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)))) {
    throw new Error("Configure API_URL com a origem HTTPS da API, sem caminho ou barra final.");
  }
  return value;
}

module.exports = { apiOrigin };
