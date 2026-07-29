/**
 * Typed IPC channel definitions for the platform-services boundary between
 * the Electron renderer and main process. The main process is the only
 * place that may `require('steamworks.js')`; the renderer only ever talks
 * to these channels via `rendererPlatform.ts`.
 */
import type { AchievementId, AchievementStatus } from './types';
import type { WorkshopItem, WorkshopPackageManifest } from '../workshop/types';

export const PLATFORM_UNLOCK_ACHIEVEMENT = 'dw:platform-unlock-achievement' as const;
export const PLATFORM_GET_ACHIEVEMENT = 'dw:platform-get-achievement' as const;
export const PLATFORM_GET_ALL_ACHIEVEMENTS = 'dw:platform-get-all-achievements' as const;
export const PLATFORM_STORE_STATS = 'dw:platform-store-stats' as const;
export const PLATFORM_GET_PERSONA_NAME = 'dw:platform-get-persona-name' as const;

export const WORKSHOP_PUBLISH = 'dw:workshop-publish' as const;
export const WORKSHOP_GET_ITEMS = 'dw:workshop-get-items' as const;
export const WORKSHOP_SUBSCRIBE = 'dw:workshop-subscribe' as const;
export const WORKSHOP_UNSUBSCRIBE = 'dw:workshop-unsubscribe' as const;
export const WORKSHOP_INSTALL_PATH = 'dw:workshop-install-path' as const;

export interface PlatformUnlockAchievementRequest {
  id: AchievementId;
}
export type PlatformUnlockAchievementResponse = { ok: true } | { ok: false; error: string };

export interface PlatformGetAchievementRequest {
  id: AchievementId;
}
export type PlatformGetAchievementResponse =
  | { ok: true; status: AchievementStatus }
  | { ok: false; error: string };

export type PlatformGetAllAchievementsResponse =
  | { ok: true; statuses: AchievementStatus[] }
  | { ok: false; error: string };

export type PlatformStoreStatsResponse = { ok: true } | { ok: false; error: string };

export type PlatformGetPersonaNameResponse =
  | { ok: true; personaName: string | null }
  | { ok: false; error: string };

export interface WorkshopPublishRequest {
  manifest: WorkshopPackageManifest;
  campaignDir: string;
}
export type WorkshopPublishResponse =
  | { ok: true; item: WorkshopItem }
  | { ok: false; error: string };

export type WorkshopGetItemsResponse =
  | { ok: true; items: WorkshopItem[] }
  | { ok: false; error: string };

export interface WorkshopSubscribeRequest {
  steamPublishedFileId: string;
}
export type WorkshopSubscribeResponse = { ok: true } | { ok: false; error: string };

export interface WorkshopUnsubscribeRequest {
  steamPublishedFileId: string;
}
export type WorkshopUnsubscribeResponse = { ok: true } | { ok: false; error: string };

export interface WorkshopInstallPathRequest {
  steamPublishedFileId: string;
}
export type WorkshopInstallPathResponse =
  | { ok: true; installPath: string | null }
  | { ok: false; error: string };
