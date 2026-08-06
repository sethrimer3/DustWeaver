/**
 * workshopPublishDialog.ts — metadata form for uploading a campaign to the
 * Steam Workshop.
 *
 * Collects title / description / tags / visibility / preview image, validates
 * the resulting package with the same `validateWorkshopPackage` the download
 * path uses, and calls the Workshop adapter. When the campaign has been
 * published before (see `publishedItemRegistry`), this updates that item
 * instead of creating a duplicate.
 */
import { getWorkshopAdapter } from '../workshop';
import { getPlatformAdapter } from '../platform';
import { validateWorkshopPackage, type WorkshopPackageFile } from '../workshop/packageValidator';
import { getPublishedItemId, setPublishedItemId } from '../workshop/publishedItemRegistry';
import type { WorkshopPackageManifest, WorkshopVisibility } from '../workshop/types';
import { BUILD_NUMBER } from '../build-info';
import { getUiFontFamily, t } from '../i18n';

/** The local campaign being published, as supplied by the Custom Campaigns screen. */
export interface PublishableCampaign {
  campaignId: string;
  defaultTitle: string;
  defaultDescription: string;
  /** Loads the packed `SavedCampaignV1` to upload. */
  loadCampaign: () => Promise<unknown>;
}

const LABEL_CSS = 'color:#c8b487; font-size:0.82rem; letter-spacing:0.05em; margin-bottom:0.25rem;';
const FIELD_CSS = `
  width:100%; background:rgba(15,15,22,0.9); border:1px solid #4a4a58; color:#e8ddc0;
  padding:0.45rem 0.6rem; border-radius:2px; font-size:0.9rem; box-sizing:border-box;
`;

function field(labelText: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex; flex-direction:column; margin-bottom:0.8rem;';
  const label = document.createElement('label');
  label.textContent = labelText;
  label.style.cssText = LABEL_CSS;
  wrap.append(label, control);
  return wrap;
}

/**
 * `gameVersion` in the manifest must look like semver, but the repo tracks a
 * single integer `BUILD_NUMBER`. Encode it as `0.0.<build>` so the validator
 * passes and the value still identifies the exact build that authored the
 * package.
 */
function gameVersionString(): string {
  return `0.0.${BUILD_NUMBER}`;
}

/** Reads a picked image file as a data URL, or null if it is too large / unreadable. */
async function readPreviewFile(file: File): Promise<string | null> {
  if (file.size > 1024 * 1024) return null;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/**
 * Shows the publish dialog over `container`. Resolves when the dialog closes;
 * `onPublished` fires first on a successful upload so the caller can refresh
 * its list.
 */
export function showWorkshopPublishDialog(
  container: HTMLElement,
  campaign: PublishableCampaign,
  onPublished: (steamPublishedFileId: string) => void,
): void {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(8,8,12,0.94);
    display: flex; align-items: center; justify-content: center;
    z-index: 600; font-family: ${getUiFontFamily()};
  `;

  const panel = document.createElement('div');
  panel.style.cssText = `
    background: rgba(24,24,32,0.98); border: 1px solid #d4a84b40; border-radius: 4px;
    padding: 1.4rem 1.6rem; width: min(560px, 92vw); max-height: 88vh; overflow-y: auto;
  `;

  const heading = document.createElement('h3');
  heading.textContent = t('workshop.publishHeading');
  heading.style.cssText = 'color:#d4a84b; font-size:1.25rem; margin:0 0 1rem;';
  panel.appendChild(heading);

  const existingItemId = getPublishedItemId(campaign.campaignId);

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.maxLength = 128;
  titleInput.value = campaign.defaultTitle;
  titleInput.style.cssText = FIELD_CSS;
  panel.appendChild(field(t('workshop.fieldTitle'), titleInput));

  const descInput = document.createElement('textarea');
  descInput.rows = 4;
  descInput.value = campaign.defaultDescription;
  descInput.style.cssText = `${FIELD_CSS} resize: vertical;`;
  panel.appendChild(field(t('workshop.fieldDescription'), descInput));

  const tagsInput = document.createElement('input');
  tagsInput.type = 'text';
  tagsInput.placeholder = t('workshop.fieldTagsPlaceholder');
  tagsInput.style.cssText = FIELD_CSS;
  panel.appendChild(field(t('workshop.fieldTags'), tagsInput));

  const visibilitySelect = document.createElement('select');
  visibilitySelect.style.cssText = FIELD_CSS;
  // Private first: it is the safe default for a brand-new item, since Steam
  // hides items anyway until the author accepts the Workshop agreement.
  const visibilityOptions: Array<{ value: WorkshopVisibility; label: string }> = [
    { value: 'private', label: t('workshop.visibilityPrivate') },
    { value: 'friendsOnly', label: t('workshop.visibilityFriends') },
    { value: 'unlisted', label: t('workshop.visibilityUnlisted') },
    { value: 'public', label: t('workshop.visibilityPublic') },
  ];
  for (const option of visibilityOptions) {
    const el = document.createElement('option');
    el.value = option.value;
    el.textContent = option.label;
    visibilitySelect.appendChild(el);
  }
  panel.appendChild(field(t('workshop.fieldVisibility'), visibilitySelect));

  const previewInput = document.createElement('input');
  previewInput.type = 'file';
  previewInput.accept = 'image/png,image/jpeg';
  previewInput.style.cssText = `${FIELD_CSS} padding:0.35rem;`;
  panel.appendChild(field(t('workshop.fieldPreview'), previewInput));

  const itemIdInput = document.createElement('input');
  itemIdInput.type = 'text';
  itemIdInput.value = existingItemId ?? '';
  itemIdInput.placeholder = t('workshop.fieldItemIdPlaceholder');
  itemIdInput.style.cssText = FIELD_CSS;
  panel.appendChild(field(t('workshop.fieldItemId'), itemIdInput));

  const changeNoteInput = document.createElement('input');
  changeNoteInput.type = 'text';
  changeNoteInput.style.cssText = FIELD_CSS;
  panel.appendChild(field(t('workshop.fieldChangeNote'), changeNoteInput));

  const statusEl = document.createElement('div');
  statusEl.style.cssText = 'color:#999; font-size:0.82rem; margin:0.4rem 0 0.8rem; white-space:pre-wrap;';
  panel.appendChild(statusEl);

  const buttonRow = document.createElement('div');
  buttonRow.style.cssText = 'display:flex; gap:0.6rem; justify-content:flex-end;';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = t('common.back');
  cancelBtn.style.cssText = `
    background: rgba(60,60,70,0.5); border:1px solid #888; color:#ccc;
    padding:0.5rem 1.2rem; cursor:pointer; border-radius:2px;
  `;
  cancelBtn.addEventListener('click', () => overlay.remove());

  const submitBtn = document.createElement('button');
  submitBtn.textContent = existingItemId ? t('workshop.updateAction') : t('workshop.publishAction');
  submitBtn.style.cssText = `
    background: rgba(30,80,40,0.5); border:1.5px solid #44cc66; color:#44ee77;
    padding:0.5rem 1.4rem; cursor:pointer; border-radius:2px;
  `;

  function setBusy(busy: boolean): void {
    submitBtn.disabled = busy;
    cancelBtn.disabled = busy;
    submitBtn.style.opacity = busy ? '0.5' : '1';
  }

  function showError(message: string): void {
    statusEl.style.color = '#ee8877';
    statusEl.textContent = message;
  }

  submitBtn.addEventListener('click', () => {
    void (async () => {
      setBusy(true);
      statusEl.style.color = '#999';
      statusEl.textContent = t('workshop.statusPreparing');

      try {
        const title = titleInput.value.trim();
        if (title.length === 0) {
          showError(t('workshop.errorTitleRequired'));
          setBusy(false);
          return;
        }

        const campaignData = await campaign.loadCampaign();
        const personaName = await getPlatformAdapter().getPersonaName();

        const manifest: WorkshopPackageManifest = {
          formatVersion: 1,
          title,
          description: descInput.value,
          authorSteamId: personaName ?? 'unknown',
          campaignId: campaign.campaignId,
          gameVersion: gameVersionString(),
          tags: tagsInput.value
            .split(',')
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0),
        };

        // Validate the package we are about to upload against exactly the
        // rules the download path enforces, so a bad campaign fails here
        // rather than after it is live on the Workshop.
        const campaignJson = JSON.stringify(campaignData);
        const files: WorkshopPackageFile[] = [
          { path: 'workshop-meta.json', sizeBytes: JSON.stringify(manifest).length },
          { path: `${campaign.campaignId}.dwcampaign.json`, sizeBytes: campaignJson.length },
        ];
        const validation = validateWorkshopPackage(manifest, campaignData, files);
        if (!validation.valid) {
          showError(validation.errors.join('\n'));
          setBusy(false);
          return;
        }

        let previewImageDataUrl: string | undefined;
        const previewFile = previewInput.files?.[0];
        if (previewFile) {
          const dataUrl = await readPreviewFile(previewFile);
          if (!dataUrl) {
            showError(t('workshop.errorPreviewTooLarge'));
            setBusy(false);
            return;
          }
          previewImageDataUrl = dataUrl;
        }

        statusEl.textContent = t('workshop.statusUploading');

        const typedItemId = itemIdInput.value.trim();
        const result = await getWorkshopAdapter().publish({
          manifest,
          campaign: campaignData,
          existingPublishedFileId: typedItemId.length > 0 ? typedItemId : undefined,
          visibility: visibilitySelect.value as WorkshopVisibility,
          changeNote: changeNoteInput.value.trim() || undefined,
          previewImageDataUrl,
        });

        setPublishedItemId(campaign.campaignId, result.item.steamPublishedFileId);
        onPublished(result.item.steamPublishedFileId);

        statusEl.style.color = '#88dd99';
        statusEl.textContent = result.needsToAcceptAgreement
          ? t('workshop.statusPublishedNeedsAgreement', { id: result.item.steamPublishedFileId })
          : t('workshop.statusPublished', { id: result.item.steamPublishedFileId });
        submitBtn.textContent = t('workshop.updateAction');
        setBusy(false);
      } catch (e) {
        showError(t('workshop.errorPublishFailed', { error: e instanceof Error ? e.message : String(e) }));
        setBusy(false);
      }
    })();
  });

  buttonRow.append(cancelBtn, submitBtn);
  panel.appendChild(buttonRow);
  overlay.appendChild(panel);
  container.appendChild(overlay);
  titleInput.focus();
}
