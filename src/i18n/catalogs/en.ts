/**
 * English catalog — the AUTHORITATIVE source of truth.
 *
 * Every translation key in the game exists here, and `TranslationKey` is derived
 * from this object. Adding a key here immediately makes it available (and
 * type-checked) everywhere; other locales fall back to this catalog per key.
 *
 * Editing guidance for translators / contributors:
 *  - Keys are dotted, grouped by screen: `mainMenu.*`, `pause.*`, `hud.*`, ...
 *  - `{placeholder}` markers must be preserved verbatim in translations.
 *  - Entries written as `{ one: '...', other: '...' }` are plural entries and
 *    are selected by the `count` parameter.
 *  - NEVER put internal ids, asset paths, enum values, save-schema identifiers,
 *    debug-only identifiers, or player-authored campaign text in here.
 */

import type { CatalogEntry } from '../types';

export const EN_CATALOG = {
  // ── Common ────────────────────────────────────────────────────────────────
  'common.back': 'Back',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.on': 'On',
  'common.off': 'Off',
  'common.unknown': 'Unknown',
  'common.delete': 'DELETE',
  'common.deleteEmphatic': 'DELETE!',
  'common.percent': '{value}%',

  // ── Main menu ─────────────────────────────────────────────────────────────
  'mainMenu.title': 'DustWeaver',
  'mainMenu.pressAnyKey': 'Press any key',
  'mainMenu.play': 'Play',
  'mainMenu.settings': 'Settings',
  'mainMenu.customCampaigns': 'Custom Campaigns',
  'mainMenu.exit': 'Exit',
  'mainMenu.build': 'Build {number}',
  'mainMenu.discord': 'Discord',
  'mainMenu.discordAria': 'Join the DustWeaver Discord server',

  // ── Save slots ────────────────────────────────────────────────────────────
  'saveSlots.heading': 'Select Save Slot',
  'saveSlots.slotLabel': 'Save Slot {number}',
  'saveSlots.empty': '— Empty —',
  'saveSlots.playTime': 'Play Time: {value}',
  'saveSlots.lastPlayed': 'Last Played: {value}',
  'saveSlots.assistBadge': 'Assist',
  'saveSlots.deleteAria': 'Delete Save Slot {number}',
  'saveSlots.deletePrompt': 'DELETE Save File?',
  'saveSlots.deleteConfirm': 'Are you sure?',
  'saveSlots.playTimeUnderMinute': '< 1m',
  'saveSlots.playTimeHoursMinutes': '{hours}h {minutes}m',
  'saveSlots.playTimeHours': '{hours}h',
  'saveSlots.playTimeMinutes': '{minutes}m',

  // ── Assist mode dialog ────────────────────────────────────────────────────
  'assistMode.title': 'Assist Mode',
  'assistMode.description':
    'Assist Mode allows unlimited air grapples — you can grapple repeatedly without '
    + 'touching the ground first. This cannot be turned off for this save.',
  'assistMode.note': 'Saves with Assist Mode enabled are labelled "Assist".',
  'assistMode.normal': 'Normal Mode',
  'assistMode.enable': 'Enable Assist Mode',

  // ── Custom campaigns (campaign selection) ─────────────────────────────────
  // Campaign titles, creator names, and descriptions are player-authored and are
  // never translated — only the surrounding chrome is.
  'customCampaigns.heading': 'Custom Campaigns',
  'customCampaigns.createNew': '✦ Create New Campaign',
  'customCampaigns.import': '📥 Import Campaign (.dwcampaign.json)',
  'customCampaigns.loading': 'Loading campaigns…',
  'customCampaigns.emptyTitle': 'No custom campaigns found.',
  'customCampaigns.emptyHint':
    'Add <code>.dwcampaign.json</code> files to <code>ASSETS/CAMPAIGNS/CUSTOM/</code> '
    + 'or import a campaign file above.',
  'customCampaigns.badgeBundledFolder': 'Built-in folder',
  'customCampaigns.badgePacked': 'Packed campaign',
  'customCampaigns.badgeImported': 'Imported',
  'customCampaigns.byCreator': 'By {creator}',
  'customCampaigns.unknownCreator': 'Unknown',
  'customCampaigns.initialRoomAlt': 'Initial room preview',
  'customCampaigns.play': '▶ Play',
  'customCampaigns.edit': '🛠 Edit',
  'customCampaigns.editLoading': 'Loading…',
  'customCampaigns.export': '📤 Export JSON',
  'customCampaigns.exporting': 'Exporting…',
  'customCampaigns.delete': '🗑 Delete',
  'customCampaigns.deleteConfirm': 'Delete imported campaign "{title}"?',
  'customCampaigns.invalidFile': 'Invalid campaign file:\n{errors}',
  'customCampaigns.loadForEditFailed': 'Failed to load campaign for editing: {error}',
  'customCampaigns.exportFailed': 'Failed to export campaign: {error}',
  'customCampaigns.listFailed': 'Could not list campaigns: {error}',
  'customCampaigns.browseWorkshop': '🌐 Browse Workshop',

  // ── Steam Workshop browser ─────────────────────────────────────────────────
  'workshop.heading': 'Steam Workshop',
  'workshop.publish': 'Publish to Workshop',
  'workshop.empty': 'No subscribed items yet.',
  'workshop.play': 'Play',
  'workshop.subscribe': 'Subscribe',
  'workshop.unsubscribe': 'Unsubscribe',
  'workshop.playFailed': 'Failed to play "{title}": {error}',
  'workshop.download': 'Download',
  'workshop.update': 'Update',
  'workshop.addByIdPlaceholder': 'Workshop item ID (from the item’s Steam page URL)',
  'workshop.statusInstalled': 'Installed',
  'workshop.statusNotInstalled': 'Not downloaded',
  'workshop.statusDownloading': 'Downloading…',
  'workshop.statusUpdateAvailable': 'Update available',

  // ── Workshop publish dialog ───────────────────────────────────────────────
  'workshop.publishHeading': 'Publish Campaign to Steam Workshop',
  'workshop.fieldTitle': 'Title',
  'workshop.fieldDescription': 'Description',
  'workshop.fieldTags': 'Tags',
  'workshop.fieldTagsPlaceholder': 'comma-separated, e.g. puzzle, short, hard',
  'workshop.fieldVisibility': 'Visibility',
  'workshop.fieldPreview': 'Preview image (PNG or JPEG, max 1 MB)',
  'workshop.fieldItemId': 'Existing item ID (leave blank to create a new item)',
  'workshop.fieldItemIdPlaceholder': 'e.g. 3012345678',
  'workshop.fieldChangeNote': 'Change note',
  'workshop.visibilityPublic': 'Public',
  'workshop.visibilityFriends': 'Friends only',
  'workshop.visibilityPrivate': 'Private',
  'workshop.visibilityUnlisted': 'Unlisted',
  'workshop.publishAction': 'Publish',
  'workshop.updateAction': 'Update item',
  'workshop.statusPreparing': 'Preparing package…',
  'workshop.statusUploading': 'Uploading to Steam…',
  'workshop.statusPublished': 'Published successfully. Workshop item ID: {id}',
  'workshop.statusPublishedNeedsAgreement':
    'Uploaded as item {id}, but it stays hidden until you accept the Steam Workshop legal agreement on the item’s Workshop page.',
  'workshop.errorTitleRequired': 'A title is required.',
  'workshop.errorPreviewTooLarge': 'Preview image must be a PNG or JPEG under 1 MB.',
  'workshop.errorPublishFailed': 'Publish failed: {error}',

  // ── New-campaign dialog ───────────────────────────────────────────────────
  'newCampaign.title': 'Create New Campaign',
  'newCampaign.id': 'Campaign ID',
  'newCampaign.idHint': 'lowercase letters, numbers, _ and - only',
  'newCampaign.campaignTitle': 'Campaign Title',
  'newCampaign.creator': 'Creator',
  'newCampaign.description': 'Description',
  'newCampaign.initialRoomId': 'Initial Room ID',
  'newCampaign.zoneName': 'Zone Name',
  'newCampaign.roomWidth': 'Initial Room Width (blocks)',
  'newCampaign.roomHeight': 'Initial Room Height (blocks)',
  'newCampaign.create': 'Create & Open Editor',

  // ── Settings (main menu) ──────────────────────────────────────────────────
  'settings.title': 'Settings',
  'settings.tab.audio': 'Audio',
  'settings.tab.visual': 'Visual',
  'settings.tab.gameplay': 'Gameplay',
  'settings.tab.keybindings': 'Keybindings',
  'settings.tab.language': 'Language',
  'settings.audio.musicVolume': 'Music Volume',
  'settings.audio.music': 'Music',
  'settings.audio.sfxVolume': 'Sound Effects Volume',
  'settings.audio.sfx': 'Sound Effects',
  'settings.visual.quality': 'Quality',
  'settings.visual.qualityLow': 'Low',
  'settings.visual.qualityMed': 'Med',
  'settings.visual.qualityHigh': 'High',
  'settings.visual.resolution': 'Resolution',
  'settings.visual.misc': 'Misc',
  'settings.visual.spriteAtlases': 'Use sprite atlases (experimental)',
  'settings.visual.spriteAtlasesHardDisabled':
    'Currently hard-disabled internally while legacy room rendering remains active.',
  'settings.visual.spriteAtlasesHint':
    'Reload or re-enter the room after changing this for a clean test.',
  'settings.visual.offensiveDustOutline': 'Offensive Dust Outline: {state}',
  'settings.visual.momentumTrail': 'Momentum Combat Golden Trail: {state}',
  'settings.gameplay.edgeGlowOpacity': 'Grapple Surface Highlight Opacity',
  'settings.gameplay.highlightOpacity': 'Highlight Opacity',
  'settings.gameplay.influenceHighlightWidth': 'Influence Highlight Width',
  'settings.gameplay.highlightWidth': 'Highlight Width',
  'settings.gameplay.influenceCircleOpacity': 'Influence Circle Opacity',
  'settings.gameplay.circleOpacity': 'Circle Opacity',
  'settings.gameplay.controls': 'Controls',
  'settings.gameplay.doubleJumpToGrapple': 'Double-jump to grapple',
  'settings.gameplay.pixelSpeedometer': 'Pixel speedometer',
  'settings.gameplay.totalSpeed': 'Total speed',
  'settings.gameplay.horizontalSpeed': 'Horizontal speed',
  'settings.gameplay.verticalSpeed': 'Vertical speed',
  'settings.gameplay.speedGraph': 'Speed graph',
  'settings.gameplay.speedGraphOpacity': 'Speed Graph Opacity',
  'settings.gameplay.speedometerOnPlayer': 'Speedometer on player',
  'settings.gameplay.speedometerOnTop': 'Speedometer at top',
  'settings.gameplay.speedometerBoth': 'Speedometer on both',
  'settings.gameplay.speedrunTimer': 'Speedrun timer',
  'settings.gameplay.advancedWallJumps': 'Advanced Wall Jumps',
  'settings.gameplay.advancedWallJumpsTooltip':
    'When off (default), pressing jump next to a wall always wall-jumps, even with no '
    + 'directional input held. When on, a wall jump requires deliberate intent: '
    + 'wall-sliding, pressing away from the wall, or having been falling in the air for a moment.',

  // ── Language selector ─────────────────────────────────────────────────────
  'language.heading': 'Language',
  'language.description':
    'Changes apply immediately and are remembered the next time you play. '
    + 'Text without a translation falls back to English.',
  'language.selectAria': 'Select interface language',
  'language.systemDefault': 'System default ({name})',
  'language.coverage': '{translated} of {total} lines translated',

  // ── Pause menu ────────────────────────────────────────────────────────────
  'pause.title': 'PAUSED',
  'pause.resume': 'Resume',
  'pause.options': 'Options',
  'pause.debugOn': 'Debug On',
  'pause.debugOff': 'Debug Off',
  'pause.worldEditor': 'World Editor',
  'pause.exitToMainMenu': 'Exit to Main Menu',
  'pause.confirmExit': 'Confirm Exit?',
  'pause.tab.sound': 'Sound',
  'pause.tab.graphics': 'Graphics',
  'pause.tab.gameplay': 'Gameplay',
  'pause.sound.music': 'Music',
  'pause.sound.sfx': 'SFX',
  'pause.gameplay.momentumCombat': 'Momentum Combat',
  'pause.gameplay.airCurrentsDebug': 'Air Currents (debug)',
  'pause.gameplay.airCurrentsDebugTooltip':
    'Draws arrows over the room showing the live wind field created by player and enemy '
    + 'movement. Only visible while Debug mode is on.',
  'pause.gameplay.prewarmPanelDebug': 'Prewarm Panel (debug)',
  'pause.gameplay.prewarmPanelDebugTooltip':
    'Displays real-time render chunk prewarm statistics and background warming queue '
    + 'status. Only active while Debug mode is on.',
  'pause.graphics.worldView': 'World View',
  'pause.graphics.renderAdjacentRooms': 'RENDER ADJACENT ROOMS',
  'pause.graphics.cameraAlwaysCentered': 'CAMERA ALWAYS CENTERED',
  'pause.graphics.spriteAtlasesHardDisabled':
    'Hard-disabled internally while legacy rendering remains active.',
  'pause.graphics.spriteAtlasesHint': 'Reload or re-enter the room after changing this.',
  'pause.graphics.reachableEdgeGlowOpacity': 'Reachable Edge Glow Opacity',

  // ── Death screen ──────────────────────────────────────────────────────────
  'death.title': 'Dusts...',
  'death.returnToLastSave': 'Return to Last Save',
  'death.returnToMainMenu': 'Return to Main Menu',

  // ── Loading / errors ──────────────────────────────────────────────────────
  'loading.default': 'Loading...',
  'loading.zoneRooms': 'Loading zone {zone} rooms: {completed} / {total}',
  'loading.zoneAssets': 'Loading zone {zone} assets: {completed} / {total}',
  'loading.zoneEntrances': 'Warming zone {zone} entrances: {completed} / {total}',

  // ── HUD / gameplay prompts (canvas-rendered) ──────────────────────────────
  'hud.controlHintKeyboard':
    'A/D=walk  |  W/Space/↑=jump  |  Click=attack  |  Hold=block  |  '
    + 'Hold Left Click=grapple  |  ESC=menu',
  'hud.controlHintTouch':
    'L.thumb L/R=walk  |  L.thumb up=jump  |  2nd finger tap=attack  |  '
    + '2nd finger hold=block  |  TAP MENU to return',

  // ── Character select ──────────────────────────────────────────────────────
  'characterSelect.title': 'Select Character',
  // Display names only — the internal character ids are never translated.
  'characterSelect.name.knight': 'Knight',
  'characterSelect.name.demonFox': 'Demon Fox',
  'characterSelect.name.princess': 'Princess',
  'characterSelect.name.outcast': 'Outcast',
  'characterSelect.hint': '← A/D or Arrow Keys to select · Enter to confirm →',

  // ── Weave loadout ─────────────────────────────────────────────────────────
  'loadout.title': 'Weaver Loadout',
  'loadout.subtitle': 'Level {level}  |  Your dust collection.',
  'loadout.noDustUnlocked': 'No dust unlocked yet.',
  'loadout.back': '← Back',
  'loadout.enterBattle': '⚔ Enter Battle',

  // ── World map ─────────────────────────────────────────────────────────────
  'worldMap.title': 'Zone Map',
  'worldMap.subtitle': {
    one: 'Player Level {level}  |  {count} dust slot',
    other: 'Player Level {level}  |  {count} dust slots',
  },
  'worldMap.zone1': 'Zone 1 — The Tideworn Keep',
  'worldMap.zone2': 'Zone 2 — The Volcanic Depths',
  'worldMap.zone2LockedHint': '(Complete Zone 1 to unlock)',
  'worldMap.bossSuffix': '{name} — Boss Battle!',
  'worldMap.hint': 'Complete levels to unlock new ones',

  // ── Campaign editor ───────────────────────────────────────────────────────
  // Leading glyphs are part of the button design and are kept in translations.
  'editor.customCampaignTitle': '🛠 Custom Campaign Editor',
  'editor.zoneEditorTitle': '🛠 Zone Editor',
  'editor.autosaveWork': 'Autosave Work',
  'editor.test': 'Test',
  'editor.saveAndTest': '▶ Save & Test',
  'editor.save': '✔ Save',
  'editor.cancel': '✕ Cancel',
  'editor.confirmQuestion': 'Confirm?',
  'editor.devRoomChecks': 'Dev Room Checks',
  'editor.brushLabel': 'Brush:',
  'editor.edgeResizeTitle': 'Add / Remove Row or Column',
  'editor.saveChangesQuestion': 'Save Changes?',
  'editor.unexportedChanges': 'UNEXPORTED CHANGES! Are you sure you want to discard these?',
  'editor.discard': 'Discard',
  'editor.export': 'Export',
  'editor.yes': 'YES',
  'editor.no': 'NO',
} as const satisfies Record<string, CatalogEntry>;

/** Every valid translation key in the game. Derived — never hand-maintained. */
export type TranslationKey = keyof typeof EN_CATALOG;

/** Runtime list of all keys (used by catalog-parity tests). */
export const ALL_TRANSLATION_KEYS: readonly TranslationKey[] =
  Object.keys(EN_CATALOG) as TranslationKey[];
