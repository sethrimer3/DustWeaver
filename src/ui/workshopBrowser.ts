/**
 * workshopBrowser.ts — Steam Workshop browser modal.
 *
 * Lists subscribed Workshop items, lets the player subscribe/unsubscribe,
 * play installed items via the existing campaign flow, and publish a local
 * custom campaign. Opened from the Custom Campaigns screen's
 * "Browse Workshop" button.
 */
import { getWorkshopAdapter } from '../workshop';
import type { WorkshopItem, WorkshopPackageManifest } from '../workshop/types';
import { validateWorkshopPackage, type WorkshopPackageFile } from '../workshop/packageValidator';
import { onWorkshopPublished, onWorkshopSubscribed } from '../progression/achievementTracker';
import { getUiFontFamily, t } from '../i18n';

export interface WorkshopBrowserCallbacks {
  /** Called when the player wants to play an installed Workshop item's campaign. */
  onPlayItem?: (item: WorkshopItem) => void;
  /**
   * Supplies the currently-selected local custom campaign for publishing, if
   * any. Returns null when no local campaign is selected (hides Publish).
   */
  getSelectedLocalCampaign?: () => { manifest: WorkshopPackageManifest; campaignDir: string; files: WorkshopPackageFile[]; campaignData: unknown } | null;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function showWorkshopBrowser(
  container: HTMLElement,
  callbacks: WorkshopBrowserCallbacks,
  onClose: () => void,
): Promise<() => void> {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(10,10,15,0.92);
    display: flex; flex-direction: column; align-items: center;
    padding: 2rem; overflow-y: auto; z-index: 500;
    font-family: ${getUiFontFamily()};
  `;

  const heading = document.createElement('h2');
  heading.textContent = t('workshop.heading');
  heading.style.cssText = 'color: #d4a84b; font-size: 1.6rem; margin-bottom: 1rem;';
  overlay.appendChild(heading);

  const listEl = document.createElement('div');
  listEl.style.cssText = 'width: 100%; max-width: 640px; display: flex; flex-direction: column; gap: 0.6rem;';
  overlay.appendChild(listEl);

  const publishSection = callbacks.getSelectedLocalCampaign?.();
  if (publishSection) {
    const publishBtn = document.createElement('button');
    publishBtn.textContent = t('workshop.publish');
    publishBtn.style.cssText = `
      margin-top: 1rem; background: rgba(30,80,40,0.5); border: 1.5px solid #44cc66;
      color: #44ee77; padding: 0.6rem 1.6rem; cursor: pointer; border-radius: 2px;
    `;
    publishBtn.addEventListener('click', async () => {
      const { manifest, campaignDir, files, campaignData } = publishSection;
      const result = validateWorkshopPackage(manifest, campaignData, files);
      if (!result.valid) {
        alert(result.errors.join('\n'));
        return;
      }
      const adapter = getWorkshopAdapter();
      await adapter.publish(manifest, campaignDir);
      onWorkshopPublished();
      await refresh();
    });
    overlay.appendChild(publishBtn);
  }

  const closeBtn = document.createElement('button');
  closeBtn.textContent = t('common.back');
  closeBtn.style.cssText = `
    margin-top: 1.5rem; background: rgba(60,60,70,0.5); border: 1px solid #888;
    color: #ccc; padding: 0.5rem 1.4rem; cursor: pointer; border-radius: 2px;
  `;
  closeBtn.addEventListener('click', () => {
    overlay.remove();
    onClose();
  });
  overlay.appendChild(closeBtn);

  async function refresh(): Promise<void> {
    listEl.innerHTML = '';
    const adapter = getWorkshopAdapter();
    const items = await adapter.getSubscribedItems();
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color: #999; padding: 1rem 0;';
      empty.textContent = t('workshop.empty');
      listEl.appendChild(empty);
      return;
    }
    for (const item of items) {
      listEl.appendChild(renderItemRow(item, adapter));
    }
  }

  function renderItemRow(item: WorkshopItem, adapter: ReturnType<typeof getWorkshopAdapter>): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = `
      display: flex; align-items: center; justify-content: space-between;
      background: rgba(30,30,40,0.6); border: 1px solid #444; border-radius: 3px;
      padding: 0.6rem 1rem;
    `;

    const info = document.createElement('div');
    info.innerHTML = `<div style="color:#e0d0a0;font-size:1rem;">${escapeHtml(item.title)}</div>
      <div style="color:#999;font-size:0.8rem;">${escapeHtml(item.description)} — ${escapeHtml(item.authorName)}</div>`;
    row.appendChild(info);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex; gap:0.5rem;';

    if (item.installed && callbacks.onPlayItem) {
      const playBtn = document.createElement('button');
      playBtn.textContent = t('workshop.play');
      playBtn.style.cssText = 'background: rgba(20,60,120,0.5); border: 1px solid #3388cc; color: #66aaff; padding: 0.4rem 1rem; cursor: pointer;';
      playBtn.addEventListener('click', () => callbacks.onPlayItem?.(item));
      actions.appendChild(playBtn);
    }

    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = item.subscribed
      ? t('workshop.unsubscribe')
      : t('workshop.subscribe');
    toggleBtn.style.cssText = 'background: rgba(60,30,30,0.5); border: 1px solid #cc6644; color: #ee9977; padding: 0.4rem 1rem; cursor: pointer;';
    toggleBtn.addEventListener('click', async () => {
      if (item.subscribed) {
        await adapter.unsubscribe(item.steamPublishedFileId);
      } else {
        await adapter.subscribe(item.steamPublishedFileId);
        onWorkshopSubscribed();
      }
      await refresh();
    });
    actions.appendChild(toggleBtn);

    row.appendChild(actions);
    return row;
  }

  container.appendChild(overlay);
  await refresh();

  return () => overlay.remove();
}
