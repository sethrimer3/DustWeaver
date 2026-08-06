/**
 * workshopBrowser.ts — Steam Workshop browser modal.
 *
 * Lists subscribed Workshop items, lets the player subscribe/unsubscribe,
 * play installed items via the existing campaign flow, and publish a local
 * custom campaign. Opened from the Custom Campaigns screen's
 * "Browse Workshop" button.
 */
import { getWorkshopAdapter } from '../workshop';
import type { WorkshopItem } from '../workshop/types';
import { onWorkshopPublished, onWorkshopSubscribed } from '../progression/achievementTracker';
import { showWorkshopPublishDialog, type PublishableCampaign } from './workshopPublishDialog';
import { getUiFontFamily, t } from '../i18n';

export interface WorkshopBrowserCallbacks {
  /** Called when the player wants to play an installed Workshop item's campaign. */
  onPlayItem?: (item: WorkshopItem) => void;
  /**
   * Supplies the local custom campaigns eligible for upload. An empty list
   * (or an absent callback) hides the Publish control entirely.
   */
  getPublishableCampaigns?: () => PublishableCampaign[];
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

  const errorEl = document.createElement('div');
  errorEl.style.cssText = `
    width: 100%; max-width: 640px; color: #ee8877; font-size: 0.82rem;
    margin-bottom: 0.6rem; white-space: pre-wrap; display: none;
  `;
  overlay.appendChild(errorEl);

  function showBrowserError(message: string): void {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  }
  function clearBrowserError(): void {
    errorEl.textContent = '';
    errorEl.style.display = 'none';
  }

  // Steam has no in-client Workshop search API exposed here, so subscribing by
  // published-file ID is how a player pulls in an item they found on the web.
  const addRow = document.createElement('div');
  addRow.style.cssText = 'width:100%; max-width:640px; display:flex; gap:0.5rem; margin-bottom:0.8rem;';
  const idInput = document.createElement('input');
  idInput.type = 'text';
  idInput.placeholder = t('workshop.addByIdPlaceholder');
  idInput.style.cssText = `
    flex:1; background: rgba(15,15,22,0.9); border: 1px solid #4a4a58; color: #e8ddc0;
    padding: 0.45rem 0.6rem; border-radius: 2px; font-size: 0.88rem;
    font-family: ${getUiFontFamily()};
  `;
  const addBtn = document.createElement('button');
  addBtn.textContent = t('workshop.subscribe');
  addBtn.style.cssText = 'background: rgba(20,60,120,0.5); border: 1px solid #3388cc; color: #66aaff; padding: 0.45rem 1.1rem; cursor: pointer; border-radius: 2px;';
  addBtn.addEventListener('click', () => {
    void (async () => {
      const id = idInput.value.trim();
      if (id.length === 0) return;
      clearBrowserError();
      addBtn.disabled = true;
      try {
        const adapter = getWorkshopAdapter();
        await adapter.subscribe(id);
        onWorkshopSubscribed();
        await adapter.download(id);
        idInput.value = '';
        await refresh();
      } catch (e) {
        showBrowserError(e instanceof Error ? e.message : String(e));
      } finally {
        addBtn.disabled = false;
      }
    })();
  });
  addRow.append(idInput, addBtn);
  overlay.appendChild(addRow);

  const listEl = document.createElement('div');
  listEl.style.cssText = 'width: 100%; max-width: 640px; display: flex; flex-direction: column; gap: 0.6rem;';
  overlay.appendChild(listEl);

  const publishable = callbacks.getPublishableCampaigns?.() ?? [];
  if (publishable.length > 0) {
    const publishRow = document.createElement('div');
    publishRow.style.cssText = `
      display:flex; gap:0.5rem; align-items:center; margin-top:1rem;
      width:100%; max-width:640px; justify-content:center; flex-wrap:wrap;
    `;

    const campaignSelect = document.createElement('select');
    campaignSelect.style.cssText = `
      background: rgba(15,15,22,0.9); border: 1px solid #4a4a58; color: #e8ddc0;
      padding: 0.5rem 0.6rem; border-radius: 2px; font-size: 0.88rem;
      font-family: ${getUiFontFamily()}; max-width: 320px;
    `;
    for (const campaign of publishable) {
      const option = document.createElement('option');
      option.value = campaign.campaignId;
      option.textContent = campaign.defaultTitle;
      campaignSelect.appendChild(option);
    }
    publishRow.appendChild(campaignSelect);

    const publishBtn = document.createElement('button');
    publishBtn.textContent = t('workshop.publish');
    publishBtn.style.cssText = `
      background: rgba(30,80,40,0.5); border: 1.5px solid #44cc66;
      color: #44ee77; padding: 0.6rem 1.6rem; cursor: pointer; border-radius: 2px;
      font-family: ${getUiFontFamily()};
    `;
    publishBtn.addEventListener('click', () => {
      const selected = publishable.find((c) => c.campaignId === campaignSelect.value);
      if (!selected) return;
      showWorkshopPublishDialog(overlay, selected, () => {
        onWorkshopPublished();
        void refresh();
      });
    });
    publishRow.appendChild(publishBtn);
    overlay.appendChild(publishRow);
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
    let items: WorkshopItem[];
    try {
      items = await adapter.getSubscribedItems();
    } catch (e) {
      // A Steam hiccup must leave the modal usable rather than showing a
      // permanently blank list with no explanation.
      showBrowserError(e instanceof Error ? e.message : String(e));
      return;
    }
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

    const statusText = item.downloading
      ? t('workshop.statusDownloading')
      : item.needsUpdate
        ? t('workshop.statusUpdateAvailable')
        : item.installed
          ? t('workshop.statusInstalled')
          : t('workshop.statusNotInstalled');

    const info = document.createElement('div');
    info.innerHTML = `<div style="color:#e0d0a0;font-size:1rem;">${escapeHtml(item.title)}</div>
      <div style="color:#999;font-size:0.8rem;">${escapeHtml(item.description)} — ${escapeHtml(item.authorName)}</div>
      <div style="color:#7a8a9a;font-size:0.75rem;">${escapeHtml(statusText)}</div>`;
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

    // Subscribing tells Steam to fetch the item, but installation is
    // asynchronous — this button lets the player force/await the download and
    // reports failures inline instead of silently doing nothing.
    if (!item.installed || item.needsUpdate) {
      const downloadBtn = document.createElement('button');
      downloadBtn.textContent = item.needsUpdate ? t('workshop.update') : t('workshop.download');
      downloadBtn.style.cssText = 'background: rgba(20,80,60,0.5); border: 1px solid #33cc99; color: #66ffcc; padding: 0.4rem 1rem; cursor: pointer;';
      downloadBtn.addEventListener('click', () => {
        void (async () => {
          downloadBtn.disabled = true;
          downloadBtn.textContent = t('workshop.statusDownloading');
          try {
            await adapter.download(item.steamPublishedFileId);
            await refresh();
          } catch (e) {
            showBrowserError(e instanceof Error ? e.message : String(e));
            downloadBtn.disabled = false;
            downloadBtn.textContent = t('workshop.download');
          }
        })();
      });
      actions.appendChild(downloadBtn);
    }

    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = item.subscribed
      ? t('workshop.unsubscribe')
      : t('workshop.subscribe');
    toggleBtn.style.cssText = 'background: rgba(60,30,30,0.5); border: 1px solid #cc6644; color: #ee9977; padding: 0.4rem 1rem; cursor: pointer;';
    toggleBtn.addEventListener('click', () => {
      void (async () => {
        clearBrowserError();
        toggleBtn.disabled = true;
        try {
          if (item.subscribed) {
            await adapter.unsubscribe(item.steamPublishedFileId);
          } else {
            await adapter.subscribe(item.steamPublishedFileId);
            onWorkshopSubscribed();
          }
          await refresh();
        } catch (e) {
          showBrowserError(e instanceof Error ? e.message : String(e));
          toggleBtn.disabled = false;
        }
      })();
    });
    actions.appendChild(toggleBtn);

    row.appendChild(actions);
    return row;
  }

  container.appendChild(overlay);
  await refresh();

  return () => overlay.remove();
}
