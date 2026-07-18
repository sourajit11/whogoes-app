export interface ApiKeyRecord {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  daily_credit_cap: number | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface AuthenticatedRequest {
  userId: string;
  apiKeyId: string;
  dailyCreditCap: number | null;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
