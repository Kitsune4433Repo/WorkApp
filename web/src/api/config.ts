// Falls back to '/api' for the Vite dev proxy and docker-compose setups where the web app is
// served from the same host as the API. Set VITE_API_BASE_URL at build time whenever the frontend
// and backend are on different origins — e.g. a Render deploy where the static site and the API
// service each get their own onrender.com subdomain.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

// The Socket.IO connection is separate from the REST API path (it's a raw origin + a custom
// `path`, not a URL prefix) — derive it by stripping the "/api" suffix. Left as '/' for the
// same-origin case, which socket.io-client treats as "connect to the page's own origin".
export const SOCKET_ORIGIN = API_BASE_URL.startsWith('http') ? API_BASE_URL.replace(/\/api\/?$/, '') : '/';
