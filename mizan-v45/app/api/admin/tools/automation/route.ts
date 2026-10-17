// Owner UI entry to the internal automation handler. It lives under /api/admin/ so that
// Cloudflare Access guards it and the HttpOnly admin cookie (Path=/api/admin) is sent.
// The handler itself enforces: owner identity + admin session + same-origin POST, and an
// action allowlist (see decideAutomationAuth / OWNER_SESSION_AUTOMATION_ACTIONS).
export {POST} from '../../../internal/automation/route';
