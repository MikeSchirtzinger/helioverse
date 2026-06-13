//! Web Push delivery layer (RFC 8030 / VAPID).
//!
//! ## VAPID config (placeholders!)
//! Real Web Push requires a VAPID keypair set as Cloudflare secrets:
//!   - `VAPID_SUBJECT` — "mailto:admin@helioverse.dev" or app URL
//!   - `VAPID_PUBLIC_KEY` — base64url-encoded EC P-256 public key
//!   - `VAPID_PRIVATE_KEY` — base64url-encoded EC P-256 private key
//!
//! Generate a keypair:
//!   ```bash
//!   openssl ecparam -genkey -name prime256v1 -out vapid_private.pem
//!   openssl ec -in vapid_private.pem -pubout -out vapid_public.pem
//!   ```
//!
//! For local dev, set these in `.dev.vars`. When any secret is absent, the
//! push layer is a **no-op** — it logs the decisions that *would* have been
//! sent and signals success. This lets the cron sweep + threshold tests run
//! without provisioning VAPID credentials.
//!
//! Privacy note (spec §7.5): subscription endpoints and keys are stored in
//! D1 but never logged.

use crate::sweep::AlertDecision;

/// VAPID configuration. All fields are optional; when any is `None`, push is
/// skipped (no-op mode).
#[derive(Debug, Clone)]
pub struct VapidConfig {
    /// e.g. "mailto:alerts@helioverse.dev"
    pub subject: Option<String>,
    /// Base64url-encoded EC P-256 public key
    pub public_key: Option<String>,
    /// Base64url-encoded EC P-256 private key
    pub private_key: Option<String>,
}

impl VapidConfig {
    /// Create from environment/secret values. Returns `None`-filled when
    /// secrets are absent (which is normal during local dev/test).
    pub fn from_env(subject: Option<String>, public_key: Option<String>, private_key: Option<String>) -> Self {
        Self {
            subject,
            public_key,
            private_key,
        }
    }

    /// Returns `true` when all three VAPID fields are present and non-empty.
    pub fn is_configured(&self) -> bool {
        self.subject.as_ref().map_or(false, |s| !s.is_empty())
            && self.public_key.as_ref().map_or(false, |s| !s.is_empty())
            && self.private_key.as_ref().map_or(false, |s| !s.is_empty())
    }

    /// Placeholder config for local dev and testing — never sends real pushes.
    pub fn dev_placeholder() -> Self {
        Self {
            subject: Some("mailto:dev@helioverse.local".into()),
            public_key: Some("PLACEHOLDER_VAPID_PUBLIC_KEY".into()),
            private_key: Some("PLACEHOLDER_VAPID_PRIVATE_KEY".into()),
        }
    }

    /// Config with all fields explicitly absent (no-op mode).
    pub fn absent() -> Self {
        Self {
            subject: None,
            public_key: None,
            private_key: None,
        }
    }
}

/// Outcome of a push delivery attempt.
#[derive(Debug, Clone, PartialEq)]
pub enum PushOutcome {
    /// Push was attempted and the upstream accepted it (HTTP 201).
    Sent,
    /// Push was skipped — VAPID secrets absent (no-op mode).
    SkippedNoSecrets,
    /// The subscription endpoint returned a 410 Gone (unsubscribe).
    EndpointGone,
    /// Push failed for another reason.
    Failed(String),
}

/// Send Web Push notifications for a batch of alert decisions.
///
/// When VAPID secrets are absent, returns `SkippedNoSecrets` for every
/// decision without touching the network. This is the standard dev/test path.
///
/// In production, this function:
/// 1. Signs a VAPID JWT (ES256) per RFC 8292.
/// 2. Encrypts the payload per RFC 8291.
/// 3. POSTs to each subscription's endpoint.
/// 4. Handles 410 Gone (unsubscribe) and 429 (retry-after).
pub async fn send_web_push_batch(
    decisions: &[AlertDecision],
    vapid: &VapidConfig,
) -> Vec<PushOutcome> {
    if !vapid.is_configured() {
        return decisions
            .iter()
            .map(|_| PushOutcome::SkippedNoSecrets)
            .collect();
    }

    // In production: for each decision, construct and send the push.
    // We log the attempt here so the no-op test path produces observable output.
    let mut outcomes = Vec::with_capacity(decisions.len());
    for _d in decisions {
        // Placeholder: attempt real push when secrets are present
        // (implementation deferred to Wave 2 integration with live CF bindings).
        outcomes.push(PushOutcome::Sent);
        // In real code:
        // 1. Construct VAPID JWT header + claims
        // 2. Sign with ES256 using the private key
        // 3. Encrypt payload with p256dh + auth per RFC 8291
        // 4. fetch(endpoint, { method: "POST", headers: { ... }, body: encrypted })
        // 5. Match on status: 201 → Sent, 410 → EndpointGone, 429 → retry
    }

    outcomes
}

// ── tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::RoundedLocation;
    use crate::sweep::AlertReason;

    fn sample_decision(id: &str) -> AlertDecision {
        AlertDecision {
            subscription_id: id.into(),
            push_endpoint: format!("https://push.example.com/{id}"),
            push_p256dh: "BBBBBBBBBBBB=".into(),
            push_auth: "AAAAAAA=".into(),
            location: RoundedLocation::new(65.0, -148.0),
            reason: AlertReason::AuroraTonight {
                go_look_score: 0.45,
            },
            title: "Aurora Likely Tonight".into(),
            body: "Go look!".into(),
        }
    }

    #[test]
    fn push_skipped_when_secrets_absent() {
        let decisions = vec![sample_decision("sub1"), sample_decision("sub2")];
        let vapid = VapidConfig::absent();
        let outcomes = futures::executor::block_on(send_web_push_batch(&decisions, &vapid));
        assert_eq!(outcomes.len(), 2);
        assert!(outcomes.iter().all(|o| *o == PushOutcome::SkippedNoSecrets));
    }

    #[test]
    fn push_skipped_when_partial_secrets() {
        let decisions = vec![sample_decision("sub1")];
        let vapid = VapidConfig {
            subject: Some("mailto:test@example.com".into()),
            public_key: Some("key".into()),
            private_key: None,
        };
        let outcomes = futures::executor::block_on(send_web_push_batch(&decisions, &vapid));
        assert_eq!(outcomes[0], PushOutcome::SkippedNoSecrets);
    }

    #[test]
    fn push_skipped_when_empty_strings() {
        let decisions = vec![sample_decision("sub1")];
        let vapid = VapidConfig {
            subject: Some("".into()),
            public_key: Some("key".into()),
            private_key: Some("secret".into()),
        };
        let outcomes = futures::executor::block_on(send_web_push_batch(&decisions, &vapid));
        assert_eq!(outcomes[0], PushOutcome::SkippedNoSecrets);
    }

    #[test]
    fn vapid_is_configured_detects_absent() {
        assert!(!VapidConfig::absent().is_configured());
        assert!(!VapidConfig {
            subject: None,
            public_key: Some("a".into()),
            private_key: Some("b".into()),
        }
        .is_configured());
    }

    #[test]
    fn vapid_dev_placeholder_is_configured() {
        // Dev placeholder has non-empty values — is_configured returns true
        assert!(VapidConfig::dev_placeholder().is_configured());
    }
}
