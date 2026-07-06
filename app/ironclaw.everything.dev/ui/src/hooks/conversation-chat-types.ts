export interface PendingApproval {
  gateRef: string;
  headline: string;
  toolName?: string;
  description?: string;
  allowAlways?: boolean;
  action?: { label?: string; method?: string };
  scope?: { label?: string; reusable?: boolean };
  destination?: { label?: string; url?: string; domain?: string };
  details?: Array<{ label?: string; value?: string }>;
}

export interface AuthGate {
  runId: string;
  gateRef: string;
  challengeKind: string;
  provider?: string;
  accountLabel?: string;
  authorizationUrl?: string;
  expiresAt?: string;
  headline?: string;
  body?: string;
}
