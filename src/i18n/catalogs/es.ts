/**
 * Spanish catalog.
 *
 * Only keys that genuinely differ from English are listed. Anything absent here
 * falls back to the English catalog PER KEY at lookup time, so English strings
 * are never duplicated into this file as manual fallbacks.
 *
 * Keys that are intentionally identical in Spanish (proper nouns, pure symbol
 * formats) are declared in `ES_INTENTIONALLY_UNTRANSLATED` so the catalog-parity
 * test can distinguish "deliberately shared" from "forgotten".
 */

import type { CatalogEntry } from '../types';
import type { TranslationKey } from './en';

export const ES_CATALOG: Partial<Record<TranslationKey, CatalogEntry>> = {
  // Common
  'common.back': 'Atrás',
  'common.cancel': 'Cancelar',
  'common.confirm': 'Confirmar',
  'common.on': 'Sí',
  'common.off': 'No',
  'common.unknown': 'Desconocido',
  'common.delete': 'BORRAR',
  'common.deleteEmphatic': '¡BORRAR!',

  // Main menu
  'mainMenu.pressAnyKey': 'Pulsa cualquier tecla',
  'mainMenu.play': 'Jugar',
  'mainMenu.settings': 'Ajustes',
  'mainMenu.customCampaigns': 'Campañas personalizadas',
  'mainMenu.exit': 'Salir',
  'mainMenu.build': 'Compilación {number}',
  'mainMenu.discordAria': 'Únete al servidor de Discord de DustWeaver',

  // Save slots
  'saveSlots.heading': 'Selecciona una partida',
  'saveSlots.slotLabel': 'Partida {number}',
  'saveSlots.empty': '— Vacía —',
  'saveSlots.playTime': 'Tiempo jugado: {value}',
  'saveSlots.lastPlayed': 'Última vez: {value}',
  'saveSlots.assistBadge': 'Asistida',
  'saveSlots.deleteAria': 'Borrar la partida {number}',
  'saveSlots.deletePrompt': '¿BORRAR la partida guardada?',
  'saveSlots.deleteConfirm': '¿Estás seguro?',
  'saveSlots.playTimeUnderMinute': '< 1 min',
  'saveSlots.playTimeHoursMinutes': '{hours} h {minutes} min',
  'saveSlots.playTimeHours': '{hours} h',
  'saveSlots.playTimeMinutes': '{minutes} min',

  // Assist mode
  'assistMode.title': 'Modo asistido',
  'assistMode.description':
    'El modo asistido permite ganchos aéreos ilimitados: puedes engancharte una y otra vez '
    + 'sin tocar el suelo. No se puede desactivar en esta partida.',
  'assistMode.note': 'Las partidas con modo asistido se marcan como «Asistida».',
  'assistMode.normal': 'Modo normal',
  'assistMode.enable': 'Activar modo asistido',

  // Custom campaigns
  'customCampaigns.heading': 'Campañas personalizadas',
  'customCampaigns.createNew': '✦ Crear campaña nueva',
  'customCampaigns.import': '📥 Importar campaña (.dwcampaign.json)',
  'customCampaigns.loading': 'Cargando campañas…',
  'customCampaigns.emptyTitle': 'No se han encontrado campañas personalizadas.',
  'customCampaigns.emptyHint':
    'Añade archivos <code>.dwcampaign.json</code> a <code>ASSETS/CAMPAIGNS/CUSTOM/</code> '
    + 'o importa un archivo de campaña más arriba.',
  'customCampaigns.badgeBundledFolder': 'Carpeta incluida',
  'customCampaigns.badgePacked': 'Campaña empaquetada',
  'customCampaigns.badgeImported': 'Importada',
  'customCampaigns.byCreator': 'Por {creator}',
  'customCampaigns.unknownCreator': 'Desconocido',
  'customCampaigns.initialRoomAlt': 'Vista previa de la sala inicial',
  'customCampaigns.play': '▶ Jugar',
  'customCampaigns.edit': '🛠 Editar',
  'customCampaigns.editLoading': 'Cargando…',
  'customCampaigns.export': '📤 Exportar JSON',
  'customCampaigns.exporting': 'Exportando…',
  'customCampaigns.delete': '🗑 Borrar',
  'customCampaigns.deleteConfirm': '¿Borrar la campaña importada «{title}»?',
  'customCampaigns.invalidFile': 'Archivo de campaña no válido:\n{errors}',
  'customCampaigns.loadForEditFailed': 'No se pudo cargar la campaña para editarla: {error}',
  'customCampaigns.exportFailed': 'No se pudo exportar la campaña: {error}',
  'customCampaigns.listFailed': 'No se pudieron listar las campañas: {error}',
  'customCampaigns.browseWorkshop': '🌐 Explorar Workshop',

  // Steam Workshop browser
  'workshop.heading': 'Steam Workshop',
  'workshop.publish': 'Publicar en Workshop',
  'workshop.empty': 'Aún no hay elementos suscritos.',
  'workshop.play': 'Jugar',
  'workshop.subscribe': 'Suscribirse',
  'workshop.unsubscribe': 'Cancelar suscripción',

  // New-campaign dialog
  'newCampaign.title': 'Crear campaña nueva',
  'newCampaign.id': 'ID de la campaña',
  'newCampaign.idHint': 'solo minúsculas, números, _ y -',
  'newCampaign.campaignTitle': 'Título de la campaña',
  'newCampaign.creator': 'Autor',
  'newCampaign.description': 'Descripción',
  'newCampaign.initialRoomId': 'ID de la sala inicial',
  'newCampaign.zoneName': 'Nombre de la zona',
  'newCampaign.roomWidth': 'Ancho de la sala inicial (bloques)',
  'newCampaign.roomHeight': 'Alto de la sala inicial (bloques)',
  'newCampaign.create': 'Crear y abrir el editor',

  // Settings
  'settings.title': 'Ajustes',
  'settings.tab.audio': 'Audio',
  'settings.tab.visual': 'Vídeo',
  'settings.tab.gameplay': 'Juego',
  'settings.tab.keybindings': 'Controles',
  'settings.tab.language': 'Idioma',
  'settings.audio.musicVolume': 'Volumen de la música',
  'settings.audio.music': 'Música',
  'settings.audio.sfxVolume': 'Volumen de los efectos',
  'settings.audio.sfx': 'Efectos de sonido',
  'settings.visual.quality': 'Calidad',
  'settings.visual.qualityLow': 'Baja',
  'settings.visual.qualityMed': 'Media',
  'settings.visual.qualityHigh': 'Alta',
  'settings.visual.resolution': 'Resolución',
  'settings.visual.misc': 'Varios',
  'settings.visual.spriteAtlases': 'Usar atlas de sprites (experimental)',
  'settings.visual.spriteAtlasesHardDisabled':
    'Desactivado internamente mientras siga activo el renderizado de salas heredado.',
  'settings.visual.spriteAtlasesHint':
    'Recarga o vuelve a entrar en la sala tras cambiar esto para una prueba limpia.',
  'settings.visual.offensiveDustOutline': 'Contorno del polvo ofensivo: {state}',
  'settings.visual.momentumTrail': 'Estela dorada de combate por impulso: {state}',
  'settings.gameplay.edgeGlowOpacity': 'Opacidad del resalte de superficies de gancho',
  'settings.gameplay.highlightOpacity': 'Opacidad del resalte',
  'settings.gameplay.influenceHighlightWidth': 'Ancho del resalte de influencia',
  'settings.gameplay.highlightWidth': 'Ancho del resalte',
  'settings.gameplay.influenceCircleOpacity': 'Opacidad del círculo de influencia',
  'settings.gameplay.circleOpacity': 'Opacidad del círculo',
  'settings.gameplay.controls': 'Controles',
  'settings.gameplay.doubleJumpToGrapple': 'Doble salto para engancharse',
  'settings.gameplay.pixelSpeedometer': 'Velocímetro de píxeles',
  'settings.gameplay.totalSpeed': 'Velocidad total',
  'settings.gameplay.horizontalSpeed': 'Velocidad horizontal',
  'settings.gameplay.verticalSpeed': 'Velocidad vertical',
  'settings.gameplay.speedGraph': 'Gráfica de velocidad',
  'settings.gameplay.speedGraphOpacity': 'Opacidad de la gráfica de velocidad',
  'settings.gameplay.speedometerOnPlayer': 'Velocímetro sobre el personaje',
  'settings.gameplay.speedometerOnTop': 'Velocímetro arriba',
  'settings.gameplay.speedometerBoth': 'Velocímetro en ambos sitios',
  'settings.gameplay.speedrunTimer': 'Cronómetro de speedrun',
  'settings.gameplay.advancedWallJumps': 'Saltos de pared avanzados',
  'settings.gameplay.advancedWallJumpsTooltip':
    'Cuando está desactivado (por defecto), saltar junto a una pared siempre produce un salto '
    + 'de pared, incluso sin pulsar ninguna dirección. Cuando está activado, el salto de pared '
    + 'requiere intención: deslizarse por la pared, pulsar en dirección contraria o llevar un '
    + 'instante cayendo por el aire.',

  // Language selector
  'language.heading': 'Idioma',
  'language.description':
    'Los cambios se aplican al instante y se recuerdan la próxima vez que juegues. '
    + 'El texto sin traducir se muestra en inglés.',
  'language.selectAria': 'Selecciona el idioma de la interfaz',
  'language.systemDefault': 'Predeterminado del sistema ({name})',
  'language.coverage': '{translated} de {total} líneas traducidas',

  // Pause menu
  'pause.title': 'EN PAUSA',
  'pause.resume': 'Continuar',
  'pause.options': 'Opciones',
  'pause.debugOn': 'Depuración activada',
  'pause.debugOff': 'Depuración desactivada',
  'pause.worldEditor': 'Editor de mundos',
  'pause.exitToMainMenu': 'Salir al menú principal',
  'pause.confirmExit': '¿Confirmar salida?',
  'pause.tab.sound': 'Sonido',
  'pause.tab.graphics': 'Gráficos',
  'pause.tab.gameplay': 'Juego',
  'pause.sound.music': 'Música',
  'pause.sound.sfx': 'Efectos',
  'pause.gameplay.momentumCombat': 'Combate por impulso',
  'pause.gameplay.airCurrentsDebug': 'Corrientes de aire (depuración)',
  'pause.gameplay.airCurrentsDebugTooltip':
    'Dibuja flechas sobre la sala mostrando el campo de viento generado por el movimiento del '
    + 'jugador y los enemigos. Solo visible con el modo de depuración activado.',
  'pause.gameplay.prewarmPanelDebug': 'Panel de precalentado (depuración)',
  'pause.gameplay.prewarmPanelDebugTooltip':
    'Muestra estadísticas en tiempo real del precalentado de fragmentos de render y el estado '
    + 'de la cola de calentado en segundo plano. Solo activo con el modo de depuración.',
  'pause.graphics.worldView': 'Vista del mundo',
  'pause.graphics.renderAdjacentRooms': 'RENDERIZAR SALAS ADYACENTES',
  'pause.graphics.cameraAlwaysCentered': 'CÁMARA SIEMPRE CENTRADA',
  'pause.graphics.spriteAtlasesHardDisabled':
    'Desactivado internamente mientras siga activo el renderizado heredado.',
  'pause.graphics.spriteAtlasesHint': 'Recarga o vuelve a entrar en la sala tras cambiar esto.',
  'pause.graphics.reachableEdgeGlowOpacity': 'Opacidad del brillo de bordes alcanzables',

  // Death screen
  'death.title': 'Polvo...',
  'death.returnToLastSave': 'Volver a la última partida',
  'death.returnToMainMenu': 'Volver al menú principal',

  // Loading / errors
  'loading.default': 'Cargando...',
  'loading.zoneProgress': 'Cargando zona {zone}: {built} / {total}',

  // HUD
  'hud.controlHintKeyboard':
    'A/D=andar  |  W/Espacio/↑=saltar  |  Clic=atacar  |  Mantener=bloquear  |  '
    + 'Mantener clic izq.=gancho  |  ESC=menú',
  'hud.controlHintTouch':
    'Pulgar izq. I/D=andar  |  Pulgar izq. arriba=saltar  |  2.º dedo toque=atacar  |  '
    + '2.º dedo mantener=bloquear  |  TOCA MENÚ para volver',

  // Character select
  'characterSelect.title': 'Selecciona personaje',
  'characterSelect.name.knight': 'Caballero',
  'characterSelect.name.demonFox': 'Zorro demonio',
  'characterSelect.name.princess': 'Princesa',
  'characterSelect.name.outcast': 'Marginado',
  'characterSelect.hint': '← A/D o flechas para elegir · Intro para confirmar →',

  // Weave loadout
  'loadout.title': 'Equipo del Tejedor',
  'loadout.subtitle': 'Nivel {level}  |  Tu colección de polvo.',
  'loadout.noDustUnlocked': 'Aún no has desbloqueado ningún polvo.',
  'loadout.back': '← Atrás',
  'loadout.enterBattle': '⚔ Entrar en combate',

  // World map
  'worldMap.title': 'Mapa de zonas',
  'worldMap.subtitle': {
    one: 'Nivel de jugador {level}  |  {count} ranura de polvo',
    other: 'Nivel de jugador {level}  |  {count} ranuras de polvo',
  },
  'worldMap.zone1': 'Zona 1 — La Fortaleza Roída por la Marea',
  'worldMap.zone2': 'Zona 2 — Las Profundidades Volcánicas',
  'worldMap.zone2LockedHint': '(Completa la zona 1 para desbloquearla)',
  'worldMap.bossSuffix': '{name} — ¡Combate de jefe!',
  'worldMap.hint': 'Completa niveles para desbloquear otros nuevos',

  // Editor
  'editor.customCampaignTitle': '🛠 Editor de campañas personalizadas',
  'editor.zoneEditorTitle': '🛠 Editor de zonas',
  'editor.saveAndTest': '▶ Guardar y probar',
  'editor.save': '✔ Guardar',
  'editor.cancel': '✕ Cancelar',
  'editor.confirmQuestion': '¿Confirmar?',
  'editor.devRoomChecks': 'Comprobaciones de sala',
  'editor.brushLabel': 'Pincel:',
  'editor.edgeResizeTitle': 'Añadir / quitar fila o columna',
  'editor.saveChangesQuestion': '¿Guardar los cambios?',
  'editor.yes': 'SÍ',
  'editor.no': 'NO',
};

/**
 * Keys deliberately left to the English catalog because Spanish uses the same
 * text (proper nouns and pure symbol formats). The parity test treats these as
 * covered; anything else missing is a real gap.
 */
export const ES_INTENTIONALLY_UNTRANSLATED: readonly TranslationKey[] = [
  'mainMenu.title',
  'mainMenu.discord',
  'common.percent',
];
