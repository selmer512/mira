# Security Boundaries

## Allowed
- Public web pages
- User-provided files
- User-provided domains
- User-provided usernames/emails
- Public metadata extraction from uploaded artifacts
- Rate-limited public APIs

## Not Allowed
- Credential attacks
- Login bypass
- Scraping private content behind authentication
- Session hijacking
- Exploit-based enumeration
- Doxxing workflows
- Breach database scraping containing sensitive leaked data
- Biometric identification of private individuals

## Required Controls
- Rate limiting
- Source attribution
- Audit logs
- Allowlist/denylist support
- Human review for sensitive findings
- Clear separation between facts, guesses, and correlations

## Implementation Note
Build collectors as disabled-by-default modules when they access external sources. Use environment flags to enable them after legal/compliance review.
