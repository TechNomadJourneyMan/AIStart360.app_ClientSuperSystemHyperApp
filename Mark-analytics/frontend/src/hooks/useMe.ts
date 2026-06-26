import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiGet } from '@/services/api';
import { useAuth } from '@/services/auth';

export type SubscriptionTier = 'free' | 'pro' | 'team' | 'enterprise' | string;

export interface MeResponse {
  id: string;
  email: string;
  full_name?: string | null;
  avatar_url?: string | null;
  tier: SubscriptionTier;
  created_at?: string | null;
  is_admin?: boolean | null;
}

export interface UsageCounter {
  used: number;
  limit: number;
  /** Optional human-readable period (e.g., "month"). */
  period?: string | null;
  /** Optional ISO reset timestamp. */
  resets_at?: string | null;
}

export interface MyUsageResponse {
  searches: UsageCounter;
  exports?: UsageCounter;
  alerts?: UsageCounter;
  ai_queries?: UsageCounter;
}

export interface MyLimitsResponse {
  tier: SubscriptionTier;
  searches_per_month: number;
  exports_per_month: number;
  alerts_max: number;
  ai_queries_per_month: number;
  features: string[];
}

export interface MySubscriptionResponse {
  tier: SubscriptionTier;
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | string;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
  trial_ends_at?: string | null;
  payment_provider?: string | null;
}

const ME_BASE = '/api/v1/me';
const STALE = 60_000;

export function useMe(): UseQueryResult<MeResponse, Error> {
  const { user } = useAuth();
  return useQuery<MeResponse, Error>({
    queryKey: ['me'],
    enabled: !!user,
    staleTime: STALE,
    queryFn: ({ signal }) => apiGet<MeResponse>(ME_BASE, undefined, signal),
  });
}

export function useMyUsage(): UseQueryResult<MyUsageResponse, Error> {
  const { user } = useAuth();
  return useQuery<MyUsageResponse, Error>({
    queryKey: ['me', 'usage'],
    enabled: !!user,
    staleTime: STALE,
    queryFn: ({ signal }) =>
      apiGet<MyUsageResponse>(`${ME_BASE}/usage`, undefined, signal),
  });
}

export function useMyLimits(): UseQueryResult<MyLimitsResponse, Error> {
  const { user } = useAuth();
  return useQuery<MyLimitsResponse, Error>({
    queryKey: ['me', 'limits'],
    enabled: !!user,
    staleTime: STALE,
    queryFn: ({ signal }) =>
      apiGet<MyLimitsResponse>(`${ME_BASE}/limits`, undefined, signal),
  });
}

export function useMySubscription(): UseQueryResult<MySubscriptionResponse, Error> {
  const { user } = useAuth();
  return useQuery<MySubscriptionResponse, Error>({
    queryKey: ['me', 'subscription'],
    enabled: !!user,
    staleTime: STALE,
    queryFn: ({ signal }) =>
      apiGet<MySubscriptionResponse>(`${ME_BASE}/subscription`, undefined, signal),
  });
}
