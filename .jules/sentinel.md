## 2025-03-25 - Initial Security Audit and Remediation

**Vulnerability Context:**
The application, while in a demo/prototype stage, exhibits several common security anti-patterns:
1. **Hardcoded Role in Sidebar:** The `Sidebar` component uses a hardcoded `MANAGER` role, which bypasses the intended Role-Based Access Control (RBAC) and prevents administrators from seeing admin-only links. This is a form of Broken Access Control.
2. **Open Redirect in Login:** The login page accepts a `from` query parameter and redirects to it without sanitization, enabling phishing attacks via malicious redirects.
3. **Missing Security Headers:** The application lacks modern security headers (CSP, HSTS, X-Frame-Options), leaving it vulnerable to XSS and clickjacking.

**Architectural Learning:**
- Hardcoding roles for "easier development" in prototypes often persists into production, creating significant security debts.
- Client-side navigation and redirection must always treat URL parameters as untrusted input.
- Security headers should be configured at the platform level (Next.js config or Middleware) to ensure defense-in-depth from the start.

**Future Prevention:**
- Always derive the user's role and permissions from the authenticated session, never hardcode them for "testing".
- Implement a utility for sanitizing redirect paths to ensure they only lead to internal, trusted locations.
- Standardize security headers in the Next.js configuration for all environments.
