import type { components } from '@/generated/api';

// --- Backend types (derived from OpenAPI spec, single source of truth) ---

export type Profile = components['schemas']['ProfileOut'];
export type Song = components['schemas']['SongOut'];
export type SongRevision = components['schemas']['SongRevisionOut'];
export type SavedModel = components['schemas']['ProfileModelOut'];
export type ProviderConnection = components['schemas']['ProviderConnectionOut'];
export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  created_at: string;
}
export type ChatHistoryRow = components['schemas']['ChatMessageOut'];
export type ParseResult = components['schemas']['ParseResponse'];
export type TokenUsage = components['schemas']['TokenUsage'];
export type ChatResult = components['schemas']['ChatResponse'];
export type ProviderInfo = components['schemas']['ProviderInfo'];
export type ProvidersResponse = components['schemas']['ProvidersResponse'];

// --- Frontend-only types (no backend equivalent, stay manual) ---

export interface RewriteResult {
  original_content: string;
  rewritten_content: string;
  changes_summary: string;
  title?: string;
  artist?: string;
}

export interface RewriteMeta {
  title?: string;
  artist?: string;
  source_url?: string;
  profile_id?: number;
  llm_provider?: string;
  llm_model?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  isNote?: boolean;
  rawContent?: string;
  reasoning?: string;
  model?: string;
  images?: string[];  // base64 data URLs for display in bubbles
  pending?: boolean;  // queued while LLM is busy, awaiting delivery
  errorType?: string; // error classification from backend (e.g. "provider_rate_limit")
}

export interface AttachedFile {
  type: 'image' | 'pdf' | 'text';
  name: string;
  content: string; // base64 data URL for images, extracted text for pdf/text
}

export interface LlmSettings {
  provider: string;
  model: string;
  reasoning_effort: string;
}

export interface Provider {
  name: string;
  local: boolean;
}

export interface AuthConfig {
  method: 'none' | 'password' | 'oauth_google';
  required: boolean;
  google_client_id?: string;
  require_invite_code?: boolean;
  magic_link_enabled?: boolean;
  github_oauth_enabled?: boolean;
  open_signup?: boolean;
}
