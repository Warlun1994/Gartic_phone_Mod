// ==UserScript==
// @name Gartic Phone UI Layout Editor
// @namespace https://garticphone.com/
// @version      2.19.0
// @description  Редактор расположения интерфейса Gartic Phone: перемещение, размер, скрытие, сохранение и сброс элементов; визуальный режим редактирования мышью; переименование элементов; локальные сетапы; цветовой круг; окно референса \(картинка по ссылке или файлу, масштаб, прозрачность\); PNG поверх холста; свои шрифты и CSS; тёмная тема панели; простой и расширенный режимы; блок «Кисть» \(курсор кисти, тонкая кисть, нажим пера, передача нажима по сети\); список игроков с метками \(нов/блюр/ожидание\) и визуальным блюром рисунков\. По умолчанию не затрагивает логику игры\.
// EN: @description  Gartic Phone UI layout editor: move, resize, hide, save and reset elements; visual mouse editing mode; element renaming; local setups; color wheel; reference window (image by URL or file, zoom, opacity); PNG over the canvas; custom fonts and CSS; dark panel theme; simple and advanced modes; Brush block (brush cursor, thin brush, pen pressure, pressure over the network); player list with marks (new/blur/waiting) and visual blur of drawings. Does not touch game logic by default.
// @match https://garticphone.com/*
// @run-at document-start
// @grant GM_getValue
// @grant GM_setValue
// @grant GM_xmlhttpRequest
// @grant unsafeWindow
// @connect *
// @connect нужен «*»: референс грузится по ЛЮБОЙ ссылке, которую вводит пользователь
// EN: @connect needs "*": the reference is loaded from ANY URL the user enters
// ==/UserScript==
//
(function () {
    'use strict';

    // =====================================================
    // Конфигурация
    // Configuration
    // =====================================================
    const STORE_KEY = 'gpUiLayoutEditor.v1';

    const ELEMENTS = {
        colors: { name: 'Цветовая панель', selector: '.draw > .colors' },
        tools:  { name: 'Панель инструментов', selector: '.draw > .tools' },
        center: { name: 'Центральная область', selector: '.draw > .center' },
        book:   { name: 'Книга', selector: '.draw .book' },
        header: { name: 'Верхняя панель', selector: '.draw .header' },
        canvas: { name: 'Холст', selector: '.draw .core' },
        timer:  { name: 'Таймер', selector: '.draw > .time' },
        round:  { name: 'Счётчик раунда', selector: '.draw > .step' },
        bottom: { name: 'Нижняя панель', selector: '.draw .bottom' },
        done:   { name: 'Кнопка Готово', selector: '.draw .content-button' },
        // PNG поверх холста (создаёт модуль «Внешний вид»). Двигается и масштабируется как остальные элементы.
        // PNG over the canvas (creates the "Appearance" module). Moves and scales like the other elements.
        bgoverlay: { name: '🖼 Рамка холста (PNG)', selector: '#gpue-bg-overlay' }
    };

    // Элементы, которые убираются полностью (не через редактор): рекламный блок
    // Elements removed completely (not via the editor): the ad block
    // <div class="side"><div id="garticphone-com_160x600"></div></div>.
    // Только CSS - DOM не трогаем, чтобы не сломать React/Next.js игры.
    // CSS only - the DOM is not touched, so the game's React/Next.js is not broken.
    const REMOVED_CSS = ['#__next > .side{display:none !important;}'];

    // Связанные псевдоэлементы: настройки элемента-ключа дублируются на них.
    // Related pseudo-elements: settings of the key element are duplicated onto them.
    // Синяя полоса с «ушками» - это .book::before, поэтому сама по себе за «Верхней панелью» не следует.
    // The blue strip with "ears" is .book::before, so by itself it does not follow the "Top panel".
    const LINKED_CSS = { header: ['.draw .book::before'] };

    const DEFAULT_STATE = { x: 0, y: 0, w: 100, h: 100, hidden: false };
    const RANGE = {
        pos:  { min: -2000, max: 2000, step: 1 },
        size: { min: 10, max: 500, step: 1 }
    };

    // =====================================================
    // Хранилище
    // Storage
    // =====================================================
    function readStore() {
        try {
            let raw = typeof GM_getValue === 'function'
                ? GM_getValue(STORE_KEY, null)
                : localStorage.getItem(STORE_KEY);
            if (!raw) return {};
            return typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch (e) {
            return {};
        }
    }

    // Возвращает true, если запись прошла; результат показывает индикатор автосохранения в панели.
    // Returns true if the write succeeded; the auto-save indicator in the panel shows the result.
    function writeStore(data) {
        try {
            const raw = JSON.stringify(data);
            if (typeof GM_setValue === 'function') GM_setValue(STORE_KEY, raw);
            else localStorage.setItem(STORE_KEY, raw);
            uiSaveDone('layout', true);
            return true;
        } catch (e) {
            uiSaveDone('layout', false);
            return false;
        }
    }

    const savedRaw = readStore();
    const saved = (savedRaw && typeof savedRaw === 'object' && !Array.isArray(savedRaw)) ? savedRaw : {};

    // Элементы, добавленные пользователем через режим редактирования.
    // Elements added by the user via the editing mode.
    // Данные из хранилища не доверяем: проверяем id, селектор и длину, иначе битое
    // We do not trust storage data: id, selector and length are checked, otherwise a broken
    // значение ломает querySelectorAll при старте.
    // value breaks querySelectorAll at startup.
    const savedCustom = (saved.custom && typeof saved.custom === 'object' && !Array.isArray(saved.custom)) ? saved.custom : {};
    let customCount = 0;
    for (const id of Object.keys(savedCustom)) {
        const c = savedCustom[id];
        if (customCount >= 200 || !/^custom_[a-z0-9]+$/i.test(id) ||
            !c || typeof c.selector !== 'string' || !c.selector || c.selector.length > 300) {
            delete savedCustom[id];
            continue;
        }
        try { document.querySelector(c.selector); } catch (e) { delete savedCustom[id]; continue; }
        const name = (typeof c.name === 'string' && c.name.trim() ? c.name.trim() : id).slice(0, 60);
        ELEMENTS[id] = { name, selector: c.selector, custom: true };
        savedCustom[id] = { name, selector: c.selector };
        customCount++;
    }

    // Положение/размер из хранилища тоже санируем: числа, диапазоны, boolean.
    // Position/size from storage is sanitized too: numbers, ranges, boolean.
    const safeElements = {};
    if (saved.elements && typeof saved.elements === 'object' && !Array.isArray(saved.elements)) {
        const num = (v, d, a, b) => { v = Number(v); return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d; };
        for (const k of Object.keys(saved.elements).slice(0, 1000)) {
            if (!ELEMENTS[k]) continue;
            const v = saved.elements[k];
            if (!v || typeof v !== 'object') continue;
            safeElements[k] = {
                x: Math.round(num(v.x, 0, RANGE.pos.min, RANGE.pos.max)),
                y: Math.round(num(v.y, 0, RANGE.pos.min, RANGE.pos.max)),
                w: num(v.w, 100, RANGE.size.min, RANGE.size.max),
                h: num(v.h, 100, RANGE.size.min, RANGE.size.max),
                hidden: !!v.hidden
            };
        }
    }

    const state = {
        elements: safeElements,
        panel: (saved.panel && typeof saved.panel === 'object' && Number.isFinite(Number(saved.panel.left)) && Number.isFinite(Number(saved.panel.top)))
            ? { left: Number(saved.panel.left), top: Number(saved.panel.top) } : null,
        custom: savedCustom,
        names: {},
        wheel: (saved.wheel && typeof saved.wheel === 'object' && Number.isFinite(Number(saved.wheel.left)) && Number.isFinite(Number(saved.wheel.top)))
            ? { left: Number(saved.wheel.left), top: Number(saved.wheel.top) } : null,
        ref: (saved.ref && typeof saved.ref === 'object' && !Array.isArray(saved.ref)) ? saved.ref : {},
        palette: Array.isArray(saved.palette) ? saved.palette.filter(c => typeof c === 'string' && /^#[0-9a-f]{6}$/.test(c)).slice(0, 256) : [],
        tab: ['layout', 'appearance', 'draw', 'ref', 'profiles'].includes(saved.tab) ? saved.tab : 'layout',
        presets: (saved.presets && typeof saved.presets === 'object' && !Array.isArray(saved.presets)) ? saved.presets : {},
        selected: saved.selected && ELEMENTS[saved.selected] ? saved.selected : Object.keys(ELEMENTS)[0],
        // режим интерфейса панели. В конфигурациях его нет - тогда простой.
        // panel UI mode. Missing from configs - then simple.
        uiMode: saved.uiMode === 'advanced' ? 'advanced' : 'simple'
    };

    // Режим редактирования мышью (всегда выключен при загрузке страницы)
    // Mouse editing mode (always off on page load)
    let editMode = false;

    // Названия: исходные запоминаем, переименованные накладываем поверх
    // Names: original ones are remembered, renamed ones are overlaid on top
    for (const k of Object.keys(ELEMENTS)) if (!ELEMENTS[k].custom) ELEMENTS[k].defName = ELEMENTS[k].name;
    const savedNames = (saved.names && typeof saved.names === 'object' && !Array.isArray(saved.names)) ? saved.names : {};
    for (const k of Object.keys(savedNames)) {
        const v = savedNames[k];
        if (ELEMENTS[k] && !ELEMENTS[k].custom && typeof v === 'string' && v.trim()) {
            ELEMENTS[k].name = v.trim().slice(0, 60);
            state.names[k] = ELEMENTS[k].name;
        }
    }

    let saveTimer = null;
    function scheduleSave() {
        clearTimeout(saveTimer);
        uiSavePending('layout');
        saveTimer = setTimeout(() => writeStore(state), 150);
    }

    // --- Индикатор автосохранения (только отображение; на сами записи не влияет) ----
    // --- Auto-save indicator (display only; does not affect the writes themselves) ----
    // source: 'layout' (этот файл), 'appearance', 'brush'. «Сохранено» показывается только после
    // source: 'layout' (this file), 'appearance', 'brush'. "Saved" is shown only after
    // фактической успешной записи и когда не осталось отложенных записей.
    // an actual successful write and when no pending writes remain.
    const SAVE_IND = { pending: new Set(), failed: false, el: null, text: null, timer: 0 };
    function uiSaveRender(st) {
        if (!SAVE_IND.el) return;
        SAVE_IND.el.dataset.st = st;
        SAVE_IND.text.textContent = st === 'pending' ? 'Сохранение…'
            : st === 'error' ? 'Ошибка сохранения'
            : st === 'ok' ? 'Сохранено' : 'Автосохранение';
        SAVE_IND.el.title = st === 'error'
            ? 'Хранилище браузера не приняло данные. Изменения действуют до перезагрузки страницы.'
            : 'Настройки сохраняются автоматически';
    }
    function uiSavePending(source) {
        SAVE_IND.pending.add(source);
        clearTimeout(SAVE_IND.timer);
        uiSaveRender('pending');
    }
    function uiSaveDone(source, ok) {
        SAVE_IND.pending.delete(source);
        if (!ok) SAVE_IND.failed = true;
        if (SAVE_IND.pending.size) return;
        const failed = SAVE_IND.failed;
        SAVE_IND.failed = false;
        uiSaveRender(failed ? 'error' : 'ok');
        clearTimeout(SAVE_IND.timer);
        if (!failed) SAVE_IND.timer = setTimeout(() => uiSaveRender('idle'), 2500);
    }

    function getEl(key) {
        if (!state.elements[key]) state.elements[key] = Object.assign({}, DEFAULT_STATE);
        return state.elements[key];
    }

    function isDefault(s) {
        return !s || (s.x === 0 && s.y === 0 && s.w === 100 && s.h === 100 && !s.hidden);
    }

    // Простой/расширенный режим меняет только СПИСОК элементов во вкладке «Раскладка»,
    // Simple/advanced mode changes only the ELEMENT LIST in the "Layout" tab,
    // а НЕ саму игру: в простом в списке видны только основные элементы (SIMPLE_KEEP),
    // not the game itself: in simple mode only the main elements are visible in the list (SIMPLE_KEEP),
    // остальные строки списка скрыты; в расширенном виден весь список. Элементы самой игры
    // the other list rows are hidden; in advanced mode the whole list is visible. The game's own elements
    // не скрываются (кроме явной галки «Скрыть элемент»).
    // are not hidden (except for the explicit "Hide element" checkbox).
    const SIMPLE_KEEP = new Set(['canvas', 'header', 'tools', 'colors', 'done', 'round', 'timer']);

    // =====================================================
    // Применение настроек (только CSS, без вмешательства в логику игры)
    // Applying settings (CSS only, without interfering with game logic)
    // =====================================================
    const STYLE_ID = 'gpue-layout-style';

    // Селектор вставляется в CSS-правило как есть, поэтому символы, способные
    // The selector is inserted into the CSS rule as is, so characters capable of
    // закрыть правило/открыть блок ( } { \ ), экранируются. Для корректных
    // closing the rule/opening a block ( } { \ ) are escaped. For valid
    // селекторов экранирование ничего не меняет; для «сконструированного»
    // selectors escaping changes nothing; for a "constructed"
    // значения из хранилища не даёт вырваться из правила.
    // value from storage it prevents breaking out of the rule.
    const cssSel = s => String(s).replace(/[\\{}]/g, '\\$&');

    function buildCss() {
        const rules = [];
        const extra = [];
        for (const key of Object.keys(ELEMENTS)) {
            const s = state.elements[key] || DEFAULT_STATE;
            if (isDefault(s)) continue;
            const sel = cssSel(ELEMENTS[key].selector);
            let decl = '';
            if (s.hidden) {
                // Скрытие НЕ через display:none: элемент остаётся в потоке вёрстки и занимает
                // Hiding is NOT via display:none: the element stays in the layout flow and keeps
                // прежнее место, поэтому соседи (flex/grid/контейнер) не сдвигаются и не растягиваются.
                // its former place, so neighbours (flex/grid/container) do not shift or stretch.
                decl += editMode
                    ? 'opacity:.25 !important;'
                    : 'opacity:0 !important;visibility:hidden !important;pointer-events:none !important;';
                // Потомки лишь наследуют скрытое состояние (visibility:inherit) - на случай, если у какого-то
                // Descendants merely inherit the hidden state (visibility:inherit) - in case some
                // ребёнка в стилях игры явно стоит visibility:visible. pointer-events на детях НЕ трогаем.
                // child has visibility:visible explicitly in the game styles. pointer-events on children is NOT touched.
                if (!editMode) extra.push(`${sel} *{visibility:inherit !important;}`);
            }
            const hideDecl = decl;
            if (s.x !== 0 || s.y !== 0 || s.w !== 100 || s.h !== 100) {
                decl += `transform:translate(${s.x}px,${s.y}px) scale(${s.w / 100},${s.h / 100}) !important;`;
                decl += 'transform-origin:0 0 !important;';
            }
            rules.push(`${sel}{${decl}}`);

            if (LINKED_CSS[key]) {
                // Для псевдоэлемента используем отдельные свойства translate/scale: они ДОБАВЛЯЮТСЯ к его
                // For the pseudo-element we use separate translate/scale properties: they are ADDED to its
                // собственному transform из стилей игры, а не заменяют его (как заменил бы transform:...).
                // own transform from the game styles rather than replacing it (as transform:... would).
                let pd = hideDecl;
                if (s.x !== 0 || s.y !== 0) pd += `translate:${s.x}px ${s.y}px !important;`;
                if (s.w !== 100 || s.h !== 100) {
                    pd += `scale:${s.w / 100} ${s.h / 100} !important;transform-origin:0 0 !important;`;
                }
                if (pd) rules.push(`${LINKED_CSS[key].join(',')}{${pd}}`);
            }
        }
        return REMOVED_CSS.concat(rules, extra).join('\n');
    }

    function applyLayout() {
        let style = document.getElementById(STYLE_ID);
        if (!style) {
            style = document.createElement('style');
            style.id = STYLE_ID;
            (document.head || document.documentElement).appendChild(style);
        }
        const css = buildCss();
        if (style.textContent !== css) style.textContent = css;
        refreshCoordFix();
    }

    // =====================================================
    // Вспомогательные функции для DOM
    // DOM helper functions
    // =====================================================
    function h(tag, props, children) {
        const el = document.createElement(tag);
        if (props) {
            for (const k of Object.keys(props)) {
                if (k === 'class') el.className = props[k];
                else if (k === 'text') el.textContent = props[k];
                else if (k.startsWith('on')) el.addEventListener(k.slice(2), props[k]);
                else el.setAttribute(k, props[k]);
            }
        }
        (children || []).forEach(c => el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
        return el;
    }

    function findVisible(selector) {
        let list;
        try { list = document.querySelectorAll(selector); } catch (e) { return null; }
        for (const el of list) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return el;
        }
        return null;
    }

    // =====================================================
    // язык интерфейса (RU/EN) — Lang
    // interface language (RU/EN) - Lang
    // Переключатель в заголовке окна ⚙ UI (кнопка RU/EN).
    // Toggle in the header of the ⚙ UI window (RU/EN button).
    // Перевод — словарь точных строк + правила для составных строк
    // Translation - a dictionary of exact strings + rules for composite strings
    // («Профиль «X»», «Увеличение холста ×2», …). Непокрытые
    // ("Profile "X"", "Canvas zoom ×2", ...). Uncovered
    // строки остаются на русском. Выбор сохраняется (gpUiLang.v1).
    // strings stay in Russian. The choice is persisted (gpUiLang.v1).
    // =====================================================
    const Lang = (() => {
        const KEY = 'gpUiLang.v1';
        let mode = 'ru';
        // селектор «наших» корней: переводим только элементы редактора
        // selector of "our" roots: only editor elements are translated
        const ROOT_SEL = '#gpue-panel,#gpue-btn,#gpue-wheel,#gpue-ref,#gpue-wheel-btn,#gpue-ref-btn,[id^="gpue-"],[class^="gpue-"]';
        const ATTRS = ['title', 'placeholder', 'aria-label'];
        // точный словарь RU -> EN (видимые строки интерфейса)
        // exact RU -> EN dictionary (visible UI strings)
        const D = {
            // - каркас панели --
            // - panel skeleton --
            'Редактор интерфейса': 'Interface Editor',
            'Режим интерфейса': 'Interface mode',
            'Простой': 'Simple', 'Расширенный': 'Advanced',
            'Только основные настройки': 'Basic settings only',
            'Все параметры: свои элементы, CSS, диагностика, технические настройки': 'All options: custom elements, CSS, diagnostics, technical settings',
            'Раскладка': 'Layout', 'Оформление': 'Appearance', 'Рисование': 'Drawing', 'Референс': 'Reference', 'Профили': 'Profiles',
            'Автосохранение': 'Autosave', 'Сохранение…': 'Saving…', 'Сохранено': 'Saved', 'Ошибка сохранения': 'Save error',
            'Настройки сохраняются автоматически': 'Settings are saved automatically',
            'Хранилище браузера не приняло данные. Изменения действуют до перезагрузки страницы.': 'Browser storage rejected the data. Changes last until the page is reloaded.',
            'Закрыть': 'Close', 'Свернуть': 'Collapse', 'Перетащите, чтобы переместить панель': 'Drag to move the panel',
            'Прозрачное окно редактора': 'Transparent editor window',
            'Прозрачное окно редактора (вкл/выкл)': 'Transparent editor window (on/off)',
            'Режим интерфейса: RU/EN — переключить язык интерфейса': 'Interface language: RU/EN — switch interface language',
            'Простой режим: в списке только основные элементы': 'Simple mode: list shows main elements only',
            'Расширенный режим: показаны все параметры': 'Advanced mode: all options shown',
            // - D-pad и ToolLayout --
            // - D-pad and ToolLayout --
            'Точный сдвиг стрелками': 'Precise nudge arrows',
            'Сдвинуть на 1 px вверх (удерживайте — повтор)': 'Nudge 1 px up (hold to repeat)',
            'Сдвинуть на 1 px вниз (удерживайте — повтор)': 'Nudge 1 px down (hold to repeat)',
            'Сдвинуть на 1 px влево (удерживайте — повтор)': 'Nudge 1 px left (hold to repeat)',
            'Сдвинуть на 1 px вправо (удерживайте — повтор)': 'Nudge 1 px right (hold to repeat)',
            'Кнопки инструментов (верхний ряд)': 'Tool buttons (top row)',
            'Расстояние между кнопками:': 'Button spacing:',
            'Своё…': 'Custom…',
            'Своё значение 0–40 px': 'Custom value 0–40 px',
            'Расстояние между кнопками инструментов (верхний ряд)': 'Spacing between tool buttons (top row)',
            'Одинаковый зазор между всеми кнопками верхнего ряда (🖼, 🎨, 👥, ⚙ UI). Скрытые кнопки зазор не создают. Применяется к обоим режимам и сохраняется.': 'Equal spacing between all top-row buttons (🖼, 🎨, 👥, ⚙ UI). Hidden buttons create no gap. Applies to both modes and is saved.',
            // - вкладка «Раскладка» --
            // - "Layout" tab --
            'Элементы интерфейса': 'Interface elements', 'Элемент': 'Element',
            'Скрыть элемент': 'Hide element', 'скрыт': 'hidden',
            'Положение и размер': 'Position & size', '✥ Положение и размер': '✥ Position & size',
            '🎯 Выбрать элемент': '🎯 Pick element',
            'Выбрать элемент кликом на странице': 'Pick an element by clicking on the page',
            'Вернуть выбранному элементу исходные положение, размер и видимость': 'Restore the selected element\u2019s original position, size and visibility',
            '↺ Сбросить элемент': '↺ Reset element', '↺ Сбросить всё': '↺ Reset all', '↺ Сбросить размер и положение': '↺ Reset size & position',
            '↺ Сбросить вид (Alt+0)': '↺ Reset view (Alt+0)', '↺ Сбросить кисть': '↺ Reset brush',
            'Вернёт исходные положение, размер и видимость всем элементам. Профили, свои элементы, названия и оформление не затрагиваются.': 'Restores original position, size and visibility for all elements. Profiles, custom elements, names and appearance are not affected.',
            'Сбросить все настройки раскладки?': 'Reset all layout settings?',
            'Изменённых элементов: ': 'Modified elements: ',
            'Место сохраняется, соседние элементы не сдвигаются': 'Keeps its place, neighbors don\u2019t shift',
            'Вернуть рамке положение и размер холста': 'Restore the frame to the canvas position and size',
            'Переименовать элемент': 'Rename element', '✎ Переименовать': '✎ Rename',
            'Убрать из списка': 'Remove from list', '🗑 Удалить': '🗑 Delete', 'Удалить': 'Delete',
            'свой': 'custom',
            // имена элементов
            // element names
            'Цветовая панель': 'Color panel', 'Панель инструментов': 'Tools panel', 'Центральная область': 'Center area',
            'Книга': 'Book', 'Верхняя панель': 'Top bar', 'Холст': 'Canvas', 'Таймер': 'Timer',
            'Счётчик раунда': 'Round counter', 'Нижняя панель': 'Bottom bar', 'Кнопка Готово': 'Done button',
            '🖼 Рамка холста (PNG)': '🖼 Canvas frame (PNG)', '🖼 Референс': '🖼 Reference',
            // - профили --
            // - profiles --
            'Профили раскладки': 'Layout profiles', 'Сохранённые профили': 'Saved profiles',
            'Сохранить как…': 'Save as…', 'Сохранить профиль как…': 'Save profile as…',
            'Применить выбранный профиль': 'Apply selected profile', 'Удалить выбранный профиль': 'Delete selected profile',
            'Удалить профиль?': 'Delete profile?', 'Удалить профиль ': 'Delete profile ',
            'Профиль «': 'Profile "', 'Сетап «': 'Preset "',
            'Сохранённых профилей пока нет.\nНажмите «Сохранить как…», чтобы сохранить текущую раскладку.': 'No saved profiles yet.\nClick "Save as…" to save the current layout.',
            'Референс недоступен.': 'Reference unavailable.',
            // - окно «Игроки» --
            // - "Players" window --
            'Список игроков лобби': 'Lobby player list', 'Игроки (': 'Players (',
            'Ожидание': 'Waiting', 'Пересканировать': 'Rescan',
            'Заблюрить рисунок': 'Blur the drawing', 'Снять блюр': 'Remove blur',
            '✕ — блюр рисунка': '✕ — blur the drawing',
            'Игроки не найдены.\nОткройте лобби — список подхватится автоматически.': 'No players found.\nOpen the lobby — the list fills automatically.',
            'Реальное время (сеть)': 'Real-time (network)',
            // окно «Игроки» как в студии, блюр вместо картинки --
            // "Players" window like in the studio, blur instead of the picture --
            '👥 Игроки': '👥 Players', 'нов': 'new', 'блюр': 'blur',
            'обновляется автоматически': 'updates automatically',
            'Всего игроков: ': 'Total players: ', '· ✕ — блюр/разблюр': '· ✕ — blur/unblur',
            'Список появится в лобби комнаты — сейчас на экране нет видимых игроков': 'The list appears in the room lobby — no visible players on screen right now',
            'Сейчас никого не видно — список появится в лобби или во время игры': 'Nobody visible right now — the list appears in the lobby or during the game',
            'Игроки — список игроков комнаты': 'Players — room player list',
            'Перетащите шапку, чтобы переместить окно': 'Drag the header to move the window', 'Закрыть окно': 'Close the window',
            // - перемещение холста (CanvasPan) --
            // - canvas panning (CanvasPan) --
            'Перемещение холста': 'Canvas panning', 'Перемещать холст при увеличении': 'Pan canvas when zoomed',
            'Кнопка': 'Button', 'Правая (ПКМ)': 'Right (RMB)', 'Средняя': 'Middle', 'Пробел + ЛКМ': 'Space + LMB',
            'ПКМ только для перемещения (игра рисует правой кнопкой)': 'RMB only for panning (the game also draws with RMB)',
            'Холст не уходит за границы окна': 'Keep canvas inside the window',
            'Что сдвигать': 'What to pan', 'Область холста': 'Canvas area', 'Только рисунок': 'Drawing only',
            'Холст не найден (откройте экран рисования)': 'Canvas not found (open the drawing screen)',
            ' (не увеличен)': ' (not zoomed)',
            'Вид холста сброшен': 'Canvas view reset',
            'Холст двигается, только пока одновременно удерживаются пробел и ЛКМ: отпустили любую — сдвиг сразу заканчивается. Работает только при увеличенном холсте (Ctrl+колесо). На время жеста нажатие до игры не доходит, поэтому линия не начнётся.':
                'The canvas moves only while Space and LMB are held together: release either one and the pan stops immediately. Works only when the canvas is zoomed (Ctrl+wheel). During the gesture the press never reaches the game, so no line is started.',
            'Удерживайте правую кнопку на увеличенном холсте и тяните. Игра рисует и правой кнопкой, поэтому, пока холст увеличен, правая кнопка на холсте только двигает вид и до игры не доходит.':
                'Hold the right button on the zoomed canvas and drag. The game draws with RMB too, so while the canvas is zoomed the right button only pans the view and never reaches the game.',
            'Удерживайте правую кнопку на холсте и тяните. Клик без движения работает как в игре. Если игра при этом тоже рисует (см. «Диагностика», п. 5), выберите «Пробел + ЛКМ».':
                'Hold the right button on the canvas and drag. A click without movement works as in the game. If the game also draws (see Diagnostics, item 5), choose "Space + LMB".',
            'Удерживайте среднюю кнопку на холсте и тяните. Клик без движения работает как в игре. Если игра при этом тоже рисует (см. «Диагностика», п. 5), выберите «Пробел + ЛКМ».':
                'Hold the middle button on the canvas and drag. A click without movement works as in the game. If the game also draws (see Diagnostics, item 5), choose "Space + LMB".',
            // - кисть --
            // - brush --
            'Кисть': 'Brush', 'Нажим кисти': 'Brush pressure', 'Включить нажим кисти': 'Enable brush pressure',
            'Запекать нажим в итоговый рисунок': 'Bake pressure into the final drawing',
            'Передавать нажим другим игрокам': 'Send pressure to other players',
            'Передавать нажим другим игрокам (экспериментально)': 'Send pressure to other players (experimental)',
            'Курсор кисти': 'Brush cursor', 'Цвет': 'Color', 'Толщина': 'Thickness', 'Прозрачность': 'Opacity',
            'Тестовое поле для пера': 'Pen test area', 'Нажим сейчас': 'Current pressure',
            // - общие кнопки/действия --
            // - common buttons/actions --
            '💾 Сохранить': '💾 Save', '⬆ Импорт': '⬆ Import', '⬇ Экспорт': '⬇ Export', '⬆ Импортировать': '⬆ Import', '⬇ Экспортировать': '⬇ Export',
            'Загрузить': 'Load', 'Очистить поле': 'Clear field', 'Загрузить по ссылке (Enter)': 'Load by URL (Enter)',
            'Ссылка на изображение': 'Image URL', 'Прозрачность референса': 'Reference opacity',
            '🎨 Цветовой круг': '🎨 Color wheel', 'Цветовой круг': 'Color wheel',
            '🖱 Режим редактирования': '🖱 Edit mode', 'Режим редактирования': 'Edit mode',
            'Формат экспорта': 'Export format', 'Другой…': 'Other…', 'не выбрано': 'not selected', 'Не найден': 'Not found',
            'Как в игре': 'As in game', 'Вписать': 'Fit', 'Приблизить': 'Zoom in', 'Отдалить': 'Zoom out',
            'Масштаб холста': 'Canvas scale',
            "Отменить": "Cancel",
            "Отмена": "Cancel",
            "Подтверждение": "Confirmation",
            "изменён": "changed",
            "Найден": "Found",
            "Ошибка проверки": "Check error",
            "совпадений на странице: ": "matches on page: ",
            "есть на текущем экране": "is on the current screen",
            "появится на экране, где он есть": "will appear on the screen where it is present",
            "селектор не удалось проверить": "the selector could not be checked",
            "Настроено элементов: ": "Configured elements: ",
            "Применить профиль «": "Apply profile «",
            "Удалить профиль": "Delete profile",
            "UI Editor — редактор интерфейса": "UI Editor — interface editor",
            "Сдвиг по горизонтали": "Horizontal offset",
            "Сдвиг по вертикали": "Vertical offset",
            "Ширина": "Width",
            "Высота": "Height",
            "Больше на": "More by",
            "Размер холста меняет только картинку: координаты мыши и пера для игры корректируются автоматически.": "The canvas size changes only the picture: mouse and pen coordinates for the game are adjusted automatically.",
            "Сбросить все настройки": "Reset all settings",
            "Положение, размер и скрытие всех элементов": "Position, size and visibility of all elements",
            "Язык интерфейса": "Interface language",
            "Настроить на экране": "Set up on screen",
            "Кликните по элементу игры, чтобы выбрать его, и тяните мышью. Маркеры по краям меняют размер. Shift+клик - точный элемент под курсором. Esc - выйти.": "Click a game element to select it and drag with the mouse. Edge markers change the size. Shift+click - the exact element under the cursor. Esc - exit.",
            "⬆ Родитель": "⬆ Parent",
            "Выбрать родительский элемент": "Select the parent element",
            "Сохранить текущую раскладку как профиль": "Save the current layout as a profile",
            "Сохранить текущую раскладку в JSON-файл": "Save the current layout to a JSON file",
            "Загрузить раскладку из JSON-файла": "Load a layout from a JSON file",
            "● есть на экране": "● is on screen",
            "Кнопки инструментов": "Tool buttons",
            "Опасная зона": "Danger zone",
            "хранятся в браузере": "are stored in the browser",
            "Файл": "File",
            "JSON-файл с положением, размером, скрытием, своими элементами и названиями. Формат совместим с версией 2.4.": "JSON file with position, size, visibility, custom elements and names. Format compatible with version 2.4.",
            "Оформление (тема, картинки, шрифты) сохраняется отдельно: «Оформление» → «Сетапы оформления».": "Appearance (theme, pictures, fonts) is saved separately: \"Appearance\" → \"Appearance presets\".",
            "[UI Layout Editor] кнопка прозрачности недоступна:": "[UI Layout Editor] the opacity button is unavailable:",
            "Элемент уже в исходном состоянии": "The element is already in its original state",
            "Вернуть": "Revert",
            "Все элементы уже в исходном состоянии": "All elements are already in their original state",
            "Сбросить всё": "Reset everything",
            "Настройки раскладки сброшены": "Layout settings have been reset",
            "Новое название элемента:": "New element name:",
            "Новое название элемента. Оставьте поле пустым, чтобы вернуть исходное «": "New element name. Leave the field empty to restore the original «",
            "Название": "Name",
            "Введите название.": "Enter a name.",
            "Переименовать": "Rename",
            "Название сохранено": "Name saved",
            "Название изменено, но хранилище браузера не приняло данные": "The name was changed, but the browser storage did not accept the data",
            "— нет сохранённых сетапов —": "— no saved presets —",
            "Профиль хранит положение, размер и скрытие элементов, свои элементы и названия.": "A profile stores the position, size and visibility of elements, custom elements and names.",
            "Мой профиль": "My profile",
            "Название профиля": "Profile name",
            "Введите название профиля.": "Enter a profile name.",
            "Сохранить": "Save",
            "Перезаписать профиль?": "Overwrite the profile?",
            "Перезаписать": "Overwrite",
            "Не удалось записать профиль: хранилище браузера не приняло данные": "Failed to save the profile: the browser storage did not accept the data",
            "Выберите профиль в списке": "Select a profile in the list",
            "Профиль применён, но хранилище браузера не приняло данные": "The profile was applied, but the browser storage did not accept the data",
            "Профиль удалён до перезагрузки: хранилище браузера не приняло данные": "The profile is deleted until reload: the browser storage did not accept the data",
            "Файл gartic-ui-layout.json передан браузеру для скачивания": "The file gartic-ui-layout.json has been handed to the browser for download",
            "Не удалось прочитать файл: это не JSON.": "Failed to read the file: it is not JSON.",
            "Файл не похож на раскладку Gartic Phone UI Layout Editor.": "The file does not look like a Gartic Phone UI Layout Editor layout.",
            "Импортировать раскладку?": "Import the layout?",
            "Текущая раскладка (положение, размер, скрытие, свои элементы и названия) будет заменена содержимым файла «": "The current layout (position, size, visibility, custom elements and names) will be replaced with the contents of the file «",
            "файл": "file",
            "Заменить": "Replace",
            "Раскладка импортирована": "Layout imported",
            "Раскладка применена, но хранилище браузера не приняло данные": "The layout was applied, but the browser storage did not accept the data",
            "Не удалось прочитать файл.": "Failed to read the file.",
            "Готово - выйти из настройки": "Done - exit the setup",
            "Режим включён · Esc - выйти": "Mode on · Esc - exit",
            "Перетаскивайте элементы игры мышью": "Drag the game elements with the mouse",
            "Палитра пуста: нажмите ＋": "The palette is empty: press ＋",
            "Взять текущий цвет из игры": "Take the current color from the game",
            "Пипетка: взять цвет с экрана (рисунок, референс)": "Eyedropper: take a color from the screen (drawing, reference)",
            "Сохранить текущий цвет в палитру": "Save the current color to the palette",
            "Режим удаления: клик по цвету удаляет его (правый клик удаляет всегда)": "Delete mode: clicking a color removes it (right click always removes)",
            "Очистить всю палитру": "Clear the whole palette",
            "📥 Импорт": "📥 Import",
            "Загрузить палитру: JSON, GPL (GIMP/Krita), HEX/TXT": "Load a palette: JSON, GPL (GIMP/Krita), HEX/TXT",
            "📤 Экспорт": "📤 Export",
            "Сохранить палитру в файл": "Save the palette to a file",
            "Этот цвет уже в палитре": "This color is already in the palette",
            "Палитра заполнена (": "The palette is full (",
            "Добавлено: ": "Added: ",
            "Очистить всю палитру (": "Clear the whole palette (",
            "Палитра очищена": "The palette has been cleared",
            "В файле не найдено цветов": "No colors found in the file",
            "Импорт: добавлено ": "Import: added ",
            "Не удалось прочитать файл": "Failed to read the file",
            "Палитра пуста - нечего экспортировать": "The palette is empty - nothing to export",
            "Экспортировано цветов: ": "Exported colors: ",
            "Путь к файлу открыть нельзя: нажмите «📁 Файл», перетащите картинку в окно или вставьте через Ctrl+V": "A file path cannot be entered: press \"📁 File\", drag the picture into the window or paste it with Ctrl+V",
            "Загрузка…": "Loading…",
            "Не удалось загрузить картинку по ссылке": "Failed to load the picture from the link",
            "Это не изображение: ": "This is not an image: ",
            "из буфера обмена": "from the clipboard",
            "Не удалось открыть изображение": "Failed to open the image",
            "Вставьте ссылку, выберите файл,\\nперетащите картинку сюда\\nили нажмите Ctrl+V": "Enter a link, choose a file,\\ndrag the picture here\\nor press Ctrl+V",
            "Ссылка на изображение (https://…)": "Image link (https://…)",
            "📁 Файл": "📁 File",
            "Выбрать картинку на компьютере": "Choose a picture on the computer",
            "Вписать в окно (двойной клик по картинке)": "Fit into the window (double-click the picture)",
            "Двигать картинку: колесо - масштаб, перетаскивание - сдвиг. Пока включено, картинка ловит мышь и рисовать под ней нельзя": "Move the picture: wheel - zoom, dragging - shift. While enabled, the picture captures the mouse and drawing under it is impossible",
            "Убрать картинку": "Remove the picture",
            "Тяните, чтобы изменить размер окна": "Drag to resize the window",
            "Свернуть/развернуть поле ссылки и кнопки": "Collapse/expand the link field and buttons",
            "Окно с референсом": "Reference window",
            "Открыть окно референса": "Open the reference window",
            "Окно закрыто": "Window closed",
            "📁 Выбрать файл": "📁 Choose file",
            "📋 Вставить": "📋 Paste",
            "Вставить изображение из буфера обмена": "Paste an image from the clipboard",
            "Убрать картинку из окна референса": "Remove the picture from the reference window",
            "Вписать картинку в окно": "Fit the picture into the window",
            "✋ Двигать картинку": "✋ Move picture",
            "Пока включено, картинку можно двигать мышью и масштабировать колесом прямо в окне; рисовать под ней нельзя": "While enabled, the picture can be moved with the mouse and zoomed with the wheel right in the window; drawing under it is impossible",
            "Прозрачн.": "Opacity",
            "Картинка в окне референса не мешает рисовать: сквозь неё проходят клики. Картинку также можно перетащить в окно или вставить через Ctrl+V, наведя на него курсор.": "The picture in the reference window does not block drawing: clicks pass through it. The picture can also be dragged into the window or pasted with Ctrl+V while hovering over it.",
            "Скрыть окно референса": "Hide the reference window",
            "Окно открыто": "Window open",
            "картинка загружена": "picture loaded",
            "картинка не выбрана": "no picture selected",
            "Не удалось загрузить картинку": "Failed to load the picture",
            "Картинка загружена": "Picture loaded",
            "Наведите курсор на окно референса и нажмите Ctrl+V.": "Hover the cursor over the reference window and press Ctrl+V.",
            "Браузер не даёт читать буфер обмена по кнопке. ": "The browser does not allow reading the clipboard via a button. ",
            "В буфере обмена нет изображения. Ссылку вставьте в поле выше.": "There is no image in the clipboard. Paste the link into the field above.",
            "Нет доступа к буферу обмена. ": "No clipboard access. ",
            "Картинка убрана": "Picture removed",
            "Окно референса свёрнуто: разверните его кнопкой ▾ в заголовке окна.": "The reference window is collapsed: expand it with the ▾ button in the window header.",
            "Размер, положение и прозрачность окна сброшены": "The window size, position and opacity have been reset",
            "Окно референса": "Reference window",
            "Добавить изображение": "Add an image",
            "Масштаб": "Zoom",
            "Колесо мыши над картинкой масштабирует её, двойной клик - вписывает (когда включено «Двигать картинку»).": "The mouse wheel over the picture zooms it, double-click - fits it (when \"Move picture\" is enabled).",
            "Наложение": "Overlay",
            "Положение и размер окна": "Window position and size",
            "Растянуть": "Stretch",
            "Заполнить": "Fill",
            "Плиткой": "Tiled",
            "По центру": "Centered",
            "Цвета": "Colors",
            "Инструменты": "Tools",
            "Нижняя": "Bottom",
            "Раунд": "Round",
            "Верхняя": "Top",
            "Системный": "System",
            "Картинка не подходит: слишком большая или неверный формат.": "The picture is not suitable: too large or a wrong format.",
            "Слишком много картинок в хранилище: уберите ненужные замены.": "Too many pictures in storage: remove unneeded replacements.",
            "Заблокировано внешних ссылок: ": "Blocked external links: ",
            "Свой CSS не применяется: выключен переключатель «Включить пользовательский внешний вид».": "Custom CSS is not applied: the \"Enable custom appearance\" toggle is off.",
            "Это не изображение.": "This is not an image.",
            "GIF слишком большой (больше ~3,5 МБ). Выберите файл поменьше.": "The GIF is too large (over ~3.5 MB). Choose a smaller file.",
            "Файл слишком большой даже после сжатия. Выберите картинку поменьше.": "The file is too large even after compression. Choose a smaller picture.",
            "Не удалось сжать картинку.": "Failed to compress the picture.",
            "Не удалось открыть картинку.": "Failed to open the picture.",
            "Не удалось прочитать GIF.": "Failed to read the GIF.",
            "Шрифт": "Font",
            "Поддерживаются файлы .ttf, .otf, .woff и .woff2.": ".ttf, .otf, .woff and .woff2 files are supported.",
            "Этот браузер не поддерживает загрузку шрифтов (FontFace).": "This browser does not support font loading (FontFace).",
            "Файл шрифта больше 2 МБ.": "The font file is larger than 2 MB.",
            "Можно загрузить не больше ": "You can load no more than ",
            "Общий размер загруженных шрифтов превысит 8 МБ: удалите ненужные.": "The total size of the loaded fonts will exceed 8 MB: remove unneeded ones.",
            "Не удалось прочитать шрифт: файл повреждён или не является шрифтом.": "Failed to read the font: the file is damaged or is not a font.",
            "ошибка": "error",
            "Достигнут лимит замен (": "The replacement limit has been reached (",
            "Для этого элемента замена недоступна.": "A replacement is not available for this element.",
            "да": "yes",
            "нет": "no",
            "Браузер: ": "Browser: ",
            "Хранилище: настройки ": "Storage: settings ",
            "Поддержка: FontFace=": "Support: FontFace=",
            "Элементы раскладки (селектор -> найдено / видимых / размер первого):": "Layout elements (selector -> found / visible / size of the first):",
            "Canvas рисования (": "Drawing canvas (",
            "нет canvas": "no canvas",
            "Курсорный canvas: ": "Cursor canvas: ",
            "не найден": "not found",
            "Исправление координат (только чтение): ": "Coordinate correction (read only): ",
            "включено=": "enabled=",
            "недоступно": "unavailable",
            "Кисть: курсор=": "Brush: cursor=",
            "%, нажим=": "%, pressure=",
            "%, перехват рисования=": "%, drawing interception=",
            "Нажим по сегментам: штрихов=": "Pressure by segments: strokes=",
            "%, толщина сегментов ": "%, segment thickness ",
            "Вид: включён=": "Appearance: enabled=",
            "Нажим: чувствительность=": "Pressure: sensitivity=",
            "%, кривая=": "%, curve=",
            "%, сглаживание=": "%, smoothing=",
            "%, прозрачность=": "%, opacity=",
            "%, касание=": "%, touch=",
            "Запекание нажима: включено=": "Pressure baking: enabled=",
            "Нажим в сети: перехват=": "Pressure over the network: interception=",
            "НЕТ": "NO",
            "Перемещение холста: включено=": "Canvas panning: enabled=",
            "нет холста": "no canvas",
            "Исследование игры недоступно: ": "Game probe unavailable: ",
            "картинка": "picture",
            "Картинка «": "Picture «",
            "Не удалось загрузить картинку.": "Failed to load the picture.",
            "Default (как в игре)": "Default (as in the game)",
            "Например: Impact, sans-serif": "For example: Impact, sans-serif",
            "Загруженные": "Loaded",
            "Недопустимое название шрифта. Используйте буквы, цифры, пробелы, запятые и кавычки.": "Invalid font name. Use letters, digits, spaces, commas and quotes.",
            "📁 Загрузить шрифт": "📁 Load font",
            "Шрифт читается локально и на сервер не отправляется. Файл хранится в хранилище Tampermonkey этого браузера.": "The font is read locally and is not sent to the server. The file is stored in the Tampermonkey storage of this browser.",
            "Удалить шрифт": "Delete font",
            "Удалить шрифт?": "Delete the font?",
            "Шрифт «": "Font «",
            "Не удалось загрузить шрифт.": "Failed to load the font.",
            "Все кнопки": "All buttons",
            "Панель цветов": "Color panel",
            "Кнопка «Готово»": "\"Done\" button",
            "Выбранный элемент…": "Selected element…",
            "CSS-селектор выбранного элемента": "CSS selector of the selected element",
            "Не удалось получить простой селектор для этого элемента. Выберите другой элемент или введите селектор вручную (без запятых).": "Failed to get a simple selector for this element. Select another element or enter the selector manually (without commas).",
            "Стиль меняет только внешний вид: размеры кнопок, рамки (через тень) и обработчики не затрагиваются. Кнопки с цветным inline-фоном (образцы цветов) пропускаются.": "The style changes only the appearance: button sizes, frames (via shadow) and handlers are not affected. Buttons with a colored inline background (color swatches) are skipped.",
            "Окно редактора": "Editor window",
            "Непрозрачное при наведении": "Opaque on hover",
            "Касается только окон ⚙ UI и 🎨 круга и не зависит от остального внешнего вида. Быстрый переключатель - кнопка ◐ в заголовке окна.": "Applies only to the ⚙ UI and 🎨 wheel windows and does not depend on the rest of the appearance. Quick toggle - the ◐ button in the window header.",
            "/* Ваш CSS, например: */\\n.draw > .tools { border-radius: 16px; }": "/* Your CSS, for example: */\\n.draw > .tools { border-radius: 16px; }",
            "Кликните по любому элементу на странице: его селектор попадёт в CSS": "Click any element on the page: its selector will be added to the CSS",
            "Загрузить CSS из файла (заменит текст)": "Load CSS from a file (replace the text)",
            "Сохранить CSS в файл": "Save CSS to a file",
            "Очистить CSS": "Clear CSS",
            "Скруглить кнопки": "Round the buttons",
            "Тень у панелей": "Shadow on panels",
            "Шрифт панелей": "Panel font",
            "Спрятать элемент": "Hide the element",
            "/* уберите комментарий, чтобы скрыть: */\\n/* .draw .time { display: none; } */": "/* remove the comment to hide: */\\n/* .draw .time { display: none; } */",
            "Рамка холста (не меняет размеры)": "Canvas frame (does not change sizes)",
            "Окно редактора: фон": "Editor window: background",
            "📋 Вставить пример…": "📋 Insert example…",
            "Очистить свой CSS?": "Clear the custom CSS?",
            "Весь текст пользовательского CSS будет удалён.": "All custom CSS text will be deleted.",
            "Очистить": "Clear",
            "Заменить CSS?": "Replace the CSS?",
            "Текущий CSS будет заменён содержимым файла «": "The current CSS will be replaced with the contents of the file «",
            "Пользовательский CSS": "Custom CSS",
            "Включить свой CSS": "Enable custom CSS",
            "Добавлять !important (заменять стили игры)": "Add !important (override game styles)",
            "Работает для любых элементов страницы, в том числе окон редактора (#gpue-panel). Не задавайте холсту размеры, padding, border и transform: рисование сместится. Внешние ссылки блокируются, картинки берите из файла (data:). Если CSS спрятал редактор: Ctrl+Alt+Shift+0.": "Works for any elements of the page, including the editor windows (#gpue-panel). Do not set size, padding, border or transform on the canvas: drawing will shift. External links are blocked, take pictures from files (data:). If CSS hid the editor: Ctrl+Alt+Shift+0.",
            "Включить пользовательский внешний вид": "Enable custom appearance",
            "Нужен файл в формате PNG.": "A PNG file is required.",
            "Открыть вкладку «Раскладка» с рамкой и включить режим редактирования": "Open the \"Layout\" tab with the frame and enable the editing mode",
            "↺ На весь холст": "↺ Over the whole canvas",
            "Сначала загрузите PNG.": "Load a PNG first.",
            "Рамка холста": "Canvas frame",
            "PNG поверх холста": "PNG over the canvas",
            "Показывать": "Show",
            "Как вписать": "Fit mode",
            "Картинка лежит поверх холста, а мышь и перо проходят сквозь неё: рисовать можно как обычно. Реагирует она только в режиме редактирования - там её можно двигать и менять размер, как остальные элементы вкладки «Раскладка» (она есть в списке элементов).": "The picture lies over the canvas, and the mouse and pen pass through it: you can draw as usual. It reacts only in the editing mode - there it can be moved and resized like the other elements of the \"Layout\" tab (it is in the element list).",
            "Фон": "Background",
            "Тип": "Type",
            "Не менять": "Do not change",
            "Картинка или GIF": "Picture or GIF",
            "Картинка / GIF": "Picture / GIF",
            "Как показать": "How to show",
            "Меняет фон страницы игры. GIF должен быть не больше ~3,5 МБ. Если фон не виден, его перекрывают собственные слои игры.": "Changes the background of the game page. The GIF must be no larger than ~3.5 MB. If the background is not visible, it is covered by the game's own layers.",
            "авто": "auto",
            "Выбран элемент: ": "Selected element: ",
            "Выбрана рамка холста: её картинка настраивается в блоке «Рамка холста».": "The canvas frame is selected: its picture is configured in the \"Canvas frame\" block.",
            "Элемент не выбран: включите режим редактирования и кликните по элементу интерфейса.": "No element selected: enable the editing mode and click an interface element.",
            "🖱 Выйти из режима редактирования": "🖱 Exit the editing mode",
            "🖱 Режим редактирования (клик по элементу)": "🖱 Editing mode (click an element)",
            "Выбрать этот элемент": "Select this element",
            "Убрать замену": "Remove the replacement",
            "Изображение вместо элемента": "Image instead of the element",
            "Сначала выберите элемент: режим редактирования и клик по нему.": "First select an element: the editing mode and a click on it.",
            "Дополнительные параметры стиля": "Additional style parameters",
            "Панели": "Panels",
            "Применять к:": "Apply to:",
            "Прозрачность панелей игры": "Opacity of the game panels",
            "Размытие фона панелей": "Panel background blur",
            "Рамка": "Frame",
            "Цвет рамки": "Frame color",
            "Толщина рамки": "Frame thickness",
            "Кнопки": "Buttons",
            "Применить к": "Apply to",
            "Скругление кнопок": "Button rounding",
            "Тень": "Shadow",
            "Размер шрифта": "Font size",
            "Толщина шрифта": "Font weight",
            "Обычная": "Normal",
            "Полужирная": "Semi-bold",
            "Жирная": "Bold",
            "Текст": "Text",
            "Цвет текста": "Text color",
            "Жирный": "Bold",
            "Тень текста": "Text shadow",
            "Тема и цвета": "Theme and colors",
            "Тема": "Theme",
            "Цвет панелей": "Panel color",
            "Прозрачность панелей": "Panel opacity",
            "Цвет кнопок": "Button color",
            "Цвет текста кнопок": "Button text color",
            "Кнопка при наведении": "Button on hover",
            "Кнопка при нажатии": "Button when pressed",
            "Скругление": "Rounding",
            "Тени панелей": "Panel shadows",
            "Шрифты и текст": "Fonts and text",
            "Размер текста": "Text size",
            "Интерфейс: картинки вместо элементов": "Interface: pictures instead of elements",
            "Скрыть оригинал (останется на месте и кликабельным)": "Hide the original (it stays in place and clickable)",
            "Картинка (PNG, GIF и др.) накладывается поверх элемента и не перехватывает клики: сам элемент работает как раньше. Ширина и высота «авто» - размер элемента.": "A picture (PNG, GIF, etc.) is placed over the element and does not intercept clicks: the element itself works as before. Width and height \"auto\" - the size of the element.",
            "📂 Выбрать папку с картинками": "📂 Choose a folder with pictures",
            "📥 Загрузить": "📥 Load",
            "Применить выбранный сетап; картинки встанут по именам из папки": "Apply the selected preset; the pictures will be placed by names from the folder",
            "Сохранить вид, имена картинок, размеры и положения": "Save the appearance, picture names, sizes and positions",
            "Сохранить выбранный сетап в файл (без картинок)": "Save the selected preset to a file (without pictures)",
            "Добавить сетап из файла": "Add a preset from a file",
            "Сбросить внешний вид, рамку, фон, замены и свой CSS": "Reset the appearance, frame, background, replacements and custom CSS",
            "— выберите сетап —": "— choose a preset —",
            "— сетапов пока нет —": "— no presets yet —",
            "Папка: «": "Folder: «",
            "Папка не выбрана. Браузер не даёт вписать путь вручную: нажмите кнопку и выберите папку в окне.": "No folder chosen. The browser does not allow entering the path manually: press the button and choose the folder in the dialog.",
            "Найдено картинок: ": "Pictures found: ",
            "В выбранной папке нет картинок.": "There are no pictures in the chosen folder.",
            "Выберите сетап в списке.": "Select a preset in the list.",
            "Сетап не найден.": "Preset not found.",
            "Сетап загружен.": "Preset loaded.",
            "Картинок подставлено: ": "Pictures substituted: ",
            "Не найдено: ": "Not found: ",
            "Сетап загружен, но не все картинки найдены": "The preset is loaded, but not all pictures were found",
            "Сетап загружен": "Preset loaded",
            "Не удалось загрузить сетап.": "Failed to load the preset.",
            "Сохранить сетап оформления": "Save the appearance preset",
            "Сохраняются вид, имена картинок, их размеры и положения.": "The appearance, picture names, their sizes and positions are saved.",
            "Мой сетап": "My preset",
            "Название сетапа": "Preset name",
            "Введите название сетапа.": "Enter a preset name.",
            "Перезаписать сетап?": "Overwrite the preset?",
            "Не удалось сохранить: достигнут лимит сетапов (": "Failed to save: the preset limit has been reached (",
            "Сохранено: «": "Saved: «",
            "Удалить сетап?": "Delete the preset?",
            "Сетап удалён.": "Preset deleted.",
            "Выберите сетап в списке (или сначала сохраните текущий).": "Select a preset in the list (or save the current one first).",
            "Файл передан браузеру для скачивания. Картинок в нём нет: передавайте их вместе, в одной папке.": "The file has been handed to the browser for download. It contains no pictures: pass them along, in one folder.",
            "Файл сетапа передан браузеру для скачивания": "The preset file has been handed to the browser for download",
            "Файл не похож на сетап.": "The file does not look like a preset.",
            "Файл не похож на сетап оформления.": "The file does not look like an appearance preset.",
            "Импортировано сетапов: ": "Presets imported: ",
            "Сбросить всё оформление?": "Reset the whole appearance?",
            "Внешний вид, рамка, фон, замены элементов и свой CSS вернутся к исходным.\\n\\nШрифты и сохранённые сетапы останутся. Действие нельзя отменить.": "The appearance, frame, background, element replacements and custom CSS will return to the original.\\n\\nFonts and saved presets will remain. The action cannot be undone.",
            "Сбросить": "Reset",
            "Сброшено (шрифты и сохранённые сетапы остались).": "Reset (fonts and saved presets remain).",
            "Оформление сброшено": "Appearance reset",
            "Сетапы оформления": "Appearance presets",
            "Сетап": "Preset",
            "Сетап хранит вид, ИМЕНА картинок, их размеры и положения (сами картинки не входят). Чтобы загрузить чужой интерфейс: импортируйте файл сетапа, выберите папку с его картинками и нажмите «Загрузить» - картинки встанут на места по совпадающим именам.": "A preset stores the appearance, the NAMES of pictures, their sizes and positions (the pictures themselves are not included). To load someone else's interface: import the preset file, choose the folder with its pictures and press \"Load\" - the pictures will fall into place by matching names.",
            "🩺 Собрать отчёт": "🧪 Collect report",
            "📋 Копировать": "📋 Copy",
            "Не удалось собрать отчёт: ": "Failed to collect the report: ",
            "Отчёт скопирован": "Report copied",
            "Не удалось скопировать: выделите текст и нажмите Ctrl+C": "Failed to copy: select the text and press Ctrl+C",
            "🔬 Исследовать игру (2 мин)": "🔬 Probe the game (2 min)",
            "Подсчитать, как игра рисует, зумит и отправляет рисунок. Ничего не меняет.": "Count how the game draws, zooms and sends the drawing. Changes nothing.",
            "⏹ Стоп": "⏹ Stop",
            "🎯 Проверка точности": "🎯 Accuracy check",
            "Проведите линию на холсте: отчёт покажет, насколько линия игры отклоняется от курсора": "Draw a line on the canvas: the report will show how much the game's line deviates from the cursor",
            "Зонд недоступен.": "The probe is unavailable.",
            "Исследование началось: порисуйте мышью и пером, Ctrl+колесо, ПКМ, «Готово».": "The probe has started: draw with the mouse and pen, Ctrl+wheel, right-click, \"Done\".",
            "Проведите линию на холсте игры.": "Draw a line on the game canvas.",
            "Диагностика": "Diagnostics",
            "Отчёт показывает, какие элементы игры найдены и что доступно в браузере: пригодится, если что-то не работает. В нём только счётчики и размеры, без ваших картинок и настроек.": "The report shows which game elements were found and what is available in the browser: useful if something does not work. It contains only counters and sizes, without your pictures and settings.",
            "Пока выключено, игра выглядит как обычно. Окно редактора, кисть и раскладка от этого переключателя не зависят.": "While off, the game looks normal. The editor window, brush and layout do not depend on this toggle.",
            "Свой CSS, окно редактора, дополнительные параметры стиля и диагностика - в ": "Custom CSS, the editor window, additional style parameters and diagnostics are in ",
            "расширенном режиме": "the advanced mode",
            "CanvasRenderingContext2D недоступен": "CanvasRenderingContext2D unavailable",
            "Нужен PNG или SVG.": "A PNG or SVG is required.",
            "Файл больше 512 КБ.": "The file is larger than 512 KB.",
            "Курсор работает, но после перезагрузки страницы его нужно загрузить снова (файл больше 250 КБ).": "The cursor works, but after a page reload it must be loaded again (the file is larger than 250 KB).",
            "Кисть игры сейчас ": "The game brush is now ",
            "Наведите курсор на холст - покажу реальный размер кисти в пикселях.": "Hover the cursor over the canvas - I will show the real brush size in pixels.",
            "Толщина и нажим по умолчанию: игра рисует как обычно, перехват рисования выключен.": "Thickness and pressure are default: the game draws as usual, drawing interception is off.",
            "Не удалось включить перехват рисования": "Failed to enable drawing interception",
            "Перехват включён. Нарисуйте линию на холсте: если после неё здесь ничего не изменится, игра рисует иначе и тонкая кисть не сработает.": "Interception enabled. Draw a line on the canvas: if nothing changes here afterwards, the game draws differently and the thin brush will not work.",
            "Рисование на холсте замечено, но ширина не менялась (ластик или игра рисует без stroke). Перехвачено: 0.": "Drawing on the canvas was noticed, but the width did not change (an eraser or the game draws without stroke). Intercepted: 0.",
            "Перехват работает. Изменено вызовов рисования: ": "The interception works. Drawing calls modified: ",
            "Обычный (кружок игры)": "Normal (the game circle)",
            "Круг по размеру кисти": "Circle by brush size",
            "Круг с перекрестием": "Circle with crosshair",
            "Точка в центре": "Dot in the center",
            "Своя картинка (PNG/SVG)": "Custom picture (PNG/SVG)",
            "Контур": "Outline",
            "Выбрать картинку курсора на компьютере": "Choose a cursor picture on the computer",
            "Толщина кисти": "Brush thickness",
            "Нажим пера": "Pen pressure",
            "Сбросить кисть?": "Reset the brush?",
            "Курсор, толщина и нажим кисти вернутся к значениям по умолчанию.": "The cursor, brush thickness and pressure will return to the default values.",
            "Сброшено.": "Reset.",
            "Курсор - только картинка поверх страницы: клики и перо идут сквозь него, координаты рисования не меняются. Толщина меньше 100% делает линии тоньше минимума игры, нажим работает только с пером (у мыши нажима нет). Перехват рисования включается лишь когда значения не по умолчанию.": "The cursor is only a picture over the page: clicks and the pen go through it, drawing coordinates do not change. Thickness below 100% makes lines thinner than the game minimum, pressure works only with a pen (the mouse has no pressure). Drawing interception is enabled only when the values are not default.",
            "перо": "pen",
            "мышь": "mouse",
            "касание": "touch",
            "Проведите пером по тестовому полю или холсту": "Draw with the pen over the test field or the canvas",
            "Перо не передаёт силу нажима (всегда 0 или 0.5). Проверьте настройки драйвера планшета.": "The pen does not transmit the pressure force (always 0 or 0.5). Check the tablet driver settings.",
            "Видна только мышь. Если вы рисуете пером, драйвер передаёт его как мышь без нажима: включите Windows Ink (Wacom: «Use Windows Ink», Huion/XP-Pen: «Windows Ink»).": "Only the mouse is visible. If you draw with a pen, the driver transmits it as a mouse without pressure: enable Windows Ink (Wacom: \"Use Windows Ink\", Huion/XP-Pen: \"Windows Ink\").",
            "Нажим выключен.": "Pressure is off.",
            "Перехват рисования игры не включён": "The game drawing interception is not enabled",
            "Перехват включён, но игра ещё не рисовала. Нарисуйте линию на холсте игры.": "Interception is enabled, but the game has not drawn yet. Draw a line on the game canvas.",
            "Игра рисует заливкой (fill), а не линиями: толщину так изменить нельзя. Пришлите отчёт «Диагностики».": "The game draws with fills, not lines: the thickness cannot be changed this way. Send the \"Diagnostics\" report.",
            "Линий игры перехвачено: ": "Game lines intercepted: ",
            "Устройство": "Device",
            "Авто": "Auto",
            "Только перо": "Pen only",
            "Перо и касание": "Pen and touch",
            "Сила эффекта": "Effect strength",
            "Кривая": "Curve",
            "Линейная": "Linear",
            "Мягкая": "Soft",
            "Жёсткая": "Hard",
            "Своя (gamma)": "Custom (gamma)",
            "Как в 2.4": "As in 2.4",
            "Лёгкое касание": "Light touch",
            "Сильный нажим": "Strong press",
            "Сглаживание": "Smoothing",
            "Прозрачность от нажима": "Opacity from pressure",
            "Толщина линии меняется от «лёгкого касания» до «сильного нажима» (в % от кисти игры). Мышь рисует как обычно. Тестовое поле показывает, что приходит от пера; строка выше - меняет ли скрипт линии самой игры.": "The line thickness changes from a \"light touch\" to a \"strong press\" (in % of the game brush). The mouse draws as usual. The test field shows what comes from the pen; the line above - whether the script changes the lines of the game itself.",
            "прототип WebSocket страницы недоступен": "the page WebSocket prototype is unavailable",
            "не удалось заменить send: ": "failed to replace send: ",
            "Увеличение холста ×": "Canvas zoom ×",
            "Удерживайте ": "Hold down ",
            "правую": "the right",
            "среднюю": "the middle",
            "масштаб ": "zoom ",
            "Проверка точности: ошибка ≈ ": "Accuracy check: error ≈ ",
            "Игра не рисовала через moveTo/lineTo - точность этим способом проверить нельзя.": "The game did not draw via moveTo/lineTo - accuracy cannot be checked this way.",
            "Исследование игры (зонд, только чтение): ": "Game probe (read only): ",
            "идёт": "running",
            "остановлено": "stopped",
            "не запускалось - нажмите «Исследовать игру» и порисуйте": "not started - press \"Probe the game\" and draw",
            "1) Зум и панорама:": "1) Zoom and panning:",
            "нет (зум игры - через CSS, слои за ним следуют)": "no (the game zoom is via CSS, the layers follow it)",
            "игра обрабатывает Ctrl+колесо сама (свой зум)": "the game handles Ctrl+wheel itself (its own zoom)",
            "Ctrl+колесо игрой не отменялось": "Ctrl+wheel was not cancelled by the game",
            "зум не проверялся (покрутите Ctrl+колесо над холстом)": "zoom was not checked (spin Ctrl+wheel over the canvas)",
            "возможно через прокрутку контейнера": "possibly via container scrolling",
            "не обнаружено": "not detected",
            "2) Нажим в игре: штрихов пером ": "2) Pressure in the game: pen strokes ",
            "не проверено (нарисуйте пером)": "not checked (draw with the pen)",
            "похоже, игра сама меняет ширину по нажиму": "it seems the game changes the width by pressure itself",
            "игра ширину по нажиму не меняет": "the game does not change the width by pressure",
            "не проверено": "not checked",
            "2D-контекст": "2D context",
            "не 2D (WebGL или другой)": "not 2D (WebGL or other)",
            "недоступен (вероятно, OffscreenCanvas)": "unavailable (probably OffscreenCanvas)",
            "3) Рисование: ": "3) Drawing: ",
            "не проверено (нарисуйте линию)": "not checked (draw a line)",
            "сегментами: новый путь почти на каждое движение": "by segments: a new path for almost every movement",
            "одним или несколькими длинными путями": "with one or several long paths",
            "без moveTo/lineTo (штампы arc или drawImage/putImageData)": "without moveTo/lineTo (arc stamps or drawImage/putImageData)",
            "4) Отправка: toDataURL у холста ": "4) Sending: the canvas toDataURL ",
            "игра снимает картинку с холста - влитые слои могут попасть в рисунок": "the game takes a picture of the canvas - merged layers may get into the drawing",
            "данные уходят во время рисования, картинку с холста игра не снимала: вероятно, рисунок отправляется ШТРИХАМИ, и влитые в холст слои в отправку не попадут": "data is sent during drawing, the game did not take a picture of the canvas: probably the drawing is sent as STROKES, and the layers merged into the canvas will not be included in the sending",
            "не определено (порисуйте и нажмите «Готово», пока идёт исследование)": "undefined (draw and press \"Done\" while the probe is running)",
            "5) Правая кнопка: контекстных меню над холстом ": "5) Right button: context menus over the canvas ",
            "не проверено (нажмите и протяните ПКМ по холсту)": "not checked (press and drag with the right button over the canvas)",
            "игра РИСУЕТ правой кнопкой - для перемещения холста выберите среднюю кнопку или «Пробел + ЛКМ»": "the game DRAWS with the right button - for canvas panning choose the middle button or \"Space + LMB\"",
            "правой кнопкой игра не рисует": "the game does not draw with the right button",
            "Проверка точности: точек курсора ": "Accuracy check: cursor points ",
            "Проверка точности: ждёт линию на холсте": "Accuracy check: waiting for a line on the canvas",
            "Проверка точности: проведите линию на холсте игры…": "Accuracy check: draw a line on the game canvas…",
            "Исследование идёт ещё ": "The probe is still running ",
            "Исследование остановлено. Нажмите «Собрать отчёт».": "The probe is stopped. Press \"Collect report\".",
            "Зонд только считает вызовы и ничего не меняет.": "The probe only counts calls and changes nothing.",
            "не удалось заменить addEventListener: ": "failed to replace addEventListener: ",
            "Снять блюр с «": "Remove blur from «",
            "Заблюрить рисунки «": "Blur the drawings of «",
            ">Своё…</option>": ">Custom…</option>",
            "[UI Layout Editor] внешний вид недоступен:": "[UI Layout Editor] the appearance is unavailable:",
            "[UI Layout Editor] цветовой круг недоступен:": "[UI Layout Editor] the color wheel is unavailable:",
            "[UI Layout Editor] окно референса недоступно:": "[UI Layout Editor] the reference window is unavailable:",
            "[UI Layout Editor] окно «Игроки» недоступно:": "[UI Layout Editor] the \"Players\" window is unavailable:",
            "[UI Layout Editor] раскладка кнопок инструментов недоступна:": "[UI Layout Editor] the tool button layout is unavailable:",
            "[UI Layout Editor] настройки кисти недоступны:": "[UI Layout Editor] the brush settings are unavailable:",
            "[UI Layout Editor] нажим кисти недоступен:": "[UI Layout Editor] the brush pressure is unavailable:",
            "[UI Layout Editor] запекание нажима недоступно:": "[UI Layout Editor] pressure baking is unavailable:",
            "[UI Layout Editor] перемещение холста недоступно:": "[UI Layout Editor] canvas panning is unavailable:",
            "[UI Layout Editor] язык интерфейса недоступен:": "[UI Layout Editor] the interface language is unavailable:",
        };
        // правила для составных строк (регулярка + замена)
        // rules for composite strings (regex + replacement)
        const R = [
            [/^Профиль «([^»]+)» сохранён$/, m => 'Profile "' + m[1] + '" saved'],
            [/^Профиль «([^»]+)» загружен$/, m => 'Profile "' + m[1] + '" loaded'],
            [/^Профиль «([^»]+)» удалён$/, m => 'Profile "' + m[1] + '" deleted'],
            [/^Профиль «([^»]+)» сброшен$/, m => 'Profile "' + m[1] + '" reset'],
            [/^Профиль «([^»]+)» уже есть\. Заменить его текущей раскладкой\?$/, m => 'Profile "' + m[1] + '" already exists. Replace it with the current layout?'],
            [/^Профиль «([^»]+)» будет удалён\. Текущая раскладка не изменится\.$/, m => 'Profile "' + m[1] + '" will be deleted. The current layout will not change.'],
            [/^Применить профиль «([^»]+)»$/, m => 'Apply profile "' + m[1] + '"'],
            [/^Сетап «([^»]+)» сохранён$/, m => 'Preset "' + m[1] + '" saved'],
            [/^Сетап «([^»]+)» загружен$/, m => 'Preset "' + m[1] + '" loaded'],
            [/^Сетап «([^»]+)» удалён\.?$/, m => 'Preset "' + m[1] + '" deleted'],
            [/^Сетап «([^»]+)» уже есть\. Заменить его текущим оформлением\?$/, m => 'Preset "' + m[1] + '" already exists. Replace it with the current appearance?'],
            [/^Сетап «([^»]+)» будет удалён\. Текущее оформление не изменится\.$/, m => 'Preset "' + m[1] + '" will be deleted. The current appearance will not change.'],
            [/^Шрифт «([^»]+)» загружен и сохранён в браузере\.$/, m => 'Font "' + m[1] + '" loaded and saved in the browser.'],
            [/^Шрифт «([^»]+)» будет удалён из браузера\.$/, m => 'Font "' + m[1] + '" will be removed from the browser.'],
            [/^Картинка «([^»]+)» загружена$/, m => 'Picture "' + m[1] + '" loaded'],
            [/^(.+)»: блюр снят — рисунок снова виден$/, m => m[1] + '": blur removed - the drawing is visible again'],
            [/^(.+)»: рисунок размыт \(блюр\)$/, m => m[1] + '": the drawing is blurred (blur)'],
            [/^Настроено элементов: (\d+)$/, m => 'Configured elements: ' + m[1]],
            [/^Экспортировано цветов: (\d+)$/, m => 'Exported colors: ' + m[1]],
            [/^Импортировано сетапов: (\d+)$/, m => 'Presets imported: ' + m[1]],
            [/^Увеличение холста ×([\d.]+)/, m => 'Canvas zoom ×' + m[1]],
            [/^Сдвиг: (-?\d+), (-?\d+)$/, m => 'Offset: ' + m[1] + ', ' + m[2]],
            [/^Профиль «([^»]+)»/, m => 'Profile "' + m[1] + '"'],
            [/^Сетап «([^»]+)»/, m => 'Preset "' + m[1] + '"'],
            [/^Шрифт «([^»]+)»/, m => 'Font "' + m[1] + '"']
        ];
        function tr(s) {
            if (mode !== 'en' || typeof s !== 'string') return s;
            const v = D[s];
            if (v !== undefined) return v;
            for (const [re, fn] of R) { const m = s.match(re); if (m) return fn(m); }
            return s;
        }
        // реестр переведённого: [владелец (Text|Element), attr|null, оригинал]
        // registry of translated items: [owner (Text|Element), attr|null, original]
        const seen = new Set();
        const origText = new WeakMap();
        const origAttr = new WeakMap();
        const isOurNode = n => !!(n && ((n.parentElement || n.parentNode) && (n.parentElement || n.parentNode).closest && (n.parentElement || n.parentNode).closest(ROOT_SEL)));
        // Перевод с сохранением ведущих/замыкающих пробелов: раньше trim
        // Translation preserving leading/trailing spaces: trim used to
        // навсегда удалял отступы у текстовых узлов и в атрибутах.
        // permanently remove indentation from text nodes and attributes.
        function trKeepSpace(src) {
            const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(src);
            if (!m) return tr(src);
            return m[1] + tr(m[2]) + m[3];
        }
        function doText(tn) {
            if (!tn || tn.nodeType !== 3) return;
            const src = origText.has(tn) ? origText.get(tn) : tn.nodeValue;
            if (!src || !/[А-Яа-яЁё]/.test(src)) return;
            const out = trKeepSpace(src);
            if (out === src) { if (mode === 'en') origText.set(tn, src); return; }
            origText.set(tn, src);
            if (tn.nodeValue !== out) tn.nodeValue = out;
            seen.add(tn);
        }
        function doAttrs(el) {
            if (!el || el.nodeType !== 1) return;
            for (const a of ATTRS) {
                const cur = el.getAttribute(a);
                if (cur == null) continue;
                let store = origAttr.get(el);
                const src = store && store[a] !== undefined ? store[a] : cur;
                if (!src || !/[А-Яа-яЁё]/.test(src)) continue;
                if (!store) { store = {}; origAttr.set(el, store); }
                store[a] = src;
                const out = trKeepSpace(src);
                if (out !== cur) el.setAttribute(a, out);
                seen.add(el);
            }
        }
        function walk(root) {
            if (!root) return;
            if (root.nodeType === 1) doAttrs(root);
            const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
            let n = w.nextNode();
            while (n) {
                if (n.nodeType === 3) doText(n);
                else doAttrs(n);
                n = w.nextNode();
            }
        }
        function process(node) {
            if (!node) return;
            if (node.nodeType === 3) { if (isOurNode(node)) doText(node); return; }
            if (node.nodeType !== 1) return;
            if (node.closest && node.closest(ROOT_SEL)) walk(node);
            else if (node.id && (' ' + ROOT_SEL).includes('#' + node.id)) walk(node);
        }
        // повторное применение ко всему зарегистрированному (при смене языка)
        // re-apply to everything registered (on language switch)
        function reapply() {
            for (const it of seen) {
                if (it.nodeType === 3) {
                    if (!it.isConnected) { seen.delete(it); continue; }
                    const src = origText.get(it);
                    if (src === undefined) continue;
                    const out = trKeepSpace(src);
                    if (it.nodeValue !== out) it.nodeValue = out;
                } else {
                    if (!it.isConnected) { seen.delete(it); continue; }
                    const store = origAttr.get(it);
                    if (!store) continue;
                    for (const a of ATTRS) {
                        const src = store[a];
                        if (src === undefined) continue;
                        const out = trKeepSpace(src);
                        if (it.getAttribute(a) !== out) it.setAttribute(a, out);
                    }
                }
            }
            if (seen.size > 3000) for (const it of seen) if (!it.isConnected) seen.delete(it);
            document.documentElement.dataset.gpueLang = mode;
        }
        function applyAll() {
            document.querySelectorAll(ROOT_SEL).forEach(walk);
            reapply();
            const b = document.getElementById('gpue-lang');
            if (b) b.textContent = mode.toUpperCase();
        }
        function setMode(m) {
            mode = m === 'en' ? 'en' : 'ru';
            try {
                if (typeof GM_setValue === 'function') GM_setValue(KEY, mode);
                else localStorage.setItem(KEY, mode);
            } catch (e) { /* ignore */ }
            reapply();
            applyAll();
        }
        function toggle() { setMode(mode === 'en' ? 'ru' : 'en'); }
        function init() {
            try {
                const v = typeof GM_getValue === 'function' ? GM_getValue(KEY, null) : localStorage.getItem(KEY);
                mode = v === 'en' ? 'en' : 'ru';
            } catch (e) { mode = 'ru'; }
            document.documentElement.dataset.gpueLang = mode;
            // перевод всего, что уже построено (панель строится позже — MutationObserver доберёт)
            // translate everything already built (the panel is built later - the MutationObserver will catch it)
            applyAll();
            const mo = new MutationObserver(muts => {
                for (const m of muts) {
                    if (m.type === 'childList') m.addedNodes.forEach(process);
                }
            });
            mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
        }
        return { init, toggle, applyAll, mode: () => mode, t: tr };
    })();

    // =====================================================
    // Интерфейс редактора
    // Editor UI
    // =====================================================
    const PANEL_CSS = `
/* =====================================================================
   Слой оформления редактора (2.5). Все правила ограничены собственными
   элементами редактора (#gpue-*, .gpue-*); страница игры, холст и его
   контейнеры не затрагиваются.
   ===================================================================== */
#gpue-panel, #gpue-btn{
  --gpue-ui-bg:#111318; --gpue-ui-card:#1B1E26; --gpue-ui-input:#20232D; --gpue-ui-hover:#262A36;
  --gpue-ui-accent:#7C5CFC; --gpue-ui-accent-h:#8D72FF; --gpue-ui-accent-soft:rgba(124,92,252,.16);
  --gpue-ui-text:#F4F5FA; --gpue-ui-text2:#A3A8B8; --gpue-ui-text3:#767C8E; --gpue-ui-border:#383D4A; --gpue-ui-border-soft:#2A2E39;
  --gpue-ui-ok:#4CC38A; --gpue-ui-ok-soft:rgba(76,195,138,.14); --gpue-ui-warn:#E8A23B; --gpue-ui-warn-soft:rgba(232,162,59,.14);
  --gpue-ui-danger:#E5534B; --gpue-ui-danger-soft:rgba(229,83,75,.14);
  --gpue-ui-r:10px; --gpue-ui-r-sm:8px; --gpue-ui-h:32px;
  --gpue-ui-font:"Segoe UI",system-ui,-apple-system,Roboto,"Helvetica Neue",Arial,sans-serif;
}
#gpue-btn{position:fixed;top:8px;right:8px;z-index:2147483646;display:flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0;
  box-sizing:border-box;background:var(--gpue-ui-card);color:var(--gpue-ui-text);border:1px solid var(--gpue-ui-border);border-radius:10px;
  font:600 12.5px/1 var(--gpue-ui-font);cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.35);transition:border-color .15s,background .15s,opacity .15s;opacity:.85}
#gpue-btn:hover{border-color:var(--gpue-ui-accent);background:#222533;opacity:1}
#gpue-btn.gpue-ui-editing{border-color:var(--gpue-ui-accent);background:var(--gpue-ui-accent);color:#fff;opacity:1;
  box-shadow:0 0 9px rgba(124,92,252,.8),0 0 20px rgba(124,92,252,.45)}

#gpue-panel{position:fixed;z-index:2147483647;width:min(380px,calc(100vw - 16px));box-sizing:border-box;background:var(--gpue-ui-bg);
  color:var(--gpue-ui-text);border:1px solid var(--gpue-ui-border);border-radius:12px;font:13px/1.45 var(--gpue-ui-font);
  box-shadow:0 18px 50px rgba(0,0,0,.55),0 2px 6px rgba(0,0,0,.35);display:none;user-select:none;overflow:hidden;
  max-height:calc(100vh - 16px);-webkit-font-smoothing:antialiased;text-align:left;letter-spacing:normal}
#gpue-panel.open{display:flex;flex-direction:column;animation:gpue-ui-in .14s ease-out}
@keyframes gpue-ui-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
#gpue-panel *, #gpue-panel *::before, #gpue-panel *::after{box-sizing:border-box}
#gpue-panel button, #gpue-panel input, #gpue-panel select, #gpue-panel textarea{font-family:var(--gpue-ui-font);letter-spacing:normal}

/* ---- заголовок (за него панель перетаскивается) ---- */
#gpue-head{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 10px 10px 14px;cursor:move;flex:none;
  border-bottom:1px solid var(--gpue-ui-border-soft);background:var(--gpue-ui-bg)}
#gpue-panel .gpue-ui-title{display:flex;align-items:center;gap:9px;min-width:0;font-weight:650;font-size:14px;white-space:nowrap}
#gpue-panel .gpue-ui-logo{width:22px;height:22px;border-radius:7px;background:var(--gpue-ui-accent);display:flex;align-items:center;
  justify-content:center;color:#fff;font-size:12px;font-weight:800;flex:none}
#gpue-panel .gpue-ui-ver{font-size:10.5px;font-weight:600;color:var(--gpue-ui-text2);background:var(--gpue-ui-input);
  border:1px solid var(--gpue-ui-border-soft);border-radius:6px;padding:1px 6px}
#gpue-head-btns{display:flex;align-items:center;gap:4px}
#gpue-panel .gpue-ui-icon-btn{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;padding:0;margin:0;
  background:transparent;border:1px solid transparent;border-radius:8px;color:var(--gpue-ui-text2);cursor:pointer;transition:background .12s,color .12s}
#gpue-panel .gpue-ui-icon-btn:hover{background:var(--gpue-ui-hover);color:var(--gpue-ui-text)}
#gpue-trans.on{color:var(--gpue-ui-accent-h);background:var(--gpue-ui-accent-soft)}
#gpue-panel svg.gpue-ui-ico{width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}

/* ---- полоса режима и автосохранения ---- */
#gpue-panel .gpue-ui-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px 0;flex:none}
#gpue-panel .gpue-ui-seg{display:inline-flex;padding:3px;gap:2px;background:var(--gpue-ui-input);border:1px solid var(--gpue-ui-border-soft);border-radius:9px}
#gpue-panel .gpue-ui-seg button{height:24px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--gpue-ui-text2);
  font-size:12px;font-weight:600;cursor:pointer;transition:background .12s,color .12s}
#gpue-panel .gpue-ui-seg button:hover{color:var(--gpue-ui-text)}
#gpue-panel .gpue-ui-seg button.on{background:var(--gpue-ui-card);color:var(--gpue-ui-text);box-shadow:0 1px 3px rgba(0,0,0,.4),inset 0 0 0 1px var(--gpue-ui-border)}
#gpue-panel .gpue-ui-save{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--gpue-ui-text3);white-space:nowrap;transition:color .2s}
#gpue-panel .gpue-ui-save::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--gpue-ui-text3);transition:background .2s}
#gpue-panel .gpue-ui-save[data-st="pending"]::before{background:var(--gpue-ui-warn)}
#gpue-panel .gpue-ui-save[data-st="ok"]{color:var(--gpue-ui-ok)}
#gpue-panel .gpue-ui-save[data-st="ok"]::before{background:var(--gpue-ui-ok)}
#gpue-panel .gpue-ui-save[data-st="error"]{color:var(--gpue-ui-danger)}
#gpue-panel .gpue-ui-save[data-st="error"]::before{background:var(--gpue-ui-danger)}

/* ---- вкладки ---- */
#gpue-tabs{display:grid;grid-template-columns:repeat(5,1fr);gap:2px;margin:10px 12px 0;padding:3px;flex:none;background:var(--gpue-ui-card);
  border:1px solid var(--gpue-ui-border-soft);border-radius:10px}
#gpue-tabs button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-width:0;padding:6px 2px 5px;margin:0;
  font:600 11px/1.15 var(--gpue-ui-font);background:transparent;color:var(--gpue-ui-text2);border:0;border-radius:7px;cursor:pointer;
  transition:background .12s,color .12s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#gpue-tabs button:hover{background:var(--gpue-ui-hover);color:var(--gpue-ui-text)}
#gpue-tabs button.on{background:var(--gpue-ui-accent-soft);color:#fff;box-shadow:inset 0 0 0 1px rgba(124,92,252,.55)}
#gpue-tabs button.on svg{color:var(--gpue-ui-accent-h)}
#gpue-tabs button span{font-size:inherit}

/* ---- тело панели и прокрутка ---- */
#gpue-body{padding:12px;display:flex;flex-direction:column;gap:10px;flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;
  scrollbar-width:thin;scrollbar-color:#3a3f4d transparent}
#gpue-body::-webkit-scrollbar{width:8px}
#gpue-body::-webkit-scrollbar-thumb{background:#363b48;border-radius:8px;border:2px solid var(--gpue-ui-bg)}
.gpue-page{display:none;flex-direction:column;gap:10px}
.gpue-page.on{display:flex}

/* ---- простой / расширенный режим ---- */
#gpue-panel:not(.gpue-ui-mode-adv) .gpue-ui-adv{display:none !important}
#gpue-panel.gpue-ui-mode-adv .gpue-ui-simple-only{display:none !important}
#gpue-panel .gpue-ui-adv-tag{font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--gpue-ui-accent-h);
  background:var(--gpue-ui-accent-soft);border-radius:5px;padding:1px 5px;margin-left:6px;vertical-align:1px}

/* ---- карточки ---- */
#gpue-panel .gpue-ui-card{background:var(--gpue-ui-card);border:1px solid var(--gpue-ui-border-soft);border-radius:var(--gpue-ui-r);padding:12px;
  display:flex;flex-direction:column;gap:9px}
#gpue-panel .gpue-ui-card-title{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;font-weight:650;
  color:var(--gpue-ui-text2);text-transform:uppercase;letter-spacing:.05em}
#gpue-panel .gpue-ui-h1{font-size:17px;font-weight:700;letter-spacing:-.01em;margin:0}
#gpue-panel .gpue-ui-lead{font-size:12px;color:var(--gpue-ui-text2);margin-top:-6px}

/* ---- кнопки ---- */
#gpue-panel button.gpue-b{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:var(--gpue-ui-h);padding:6px 12px;margin:0;
  background:var(--gpue-ui-input);color:var(--gpue-ui-text);border:1px solid var(--gpue-ui-border);border-radius:var(--gpue-ui-r-sm);
  font-size:12.5px;font-weight:600;line-height:1.2;cursor:pointer;text-align:center;
  transition:background .12s,border-color .12s,color .12s,box-shadow .12s,transform .06s}
#gpue-panel button.gpue-b:hover{background:var(--gpue-ui-hover);border-color:#4A5060}
#gpue-panel button.gpue-b:active{transform:translateY(1px);background:#2C3040}
#gpue-panel button.gpue-b:disabled{opacity:.45;cursor:not-allowed;transform:none}
#gpue-panel button.gpue-danger{color:#FFB4AE;border-color:rgba(229,83,75,.45);background:var(--gpue-ui-danger-soft)}
#gpue-panel button.gpue-danger:hover{background:rgba(229,83,75,.24);border-color:var(--gpue-ui-danger);color:#fff}
#gpue-panel button.gpue-ui-primary{background:var(--gpue-ui-accent);border-color:var(--gpue-ui-accent);color:#fff}
#gpue-panel button.gpue-ui-primary:hover{background:var(--gpue-ui-accent-h);border-color:var(--gpue-ui-accent-h)}
#gpue-panel button.gpue-ui-ghost{background:transparent;border-color:transparent;color:var(--gpue-ui-text2)}
#gpue-panel button.gpue-ui-ghost:hover{background:var(--gpue-ui-hover);color:var(--gpue-ui-text);border-color:transparent}
#gpue-panel button.gpue-ui-sm{min-height:26px;padding:3px 9px;font-size:12px;border-radius:7px}
#gpue-panel button.gpue-b.gpue-on{background:var(--gpue-ui-ok-soft);border-color:rgba(76,195,138,.6);color:#CFF5E1}
/* крупная акцентная кнопка «Настроить на экране» */
#gpue-panel button.gpue-ui-hero{min-height:52px;width:100%;justify-content:flex-start;gap:12px;padding:8px 14px;font-size:14px;border-radius:11px;
  background:var(--gpue-ui-accent);border-color:var(--gpue-ui-accent);color:#fff;box-shadow:0 6px 18px rgba(124,92,252,.28)}
#gpue-panel button.gpue-ui-hero:hover{background:var(--gpue-ui-accent-h);border-color:var(--gpue-ui-accent-h)}
#gpue-panel button.gpue-ui-hero svg.gpue-ui-ico{width:20px;height:20px}
#gpue-panel button.gpue-ui-hero .gpue-ui-hero-txt{display:flex;flex-direction:column;align-items:flex-start;gap:1px;text-align:left;min-width:0}
#gpue-panel button.gpue-ui-hero .gpue-pill{font-size:11.5px;font-weight:500;opacity:.85;margin:0}
#gpue-panel button.gpue-ui-hero.gpue-on{background:#1F3B30;border-color:var(--gpue-ui-ok);color:#E6FFF1;box-shadow:0 0 0 3px rgba(76,195,138,.18)}
#gpue-panel button.gpue-ui-hero.gpue-on:hover{background:#25463A}

/* ---- поля ввода ---- */
#gpue-panel select{width:100%;height:var(--gpue-ui-h);padding:0 30px 0 10px;margin:0;background-color:var(--gpue-ui-input);color:var(--gpue-ui-text);
  border:1px solid var(--gpue-ui-border);border-radius:var(--gpue-ui-r-sm);font-size:12.5px;cursor:pointer;-webkit-appearance:none;appearance:none;
  background-image:linear-gradient(45deg,transparent 50%,#A3A8B8 50%),linear-gradient(135deg,#A3A8B8 50%,transparent 50%);
  background-position:calc(100% - 15px) 52%,calc(100% - 10px) 52%;background-size:5px 5px,5px 5px;background-repeat:no-repeat;
  transition:border-color .12s}
#gpue-panel select:hover{border-color:#4A5060}
#gpue-panel select option, #gpue-panel select optgroup{background:var(--gpue-ui-input);color:var(--gpue-ui-text)}
#gpue-panel input[type=text], #gpue-panel input[type=number]{width:100%;height:var(--gpue-ui-h);padding:0 10px;margin:0;background:var(--gpue-ui-input);
  color:var(--gpue-ui-text);border:1px solid var(--gpue-ui-border);border-radius:var(--gpue-ui-r-sm);font-size:12.5px;user-select:text;outline:none;
  transition:border-color .12s,box-shadow .12s}
#gpue-panel input[type=text]::placeholder{color:var(--gpue-ui-text3)}
#gpue-panel input[type=text]:hover, #gpue-panel input[type=number]:hover{border-color:#4A5060}
#gpue-panel input[type=color]{-webkit-appearance:none;appearance:none;height:28px;padding:2px;border:1px solid var(--gpue-ui-border);
  background:var(--gpue-ui-input);border-radius:7px;cursor:pointer}
#gpue-panel input[type=color]::-webkit-color-swatch-wrapper{padding:0}
#gpue-panel input[type=color]::-webkit-color-swatch{border:0;border-radius:5px}
#gpue-panel input[type=color]::-moz-color-swatch{border:0;border-radius:5px}
/* ползунки */
#gpue-panel input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:18px;margin:0;background:transparent;cursor:pointer;min-width:0}
#gpue-panel input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:4px;background:#323745}
#gpue-panel input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;margin-top:-5px;border-radius:50%;
  background:#fff;border:3px solid var(--gpue-ui-accent);box-shadow:0 1px 3px rgba(0,0,0,.5);transition:transform .1s}
#gpue-panel input[type=range]:hover::-webkit-slider-thumb{transform:scale(1.12)}
#gpue-panel input[type=range]::-moz-range-track{height:4px;border-radius:4px;background:#323745}
#gpue-panel input[type=range]::-moz-range-progress{height:4px;border-radius:4px;background:var(--gpue-ui-accent)}
#gpue-panel input[type=range]::-moz-range-thumb{width:10px;height:10px;border-radius:50%;background:#fff;border:3px solid var(--gpue-ui-accent)}
#gpue-panel input[type=range]:disabled{opacity:.4;cursor:not-allowed}
/* переключатели (все флажки панели) */
#gpue-panel label.gpue-chk{display:flex;gap:10px;align-items:center;cursor:pointer;min-height:24px;color:var(--gpue-ui-text)}
#gpue-panel input[type=checkbox]{-webkit-appearance:none;appearance:none;position:relative;flex:none;width:32px;height:18px;margin:0;border-radius:18px;
  background:#3A3F4D;border:0;cursor:pointer;transition:background .15s;outline:none}
#gpue-panel input[type=checkbox]::after{content:'';position:absolute;left:2px;top:2px;width:14px;height:14px;border-radius:50%;background:#C9CCD6;
  box-shadow:0 1px 2px rgba(0,0,0,.4);transition:transform .15s,background .15s}
#gpue-panel input[type=checkbox]:checked{background:var(--gpue-ui-accent)}
#gpue-panel input[type=checkbox]:checked::after{transform:translateX(14px);background:#fff}
#gpue-panel input[type=checkbox]:disabled{opacity:.4;cursor:not-allowed}
#gpue-panel .gpue-ui-switch-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:2px 0}
#gpue-panel .gpue-ui-switch-row > span{display:flex;flex-direction:column}
#gpue-panel .gpue-ui-switch-row small{color:var(--gpue-ui-text3);font-size:11.5px}
#gpue-panel textarea.gpa-code{width:100%;min-height:150px;resize:vertical;font:12px/1.45 Consolas,"Cascadia Code","Courier New",monospace;
  background:#0D0F13;color:#D9DEF0;border:1px solid var(--gpue-ui-border);border-radius:var(--gpue-ui-r-sm);padding:8px 10px;white-space:pre;
  overflow:auto;user-select:text;tab-size:2;outline:none}
/* клавиатурный фокус */
#gpue-panel button:focus-visible, #gpue-panel select:focus-visible, #gpue-panel summary:focus-visible,
#gpue-panel input[type=range]:focus-visible, #gpue-panel input[type=checkbox]:focus-visible, #gpue-panel input[type=color]:focus-visible,
#gpue-btn:focus-visible{outline:2px solid var(--gpue-ui-accent-h);outline-offset:2px}
#gpue-panel input[type=text]:focus, #gpue-panel input[type=number]:focus, #gpue-panel textarea:focus, #gpue-panel select:focus{
  border-color:var(--gpue-ui-accent);box-shadow:0 0 0 3px rgba(124,92,252,.22)}
#gpue-panel button:focus:not(:focus-visible){outline:none}

/* ---- общие строки (используются и модулями оформления/референса) ---- */
#gpue-panel .gpue-sec, #gpue-panel .gpa-sub{font-size:11.5px;font-weight:650;color:var(--gpue-ui-text2);text-transform:uppercase;letter-spacing:.05em;margin-top:2px}
#gpue-panel .gpue-row{display:grid;grid-template-columns:76px 1fr 54px;align-items:center;gap:10px}
#gpue-panel .gpue-row > span:first-child, #gpue-panel .gpa-row > span:first-child{color:var(--gpue-ui-text2);font-size:12.5px}
#gpue-panel .gpue-val, #gpue-panel .gpa-val{text-align:right;font-variant-numeric:tabular-nums;font-size:12px;color:var(--gpue-ui-text);
  background:var(--gpue-ui-input);border:1px solid var(--gpue-ui-border-soft);border-radius:6px;padding:2px 6px;white-space:nowrap}
#gpue-panel .gpue-hint{font-size:11.5px;color:var(--gpue-ui-text3);line-height:1.45}
#gpue-panel .gpue-btnrow{display:flex;gap:8px;align-items:center}
#gpue-panel .gpue-btnrow > button{flex:1;padding-left:6px;padding-right:6px}
#gpue-panel .gpue-btnrow > input[type=text]{flex:1;min-width:0}
#gpue-panel .gpue-btnrow > select{flex:1;min-width:0}
#gpue-panel .gpue-customrow{display:none;gap:8px}
#gpue-panel .gpue-customrow button{flex:1}
#gpue-status{display:flex;flex-direction:column;gap:6px}
#gpue-panel .gpue-ui-warnbox, #gpue-warn{font-size:11.5px;color:#F3D19A;background:var(--gpue-ui-warn-soft);border:1px solid rgba(232,162,59,.3);border-radius:8px;padding:7px 9px;display:none}

/* ---- статус элемента ---- */
#gpue-panel .gpue-ui-badge{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 9px;border-radius:11px;font-size:11.5px;font-weight:650;
  white-space:nowrap;align-self:flex-start}
#gpue-panel .gpue-ui-badge::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor}
#gpue-panel .gpue-ui-badge[data-st="found"]{color:var(--gpue-ui-ok);background:var(--gpue-ui-ok-soft)}
#gpue-panel .gpue-ui-badge[data-st="missing"]{color:var(--gpue-ui-text2);background:rgba(163,168,184,.12)}
#gpue-panel .gpue-ui-badge[data-st="error"]{color:var(--gpue-ui-danger);background:var(--gpue-ui-danger-soft)}
#gpue-panel .gpue-ui-statusline{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
#gpue-panel .gpue-ui-statusline .gpue-ui-muted{font-size:11.5px;color:var(--gpue-ui-text3)}
#gpue-panel code.gpue-ui-code{display:block;font:11px/1.4 Consolas,"Cascadia Code",monospace;color:var(--gpue-ui-text2);background:#0D0F13;
  border:1px solid var(--gpue-ui-border-soft);border-radius:6px;padding:4px 7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;user-select:text}

/* ---- список элементов ---- */
#gpue-panel .gpue-ui-ellist{display:flex;flex-direction:column;gap:2px;max-height:216px;overflow-y:auto;padding:3px;margin:0 -3px;
  scrollbar-width:thin;scrollbar-color:#3a3f4d transparent}
#gpue-panel .gpue-ui-el{display:flex;align-items:center;gap:9px;width:100%;min-height:32px;padding:5px 9px;margin:0;background:transparent;
  border:1px solid transparent;border-radius:8px;color:var(--gpue-ui-text);font-size:12.5px;text-align:left;cursor:pointer;transition:background .1s,border-color .1s}
#gpue-panel .gpue-ui-el:hover{background:var(--gpue-ui-hover)}
#gpue-panel .gpue-ui-el.on{background:var(--gpue-ui-accent-soft);border-color:rgba(124,92,252,.6)}
#gpue-panel .gpue-ui-el.on .gpue-ui-el-name{font-weight:650}
#gpue-panel .gpue-ui-dot{width:7px;height:7px;border-radius:50%;flex:none;background:#4A4F5E}
#gpue-panel .gpue-ui-el[data-st="found"] .gpue-ui-dot{background:var(--gpue-ui-ok)}
#gpue-panel .gpue-ui-el[data-st="error"] .gpue-ui-dot{background:var(--gpue-ui-danger)}
#gpue-panel .gpue-ui-el[data-st="missing"] .gpue-ui-el-name{color:var(--gpue-ui-text2)}
#gpue-panel .gpue-ui-el-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#gpue-panel .gpue-ui-el-tags{display:flex;gap:4px;flex:none}
#gpue-panel .gpue-ui-tag{font-size:10px;font-weight:650;padding:1px 6px;border-radius:5px;background:var(--gpue-ui-input);color:var(--gpue-ui-text2);
  border:1px solid var(--gpue-ui-border-soft)}
#gpue-panel .gpue-ui-tag.mod{color:#CDBEFF;border-color:rgba(124,92,252,.4)}
#gpue-panel .gpue-ui-tag.hid{color:#F3D19A;border-color:rgba(232,162,59,.4)}

/* ---- числовые поля X / Y / W / H ---- */
#gpue-panel .gpue-ui-grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
#gpue-panel .gpue-ui-num{display:flex;align-items:center;height:34px;background:var(--gpue-ui-input);border:1px solid var(--gpue-ui-border);
  border-radius:var(--gpue-ui-r-sm);transition:border-color .12s,box-shadow .12s;overflow:hidden}
#gpue-panel .gpue-ui-num:hover{border-color:#4A5060}
#gpue-panel .gpue-ui-num:focus-within{border-color:var(--gpue-ui-accent);box-shadow:0 0 0 3px rgba(124,92,252,.22)}
#gpue-panel .gpue-ui-num-label{flex:none;width:28px;height:100%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;
  color:var(--gpue-ui-text2);border-right:1px solid var(--gpue-ui-border-soft);cursor:ew-resize;touch-action:none}
#gpue-panel .gpue-ui-num-label:hover{color:var(--gpue-ui-accent-h);background:var(--gpue-ui-hover)}
#gpue-panel .gpue-ui-num input[type=number]{flex:1;min-width:0;height:100%;border:0;border-radius:0;background:transparent;box-shadow:none;
  font-variant-numeric:tabular-nums;font-size:13px;padding:0 4px 0 8px;-moz-appearance:textfield}
#gpue-panel .gpue-ui-num input[type=number]::-webkit-inner-spin-button, #gpue-panel .gpue-ui-num input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
#gpue-panel .gpue-ui-num input[type=number]:focus{box-shadow:none}
#gpue-panel .gpue-ui-num-unit{flex:none;padding-right:9px;font-size:11.5px;color:var(--gpue-ui-text3)}

/* ---- профили ---- */
#gpue-panel .gpue-ui-plist{display:flex;flex-direction:column;gap:6px}
#gpue-panel .gpue-ui-pcard{display:flex;align-items:center;gap:10px;padding:9px 10px;background:var(--gpue-ui-input);border:1px solid var(--gpue-ui-border-soft);
  border-radius:9px;cursor:pointer;transition:border-color .12s,background .12s}
#gpue-panel .gpue-ui-pcard:hover{border-color:#4A5060}
#gpue-panel .gpue-ui-pcard.on{border-color:var(--gpue-ui-accent);background:var(--gpue-ui-accent-soft)}
#gpue-panel .gpue-ui-pcard-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
#gpue-panel .gpue-ui-pcard-name{font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#gpue-panel .gpue-ui-pcard-meta{font-size:11.5px;color:var(--gpue-ui-text3)}
#gpue-panel .gpue-ui-pcard-act{display:flex;gap:4px;flex:none}
#gpue-panel .gpue-ui-empty{padding:16px 10px;text-align:center;color:var(--gpue-ui-text3);font-size:12px;border:1px dashed var(--gpue-ui-border);border-radius:9px}

/* ---- опасная зона ---- */
#gpue-panel .gpue-ui-danger-zone{border-color:rgba(229,83,75,.28);background:linear-gradient(0deg,rgba(229,83,75,.05),rgba(229,83,75,.05)),var(--gpue-ui-card)}
#gpue-panel .gpue-ui-danger-zone .gpue-ui-card-title{color:#F0A49E}

/* ---- блоки «Оформления» (details) ---- */
#gpue-panel .gpa-sec{border:1px solid var(--gpue-ui-border-soft);border-radius:var(--gpue-ui-r);padding:0 12px;background:var(--gpue-ui-card)}
#gpue-panel .gpa-sec .gpa-sec{background:var(--gpue-ui-bg);padding:0 10px}
#gpue-panel .gpa-sec summary{list-style:none;display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:650;color:var(--gpue-ui-text);
  padding:11px 0;outline:none;border-radius:6px}
#gpue-panel .gpa-sec summary::-webkit-details-marker{display:none}
#gpue-panel .gpa-sec summary::after{content:'';margin-left:auto;width:7px;height:7px;border-right:2px solid var(--gpue-ui-text2);
  border-bottom:2px solid var(--gpue-ui-text2);transform:rotate(45deg) translate(-2px,-2px);transition:transform .15s}
#gpue-panel .gpa-sec[open] > summary::after{transform:rotate(-135deg) translate(-2px,-2px)}
#gpue-panel .gpa-sec summary:hover{color:#fff}
#gpue-panel .gpa-sec[open] > summary{border-bottom:1px solid var(--gpue-ui-border-soft);margin-bottom:10px;border-radius:0}
#gpue-panel .gpa-body{display:flex;flex-direction:column;gap:9px;padding-bottom:12px}
#gpue-panel .gpa-row{display:grid;grid-template-columns:112px 1fr 50px;align-items:center;gap:8px}
#gpue-panel .gpa-row input[type=color]{grid-column:2 / span 2;width:100%}
#gpue-panel .gpa-row select{grid-column:2 / span 2}
#gpue-panel .gpa-targets{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px}
#gpue-panel .gpa-img{display:flex;flex-direction:column;gap:6px}
#gpue-panel .gpa-img > span{color:var(--gpue-ui-text2);font-size:12.5px}
#gpue-panel .gpa-imgbox{display:flex;gap:8px;align-items:center;padding:6px;background:var(--gpue-ui-input);border:1px dashed var(--gpue-ui-border);border-radius:9px}
#gpue-panel .gpa-imgbox button{flex:none;min-height:28px;padding:3px 9px}
#gpue-panel .gpa-prev{width:46px;height:32px;object-fit:contain;flex:none;border:1px solid var(--gpue-ui-border);border-radius:6px;
  background:repeating-conic-gradient(#3a3d47 0 25%,#2a2c33 0 50%) 50%/10px 10px}
#gpue-panel .gpa-none{flex:1;min-width:0;color:var(--gpue-ui-text3);font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#gpue-panel .gpa-fonts{display:flex;flex-direction:column;gap:5px}
#gpue-panel .gpa-font-row{display:flex;justify-content:space-between;align-items:center;gap:6px;background:var(--gpue-ui-input);
  border:1px solid var(--gpue-ui-border-soft);border-radius:8px;padding:4px 6px 4px 10px}
#gpue-panel .gpa-font-row span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#gpue-panel .gpa-font-row button{width:26px;height:26px;padding:0;flex:none;background:transparent;color:var(--gpue-ui-text2);border:1px solid transparent;
  border-radius:6px;cursor:pointer}
#gpue-panel .gpa-font-row button:hover{background:var(--gpue-ui-danger-soft);color:#FFB4AE}

/* ---- 2.6: нажим кисти ---- */
#gpue-panel .gpue-ui-meter{height:8px;border-radius:6px;background:#2A2E39;overflow:hidden;align-self:center}
#gpue-panel .gpue-ui-meter-fill{height:100%;width:0;border-radius:6px;background:linear-gradient(90deg,#5B44C9,#8D72FF);transition:width .06s linear}
#gpue-panel canvas.gpue-ui-pad{display:block;width:100%;height:120px;border-radius:9px;background:#0D0F13;border:1px dashed var(--gpue-ui-border);
  touch-action:none;cursor:crosshair}
html.gpue-edit #gpue-panel canvas.gpue-ui-pad{cursor:crosshair !important}


/* ---- уведомления ---- */
#gpue-panel .gpue-ui-toasts{position:absolute;left:12px;right:12px;bottom:12px;display:flex;flex-direction:column;gap:6px;pointer-events:none;z-index:5}
#gpue-panel .gpue-ui-toast{display:flex;align-items:flex-start;gap:9px;padding:9px 11px;border-radius:9px;background:#252935;color:var(--gpue-ui-text);
  border:1px solid var(--gpue-ui-border);box-shadow:0 8px 24px rgba(0,0,0,.45);font-size:12.5px;pointer-events:auto;
  animation:gpue-ui-toast .16s ease-out;transition:opacity .2s,transform .2s}
#gpue-panel .gpue-ui-toast::before{content:'';width:8px;height:8px;margin-top:5px;border-radius:50%;flex:none;background:var(--gpue-ui-accent)}
#gpue-panel .gpue-ui-toast[data-kind="ok"]{border-color:rgba(76,195,138,.45)}
#gpue-panel .gpue-ui-toast[data-kind="ok"]::before{background:var(--gpue-ui-ok)}
#gpue-panel .gpue-ui-toast[data-kind="warn"]{border-color:rgba(232,162,59,.45)}
#gpue-panel .gpue-ui-toast[data-kind="warn"]::before{background:var(--gpue-ui-warn)}
#gpue-panel .gpue-ui-toast[data-kind="error"]{border-color:rgba(229,83,75,.55)}
#gpue-panel .gpue-ui-toast[data-kind="error"]::before{background:var(--gpue-ui-danger)}
#gpue-panel .gpue-ui-toast.out{opacity:0;transform:translateY(4px)}
@keyframes gpue-ui-toast{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}

/* ---- встроенный диалог (вместо prompt/confirm/alert) ---- */
#gpue-panel .gpue-ui-dlg-back{position:absolute;inset:0;z-index:6;display:flex;align-items:center;justify-content:center;padding:16px;
  background:rgba(8,9,12,.62);animation:gpue-ui-fade .12s ease-out}
@keyframes gpue-ui-fade{from{opacity:0}to{opacity:1}}
#gpue-panel .gpue-ui-dlg{width:100%;max-width:310px;background:var(--gpue-ui-card);border:1px solid var(--gpue-ui-border);border-radius:12px;padding:16px;
  display:flex;flex-direction:column;gap:12px;box-shadow:0 16px 40px rgba(0,0,0,.55);animation:gpue-ui-in .14s ease-out}
#gpue-panel .gpue-ui-dlg-title{font-size:14.5px;font-weight:700}
#gpue-panel .gpue-ui-dlg-text{font-size:12.5px;color:var(--gpue-ui-text2);white-space:pre-line}
#gpue-panel .gpue-ui-dlg-err{font-size:11.5px;color:#FFB4AE;min-height:0}
#gpue-panel .gpue-ui-dlg-btns{display:flex;justify-content:flex-end;gap:8px}
#gpue-panel .gpue-ui-dlg-btns button{min-width:92px}

/* ---- небольшие экраны ---- */
@media (max-width:420px), (max-height:520px){
  #gpue-panel{border-radius:10px}
  #gpue-tabs button svg{display:none}
  #gpue-tabs button{padding:7px 2px}
  #gpue-panel .gpue-ui-ellist{max-height:150px}
  #gpue-panel .gpa-row{grid-template-columns:96px 1fr 46px}
}

@media (prefers-reduced-motion:reduce){
  #gpue-panel, #gpue-panel *, #gpue-panel *::before, #gpue-panel *::after{animation:none !important;transition:none !important}
}

/* ---- окна цветового круга и референса: только цвета и скругления (геометрия прежняя) ---- */
html #gpue-wheel-btn, html #gpue-ref-btn{background:#1B1E26;color:#F4F5FA;border:1px solid #383D4A;border-radius:10px;opacity:.85;
  box-shadow:0 4px 14px rgba(0,0,0,.35);font-family:"Segoe UI",system-ui,Arial,sans-serif;transition:border-color .15s,background .15s}
html #gpue-wheel-btn:hover, html #gpue-ref-btn:hover{border-color:#7C5CFC;background:#222533}
html #gpue-wheel, html #gpue-ref{color:#F4F5FA;border-color:#383D4A;border-radius:12px;font-family:"Segoe UI",system-ui,Arial,sans-serif;
  box-shadow:0 18px 50px rgba(0,0,0,.55)}
html #gpue-wheel{background:#111318}
html #gpue-wheel-head, html #gpue-ref-head{background:#1B1E26;border-bottom:1px solid #2A2E39}
html #gpue-wheel button, html #gpue-ref button{background:#20232D;color:#F4F5FA;border-color:#383D4A;border-radius:8px}
html #gpue-wheel button:hover, html #gpue-ref button:hover{background:#262A36;border-color:#4A5060}
html #gpue-wheel button.on, html #gpue-ref button.on{background:rgba(124,92,252,.22);border-color:#7C5CFC}
html #gpue-wheel input[type=text], html #gpue-ref input[type=text], html #gpue-wheel select{background:#20232D;color:#F4F5FA;border-color:#383D4A;border-radius:7px}
html #gpue-wheel input[type=text]:focus, html #gpue-ref input[type=text]:focus{outline:none;border-color:#7C5CFC}
html .gpue-ref-row, html #gpue-ref-info{background:#111318}
html #gpue-ref-vp{background:rgba(17,19,24,var(--a))}
html #gpue-ref input[type=range]{accent-color:#7C5CFC}

/* ---- подсветка элементов в режиме редактирования (как в 2.4) ---- */
#gpue-outline{position:fixed;z-index:2147483645;pointer-events:none;border:2px dashed #ffd24a;
  background:rgba(255,210,74,.08);display:none;box-sizing:border-box}
#gpue-hover{position:fixed;z-index:2147483644;pointer-events:none;border:1px solid #4aa8ff;
  background:rgba(74,168,255,.10);display:none;box-sizing:border-box}
#gpue-hover.new{border:1px dashed #ff8a3d;background:rgba(255,138,61,.10)}
.gpue-label{position:absolute;left:-2px;bottom:100%;margin-bottom:2px;background:#ffd24a;color:#000;
  font:11px/1.3 Arial,sans-serif;padding:1px 6px;border-radius:3px;white-space:nowrap;pointer-events:none;display:none}
.gpue-label.in{bottom:auto;top:2px;left:2px;margin:0}
#gpue-hover .gpue-label{display:block;background:#4aa8ff;color:#fff}
#gpue-hover.new .gpue-label{background:#ff8a3d}
#gpue-outline.editing{border-style:solid}
#gpue-outline.editing .gpue-label{display:block}
.gpue-handle{position:absolute;width:10px;height:10px;background:#ffd24a;border:1px solid #222;
  box-sizing:border-box;pointer-events:auto;display:none}
#gpue-outline.editing .gpue-handle{display:block}
.gpue-handle[data-dir="nw"]{left:-6px;top:-6px}
.gpue-handle[data-dir="n"]{left:50%;top:-6px;margin-left:-5px}
.gpue-handle[data-dir="ne"]{right:-6px;top:-6px}
.gpue-handle[data-dir="e"]{right:-6px;top:50%;margin-top:-5px}
.gpue-handle[data-dir="se"]{right:-6px;bottom:-6px}
.gpue-handle[data-dir="s"]{left:50%;bottom:-6px;margin-left:-5px}
.gpue-handle[data-dir="sw"]{left:-6px;bottom:-6px}
.gpue-handle[data-dir="w"]{left:-6px;top:50%;margin-top:-5px}
html.gpue-edit, html.gpue-edit *{cursor:move !important;user-select:none !important}
html.gpue-edit #gpue-panel, html.gpue-edit #gpue-panel *, html.gpue-edit #gpue-btn{cursor:default !important}
html.gpue-edit #gpue-panel select, html.gpue-edit #gpue-panel button, html.gpue-edit #gpue-panel input,
html.gpue-edit #gpue-btn, html.gpue-edit #gpue-close{cursor:pointer !important}
html.gpue-edit #gpue-head, html.gpue-edit #gpue-head .gpue-ui-title, html.gpue-edit #gpue-head .gpue-ui-title *{cursor:move !important}
html.gpue-edit .gpue-handle[data-dir="n"], html.gpue-edit .gpue-handle[data-dir="s"]{cursor:ns-resize !important}
html.gpue-edit .gpue-handle[data-dir="e"], html.gpue-edit .gpue-handle[data-dir="w"]{cursor:ew-resize !important}
html.gpue-edit .gpue-handle[data-dir="nw"], html.gpue-edit .gpue-handle[data-dir="se"]{cursor:nwse-resize !important}
html.gpue-edit .gpue-handle[data-dir="ne"], html.gpue-edit .gpue-handle[data-dir="sw"]{cursor:nesw-resize !important}
html.gpue-edit #gpue-panel textarea{cursor:text !important;user-select:text !important}
html.gpue-edit #gpue-head #gpue-trans{cursor:pointer !important}
#gpue-bg-overlay{pointer-events:none}
html.gpue-edit #gpue-bg-overlay{pointer-events:auto;cursor:move;outline:1px dashed rgba(143,168,255,.9);outline-offset:-1px}
html.gpue-edit #gpue-panel summary, html.gpue-edit #gpue-tabs button{cursor:pointer !important}
html.gpue-edit #gpue-panel input[type=text], html.gpue-edit #gpue-panel input[type=number]{cursor:text !important;user-select:text !important}
html.gpue-edit #gpue-panel .gpue-ui-num-label{cursor:ew-resize !important}
html.gpue-edit #gpue-panel .gpue-ui-el, html.gpue-edit #gpue-panel .gpue-ui-pcard, html.gpue-edit #gpue-panel label.gpue-chk{cursor:pointer !important}

/* ---- 2.17: D-pad — стрелки-крестик для точного сдвига выбранного элемента ---- */
#gpue-dpad{display:grid;grid-template-columns:repeat(3,24px);grid-template-rows:repeat(3,24px);gap:3px;flex:none}
#gpue-dpad .gpue-nudge{display:flex;align-items:center;justify-content:center;margin:0;padding:0;
  background:var(--gpue-ui-input);color:var(--gpue-ui-text);border:1px solid var(--gpue-ui-border);border-radius:7px;
  font:700 13px/1 var(--gpue-ui-font);cursor:pointer;transition:border-color .12s,background .12s,color .12s}
#gpue-dpad .gpue-nudge:hover{border-color:var(--gpue-ui-accent);background:var(--gpue-ui-accent-soft)}
#gpue-dpad .gpue-nudge:active{border-color:var(--gpue-ui-accent);background:var(--gpue-ui-accent);color:#fff}
#gpue-dpad .gpue-nudge:focus-visible{outline:2px solid var(--gpue-ui-accent-h);outline-offset:1px}

/* ---- 2.17: активные кнопки верхнего ряда светятся фиолетовым, как ⚙ UI в режиме правки ---- */
#gpue-btn.gpue-on, #gpue-players-btn.gpue-on, #gpue-wheel-btn.gpue-on, #gpue-ref-btn.gpue-on{
  border-color:#7C5CFC;background:#7C5CFC;color:#fff;opacity:1;
  box-shadow:0 0 9px rgba(124,92,252,.8),0 0 20px rgba(124,92,252,.45)}
`;

    let ui = {};

    // =====================================================
    // элементы интерфейса панели - иконки, уведомления, встроенные диалоги, режимы.
    // panel UI elements - icons, notifications, built-in dialogs, modes.
    // Всё живёт внутри #gpue-panel, поэтому isOurs и защита от перехвата событий
    // Everything lives inside #gpue-panel, so isOurs and the protection against event capture
    // режимом редактирования работают для них без изменений.
    // by the editing mode work for them unchanged.
    // =====================================================
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const ICONS = {
        layout: 'M4 4h7v7H4z M14 4h6v5h-6z M14 12h6v8h-6z M4 14h7v6H4z',
        appearance: 'M12 3.5c3.2 3.6 6 7 6 10.2a6 6 0 0 1-12 0c0-3.2 2.8-6.6 6-10.2z',
        ref: 'M4 5h16v14H4z M4 16l5-5 4 4 2.5-2.5L20 17 M17 8.5a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0',
        profiles: 'M12 3.5l8.5 4.5-8.5 4.5L3.5 8z M3.5 12.5l8.5 4.5 8.5-4.5 M3.5 16.5l8.5 4.5 8.5-4.5',
        draw: 'M15 4.5l4.5 4.5L9.5 19H5v-4.5z M13 6.5l4.5 4.5',
        close: 'M6 6l12 12 M18 6L6 18',
        contrast: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 3v18',
        move: 'M12 3v18 M3 12h18 M12 3l-2.5 2.5 M12 3l2.5 2.5 M12 21l-2.5-2.5 M12 21l2.5-2.5 M3 12l2.5-2.5 M3 12l2.5 2.5 M21 12l-2.5-2.5 M21 12l-2.5 2.5'
    };

    function svgIcon(name) {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('class', 'gpue-ui-ico');
        svg.setAttribute('aria-hidden', 'true');
        const p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('d', ICONS[name] || '');
        svg.appendChild(p);
        return svg;
    }

    // Пометка «только в расширенном режиме»: элемент скрывается CSS-классом, значения и обработчики не трогаются.
    // "Advanced mode only" mark: the element is hidden by a CSS class, values and handlers are untouched.
    function markAdv(el) {
        if (el && el.classList) el.classList.add('gpue-ui-adv');
        return el;
    }

    // Уведомление внизу панели. kind: 'info' | 'ok' | 'warn' | 'error'. action: { label, fn } - кнопка (например, «Вернуть»).
    // Notification at the bottom of the panel. kind: 'info' | 'ok' | 'warn' | 'error'. action: { label, fn } - a button (for example, "Undo").
    function uiToast(text, kind, ms, action) {
        if (!ui.toasts || !ui.panel || !ui.panel.classList.contains('open')) {
            if (kind === 'error') console.warn('[UI Layout Editor] ' + text);
            return;
        }
        const t = h('div', { class: 'gpue-ui-toast', 'data-kind': kind || 'info', role: kind === 'error' ? 'alert' : 'status' }, [
            h('span', { text: String(text), style: 'flex:1;min-width:0' })
        ]);
        let timer = 0;
        const kill = () => {
            clearTimeout(timer);
            t.classList.add('out');
            setTimeout(() => t.remove(), 220);
        };
        if (action && typeof action.fn === 'function') {
            const b = h('button', { type: 'button', class: 'gpue-b gpue-ui-sm', text: action.label || 'Отменить', style: 'margin:-3px -4px -3px 0' });
            b.addEventListener('click', () => { kill(); action.fn(); });
            t.appendChild(b);
        } else {
            t.addEventListener('click', kill);
        }
        ui.toasts.appendChild(t);
        while (ui.toasts.children.length > 3) ui.toasts.firstChild.remove();
        timer = setTimeout(kill, ms || (action ? 8000 : kind === 'error' ? 6500 : 2800));
    }

    // Встроенный диалог вместо prompt/confirm. Возвращает Promise:
    // Built-in dialog instead of prompt/confirm. Returns a Promise:
    // без opts.input - true/false; с opts.input - строку или null (отмена).
    // without opts.input - true/false; with opts.input - a string or null (cancel).
    // opts: { title, text, okText, cancelText, danger, input: { value, placeholder, maxlength }, validate(v) -> текст ошибки или '' }
    // opts: { title, text, okText, cancelText, danger, input: { value, placeholder, maxlength }, validate(v) -> error text or '' }
    // Если панель закрыта (вызов не из неё), используется системный диалог браузера.
    // If the panel is closed (a call not from it), the browser's system dialog is used.
    function uiDialog(opts) {
        opts = opts || {};
        const wantsInput = !!opts.input;
        if (!ui.panel || !ui.panel.classList.contains('open')) {
            const msg = [opts.title, opts.text].filter(Boolean).join('\n\n');
            if (wantsInput) {
                const v = prompt(msg, opts.input.value || '');
                if (v !== null && opts.validate && opts.validate(v)) return Promise.resolve(null);
                return Promise.resolve(v);
            }
            return Promise.resolve(confirm(msg));
        }
        if (ui.dialogCancel) ui.dialogCancel();
        return new Promise(resolve => {
            const prevFocus = document.activeElement;
            const input = wantsInput ? h('input', {
                type: 'text', spellcheck: 'false',
                maxlength: String(opts.input.maxlength || 60),
                placeholder: opts.input.placeholder || ''
            }) : null;
            if (input) input.value = opts.input.value || '';
            const err = h('div', { class: 'gpue-ui-dlg-err', role: 'alert' });
            const cancel = h('button', { type: 'button', class: 'gpue-b', text: opts.cancelText || 'Отмена' });
            const ok = h('button', { type: 'button', class: 'gpue-b ' + (opts.danger ? 'gpue-danger' : 'gpue-ui-primary'), text: opts.okText || 'OK' });
            const box = h('div', { class: 'gpue-ui-dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || 'Подтверждение' }, [
                opts.title ? h('div', { class: 'gpue-ui-dlg-title', text: opts.title }) : null,
                opts.text ? h('div', { class: 'gpue-ui-dlg-text', text: opts.text }) : null,
                input,
                err,
                h('div', { class: 'gpue-ui-dlg-btns' }, [cancel, ok])
            ].filter(Boolean));
            const back = h('div', { class: 'gpue-ui-dlg-back' }, [box]);
            let done = false;
            const close = val => {
                if (done) return;
                done = true;
                ui.dialogCancel = null;
                back.remove();
                if (prevFocus && prevFocus.focus && ui.panel.contains(prevFocus)) {
                    try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* не критично */ }
                }
                resolve(val);
            };
            const dismiss = () => close(wantsInput ? null : false);
            const submit = () => {
                if (!wantsInput) { close(true); return; }
                const bad = opts.validate ? opts.validate(input.value) : '';
                if (bad) { err.textContent = bad; input.focus(); return; }
                close(input.value);
            };
            ui.dialogCancel = dismiss;
            cancel.addEventListener('click', dismiss);
            ok.addEventListener('click', submit);
            back.addEventListener('mousedown', e => { if (e.target === back) dismiss(); });
            box.addEventListener('keydown', e => {
                if (e.key === 'Escape') { e.preventDefault(); dismiss(); return; }
                if (e.key === 'Enter' && input && e.target === input) { e.preventDefault(); submit(); return; }
                if (e.key === 'Tab') {
                    const f = [input, cancel, ok].filter(Boolean);
                    const i = f.indexOf(document.activeElement);
                    e.preventDefault();
                    f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
                }
            });
            if (input) input.addEventListener('input', () => { err.textContent = ''; });
            ui.panel.appendChild(back);
            setTimeout(() => {
                if (done) return;
                // для опасных действий фокус по умолчанию на «Отмена»: случайный Enter ничего не сбросит
                // for dangerous actions the default focus is on "Cancel": a random Enter resets nothing
                (input || (opts.danger ? cancel : ok)).focus();
                if (input) input.select();
            }, 0);
        });
    }

    // --- Простой / расширенный режим (только видимость секций, значения не меняются) ----
    // --- Simple / advanced mode (section visibility only, values unchanged) ----
    function setUiMode(mode, silent) {
        state.uiMode = mode === 'advanced' ? 'advanced' : 'simple';
        // режим меняет только видимость строк в списке элементов, игру не трогаем
        // the mode changes only the visibility of rows in the element list, the game is untouched
        try { renderElementList(); } catch (e) { /* список ещё не построен */ }
        if (!ui.panel) return;
        const adv = state.uiMode === 'advanced';
        ui.panel.classList.toggle('gpue-ui-mode-adv', adv);
        (ui.modeBtns || []).forEach(b => {
            const on = b.dataset.mode === state.uiMode;
            b.classList.toggle('on', on);
            b.setAttribute('aria-pressed', String(on));
        });
        if (!silent) scheduleSave();
    }

    // --- Список элементов (вкладка «Раскладка») ----
    // --- Element list ("Layout" tab) ----
    function renderElementList() {
        if (!ui.elList) return;
        ui.elList.textContent = '';
        ui.elRows = {};
        for (const key of Object.keys(ELEMENTS)) {
            // в простом режиме в списке остаются только основные элементы игры,
            // in simple mode only the main game elements remain in the list,
            // остальные строки скрыты (display:none) — в расширенном виден весь список
            // the other rows are hidden (display:none) - in advanced mode the whole list is visible
            if (state.uiMode === 'simple' && !SIMPLE_KEEP.has(key)) continue;
            const name = h('span', { class: 'gpue-ui-el-name' });
            const tags = h('span', { class: 'gpue-ui-el-tags' });
            const row = h('button', { type: 'button', class: 'gpue-ui-el', 'data-key': key, role: 'option' }, [
                h('span', { class: 'gpue-ui-dot' }), name, tags
            ]);
            ui.elRows[key] = { row, name, tags, sig: '' };
            ui.elList.appendChild(row);
        }
        updateElementList();
    }

    // Обновляет отметки «найден / не найден / ошибка», выделение и метки «изменён / скрыт».
    // Updates the "found / not found / error" marks, the selection and the "changed / hidden" marks.
    // DOM трогается только при реальном изменении (вызывается из tick раз в 400 мс).
    // The DOM is touched only on a real change (called from tick every 400 ms).
    function updateElementList() {
        if (!ui.elRows) return;
        for (const key of Object.keys(ui.elRows)) {
            const r = ui.elRows[key];
            const def = ELEMENTS[key];
            if (!def) continue;
            let st = 'missing';
            try { st = document.querySelector(def.selector) ? 'found' : 'missing'; } catch (e) { st = 'error'; }
            const s = state.elements[key];
            const on = key === state.selected;
            const moved = !!s && (s.x !== 0 || s.y !== 0 || s.w !== 100 || s.h !== 100);
            const hid = !!(s && s.hidden);
            const sig = [st, on ? 1 : 0, def.name, def.custom ? 1 : 0, hid ? 1 : 0, moved ? 1 : 0].join('|');
            if (sig === r.sig) continue;
            r.sig = sig;
            r.row.dataset.st = st;
            r.row.classList.toggle('on', on);
            r.row.setAttribute('aria-selected', String(on));
            r.name.textContent = def.name;
            r.row.title = def.name + (st === 'found' ? ' - найден на странице' : st === 'error' ? ' - ошибка проверки селектора' : ' - сейчас не на странице');
            r.tags.textContent = '';
            if (def.custom) r.tags.appendChild(h('span', { class: 'gpue-ui-tag', text: 'свой' }));
            if (hid) r.tags.appendChild(h('span', { class: 'gpue-ui-tag hid', text: 'скрыт' }));
            if (moved) r.tags.appendChild(h('span', { class: 'gpue-ui-tag mod', text: 'изменён' }));
        }
    }

    function scrollSelectedIntoList() {
        const r = ui.elRows && ui.elRows[state.selected];
        if (!r || !ui.elList) return;
        const lr = ui.elList.getBoundingClientRect();
        const rr = r.row.getBoundingClientRect();
        if (!lr.height || !rr.height) return;
        if (rr.top < lr.top) ui.elList.scrollTop -= lr.top - rr.top + 4;
        else if (rr.bottom > lr.bottom) ui.elList.scrollTop += rr.bottom - lr.bottom + 4;
    }

    // Статус выбранного элемента: «Найден» / «Не найден» / «Ошибка проверки»
    // Status of the selected element: "Found" / "Not found" / "Check error"
    function renderSelectedStatus() {
        if (!ui.statusBadge) return;
        const def = ELEMENTS[state.selected];
        if (!def) return;
        let st = 'missing', count = 0;
        try {
            count = document.querySelectorAll(def.selector).length;
            st = count ? 'found' : 'missing';
        } catch (e) { st = 'error'; }
        const sig = st + '|' + count + '|' + def.selector + '|' + def.name;
        if (ui.statusSig === sig) return;
        ui.statusSig = sig;
        ui.selName.textContent = def.name;
        ui.selName.title = def.name;
        ui.statusBadge.dataset.st = st;
        ui.statusBadge.textContent = st === 'found' ? 'Найден' : st === 'missing' ? 'Не найден' : 'Ошибка проверки';
        ui.statusMeta.textContent = st === 'found'
            ? (count > 1 ? 'совпадений на странице: ' + count : 'есть на текущем экране')
            : st === 'missing' ? 'появится на экране, где он есть' : 'селектор не удалось проверить';
        ui.statusSel.textContent = def.selector;
        ui.statusSel.title = def.selector;
    }

    // --- Числовые поля X / Y / W / H ----
    // --- Numeric fields X / Y / W / H ----
    const NUM_PROPS = { x: RANGE.pos, y: RANGE.pos, w: RANGE.size, h: RANGE.size };

    function numField(prop, label, unit, title) {
        const r = NUM_PROPS[prop];
        const input = h('input', {
            type: 'number', step: 'any', inputmode: 'decimal', min: String(r.min), max: String(r.max),
            'aria-label': title, title: title + ' (↑/↓: ±1, Shift: ±10)'
        });
        const lab = h('span', { class: 'gpue-ui-num-label', text: label, title: title + ': тяните влево/вправо, чтобы изменить (Shift - быстрее)' });
        const wrap = h('div', { class: 'gpue-ui-num' }, [lab, input, h('span', { class: 'gpue-ui-num-unit', text: unit })]);
        return { prop, input, lab, wrap };
    }

    // --- Карточки профилей (вкладка «Профили») ----
    // --- Profile cards ("Profiles" tab) ----
    function markPresetCards() {
        if (!ui.presetList) return;
        const cur = ui.presetSelect.value;
        for (const c of ui.presetList.children) {
            if (!c.dataset || c.dataset.name === undefined) continue;
            const on = c.dataset.name === cur;
            c.classList.toggle('on', on);
            c.setAttribute('aria-selected', String(on));
        }
        const has = !!cur && Object.prototype.hasOwnProperty.call(state.presets, cur);
        ui.presetLoad.disabled = !has;
        ui.presetDel.disabled = !has;
    }

    function renderPresetCards() {
        if (!ui.presetList) return;
        const names = Object.keys(state.presets);
        ui.presetList.textContent = '';
        if (!names.length) {
            ui.presetList.appendChild(h('div', {
                class: 'gpue-ui-empty',
                text: 'Сохранённых профилей пока нет.\nНажмите «Сохранить как…», чтобы сохранить текущую раскладку.'
            }));
            ui.presetList.firstChild.style.whiteSpace = 'pre-line';
        }
        for (const nm of names) {
            const p = state.presets[nm] || {};
            const nEl = p.elements && typeof p.elements === 'object' ? Object.keys(p.elements).length : 0;
            const nCustom = p.custom && typeof p.custom === 'object' ? Object.keys(p.custom).length : 0;
            const meta = 'Настроено элементов: ' + nEl + (nCustom ? ' · своих: ' + nCustom : '');
            const load = h('button', { type: 'button', class: 'gpue-b gpue-ui-sm', text: 'Загрузить', title: 'Применить профиль «' + nm + '»' });
            const del = h('button', { type: 'button', class: 'gpue-b gpue-ui-sm gpue-ui-ghost', text: '✕', title: 'Удалить профиль', 'aria-label': 'Удалить профиль ' + nm });
            const card = h('div', { class: 'gpue-ui-pcard', tabindex: '0', role: 'option' }, [
                h('div', { class: 'gpue-ui-pcard-main' }, [
                    h('span', { class: 'gpue-ui-pcard-name', text: nm, title: nm }),
                    h('span', { class: 'gpue-ui-pcard-meta', text: meta })
                ]),
                h('div', { class: 'gpue-ui-pcard-act' }, [load, del])
            ]);
            card.dataset.name = nm;
            const pick = () => { ui.presetSelect.value = nm; markPresetCards(); };
            card.addEventListener('click', e => { if (!(e.target.closest && e.target.closest('button'))) pick(); });
            card.addEventListener('dblclick', e => { if (!(e.target.closest && e.target.closest('button'))) { pick(); loadPreset(); } });
            card.addEventListener('keydown', e => {
                if (e.target !== card) return;
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
            });
            load.addEventListener('click', () => { pick(); loadPreset(); });
            del.addEventListener('click', () => { pick(); deletePreset(); });
            ui.presetList.appendChild(card);
        }
        markPresetCards();
    }

    function buildUI() {
        if (document.getElementById('gpue-btn')) return;

        const style = document.createElement('style');
        style.id = 'gpue-ui-style';
        style.textContent = PANEL_CSS;
        document.head.appendChild(style);

        // Кнопка
        // Button
        // только значок — все кнопки верхнего ряда строго одного размера (30×30, см. ToolLayout)
        // icon only - all top-row buttons are strictly one size (30×30, see ToolLayout)
        ui.btn = h('div', { id: 'gpue-btn', text: '⚙', title: 'UI Editor — редактор интерфейса', role: 'button', tabindex: '0' });

        // Подсветка выбранного элемента (pointer-events: none)
        // Highlight of the selected element (pointer-events: none)
        ui.outlineLabel = h('div', { class: 'gpue-label' });
        ui.outline = h('div', { id: 'gpue-outline' }, [
            ui.outlineLabel,
            ...HANDLE_DIRS.map(d => h('div', { class: 'gpue-handle', 'data-dir': d }))
        ]);

        // Рамка при наведении в режиме редактирования
        // Hover frame in editing mode
        ui.hoverLabel = h('div', { class: 'gpue-label' });
        ui.hover = h('div', { id: 'gpue-hover' }, [ui.hoverLabel]);

        // Выбор элемента. Скрытый <select> остаётся источником значения для старого кода
        // Element selection. The hidden <select> remains the value source for the old code
        // (rebuildSelect / selectKey), видимый список - ui.elList.
        // (rebuildSelect / selectKey), the visible list is ui.elList.
        ui.select = h('select', { style: 'display:none', 'aria-hidden': 'true', tabindex: '-1' });
        rebuildSelect();
        ui.elList = h('div', { class: 'gpue-ui-ellist', role: 'listbox', 'aria-label': 'Элементы интерфейса' });

        // Положение и размер: числовые поля (та же семантика, что у ползунков px и % от исходного размера)
        // Position and size: numeric fields (the same semantics as the sliders: px and % of the original size)
        const fx = numField('x', 'X', 'px', 'Сдвиг по горизонтали');
        const fy = numField('y', 'Y', 'px', 'Сдвиг по вертикали');
        const fw = numField('w', 'W', '%', 'Ширина');
        const fh = numField('h', 'H', '%', 'Высота');
        ui.x = fx.input;
        ui.y = fy.input;
        ui.w = fw.input;
        ui.h = fh.input;

        // D-pad — стрелки-крестик для точного сдвига выбранного элемента.
        // D-pad - an arrow cross for precise nudging of the selected element.
        // Клик = сдвиг на 1 px, удержание = повторение (интервал 120 мс). Тот же путь,
        // Click = a 1 px nudge, holding = repeat (120 ms interval). The same path
        // что у числовых полей: clamp по RANGE.pos, applyLayout + сохранение.
        // as the numeric fields: clamp by RANGE.pos, applyLayout + saving.
        const nudge = (prop, delta) => {
            const s = getEl(state.selected);
            s[prop] = clamp(Math.round((Number(s[prop]) || 0) + delta), RANGE.pos.min, RANGE.pos.max);
            applyLayout();
            refreshValues();
            scheduleSave();
        };
        const nudgeBtn = (arrow, prop, delta, col, row, title) => {
            const b = h('button', {
                type: 'button', class: 'gpue-nudge', text: arrow, title, 'aria-label': title,
                style: 'grid-column:' + col + ';grid-row:' + row
            });
            let rep = null;
            const once = () => nudge(prop, delta);
            const stop = () => { if (rep) { clearInterval(rep); rep = null; flushSave(); } };
            b.addEventListener('pointerdown', e => {
                if (e.button !== 0) return;
                e.preventDefault();
                once();
                if (rep) clearInterval(rep);
                rep = setInterval(once, 120);
            });
            ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => b.addEventListener(t, stop));
            // доступность с клавиатуры: Enter/Space = один сдвиг
            // keyboard accessibility: Enter/Space = one nudge
            b.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); once(); }
            });
            return b;
        };
        ui.dpad = h('div', { id: 'gpue-dpad', role: 'group', 'aria-label': 'Точный сдвиг стрелками' }, [
            nudgeBtn('↑', 'y', -1, 2, 1, 'Сдвинуть на 1 px вверх (удерживайте — повтор)'),
            nudgeBtn('←', 'x', -1, 1, 2, 'Сдвинуть на 1 px влево (удерживайте — повтор)'),
            nudgeBtn('→', 'x', 1, 3, 2, 'Сдвинуть на 1 px вправо (удерживайте — повтор)'),
            nudgeBtn('↓', 'y', 1, 2, 3, 'Сдвинуть на 1 px вниз (удерживайте — повтор)')
        ]);

        // «Область canvas»: один ползунок вместо отдельных W/H, чтобы холст всегда
        // "Canvas area": one slider instead of separate W/H so that the canvas always
        // рос пропорционально. 0% = исходный размер, 50% = +половина исходного
        // grows proportionally. 0% = the original size, 50% = +half of the original
        // размера, 100% = удвоенный размер. Хранится всё так же в s.w/s.h (100..200),
        // size, 100% = the doubled size. Everything is stored as before in s.w/s.h (100..200),
        // просто оба значения всегда равны.
        // both values are simply always equal.
        ui.canvasScale = h('input', { type: 'range', min: 0, max: 100, step: 1, value: 0, 'aria-label': 'Масштаб холста' });
        ui.canvasScaleVal = h('span', { class: 'gpue-val' });
        ui.whRow = h('div', { class: 'gpue-ui-grid2' }, [fw.wrap, fh.wrap]);
        ui.canvasScaleRow = h('div', { style: 'display:none;flex-direction:column;gap:6px' }, [
            h('div', { class: 'gpue-sec', text: 'Масштаб холста' }),
            h('div', { class: 'gpue-row' }, [h('span', { text: 'Больше на' }), ui.canvasScale, ui.canvasScaleVal])
        ]);

        ui.hidden = h('input', { type: 'checkbox', 'aria-label': 'Скрыть элемент' });
        ui.selName = h('div', { style: 'font-weight:650;font-size:14px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' });
        ui.statusBadge = h('span', { class: 'gpue-ui-badge', 'data-st': 'missing', text: 'Не найден' });
        ui.statusMeta = h('span', { class: 'gpue-ui-muted' });
        ui.statusSel = markAdv(h('code', { class: 'gpue-ui-code' }));
        ui.status = h('div', { id: 'gpue-status', 'aria-live': 'polite' }, [
            h('div', { class: 'gpue-ui-statusline' }, [ui.statusBadge, ui.statusMeta]),
            ui.statusSel
        ]);
        ui.warn = h('div', {
            id: 'gpue-warn',
            text: 'Размер холста меняет только картинку: координаты мыши и пера для игры корректируются автоматически.'
        });

        const resetOne = h('button', { type: 'button', class: 'gpue-b', text: '↺ Сбросить элемент', title: 'Вернуть выбранному элементу исходные положение, размер и видимость' });
        const resetAll = h('button', { type: 'button', class: 'gpue-b gpue-danger', text: 'Сбросить все настройки', title: 'Положение, размер и скрытие всех элементов' });
        ui.close = h('button', { type: 'button', id: 'gpue-close', class: 'gpue-ui-icon-btn', title: 'Закрыть', 'aria-label': 'Закрыть' }, [svgIcon('close')]);
        ui.langBtn = h('button', { type: 'button', id: 'gpue-lang', class: 'gpue-ui-icon-btn', title: 'Режим интерфейса: RU/EN — переключить язык интерфейса', 'aria-label': 'Язык интерфейса', style: 'font-size:11px;font-weight:700' }, [document.createTextNode('RU')]);
        ui.transBtn = h('button', { type: 'button', id: 'gpue-trans', class: 'gpue-ui-icon-btn', title: 'Прозрачное окно редактора (вкл/выкл)', 'aria-label': 'Прозрачное окно редактора' }, [svgIcon('contrast')]);
        ui.langBtn.addEventListener('click', () => { Lang.toggle(); ui.langBtn.textContent = Lang.mode().toUpperCase(); });
        ui.head = h('div', { id: 'gpue-head', title: 'Перетащите, чтобы переместить панель' }, [
            h('span', { class: 'gpue-ui-title' }, [
                h('span', { class: 'gpue-ui-logo', text: 'G' }),
                h('span', { text: 'Gartic UI Editor' }),
                h('span', { class: 'gpue-ui-ver', text: '2.19.0' })
            ]),
            h('span', { id: 'gpue-head-btns' }, [ui.langBtn, ui.transBtn, ui.close])
        ]);

        // Простой / расширенный режим + индикатор автосохранения
        // Simple / advanced mode + auto-save indicator
        ui.modeBtns = [
            h('button', { type: 'button', 'data-mode': 'simple', text: 'Простой', title: 'Только основные настройки' }),
            h('button', { type: 'button', 'data-mode': 'advanced', text: 'Расширенный', title: 'Все параметры: свои элементы, CSS, диагностика, технические настройки' })
        ];
        const modeSeg = h('div', { class: 'gpue-ui-seg', role: 'group', 'aria-label': 'Режим интерфейса' }, ui.modeBtns);
        const saveText = h('span', { text: 'Автосохранение' });
        const saveInd = h('span', { class: 'gpue-ui-save', 'data-st': 'idle', 'aria-live': 'polite' }, [saveText]);
        SAVE_IND.el = saveInd;
        SAVE_IND.text = saveText;
        uiSaveRender(SAVE_IND.pending.size ? 'pending' : 'idle');
        const bar = h('div', { class: 'gpue-ui-bar' }, [modeSeg, saveInd]);

        ui.editPill = h('span', { class: 'gpue-pill' });
        ui.editTitle = h('span', { text: 'Настроить на экране' });
        ui.editBtn = h('button', { type: 'button', class: 'gpue-b gpue-ui-hero', 'aria-pressed': 'false' }, [
            svgIcon('move'),
            h('span', { class: 'gpue-ui-hero-txt' }, [ui.editTitle, ui.editPill])
        ]);
        ui.editHint = h('div', {
            class: 'gpue-hint',
            text: 'Кликните по элементу игры, чтобы выбрать его, и тяните мышью. Маркеры по краям меняют размер. Shift+клик - точный элемент под курсором. Esc - выйти.'
        });
        ui.parentBtn = h('button', { type: 'button', class: 'gpue-b', text: '⬆ Родитель', title: 'Выбрать родительский элемент' });
        ui.delBtn = h('button', { type: 'button', class: 'gpue-b gpue-danger', text: 'Убрать из списка' });
        ui.customRow = markAdv(h('div', { class: 'gpue-customrow' }, [ui.parentBtn, ui.delBtn]));

        ui.renameBtn = markAdv(h('button', { type: 'button', class: 'gpue-b', text: '✎ Переименовать' }));
        ui.presetSelect = h('select', { style: 'display:none', 'aria-hidden': 'true', tabindex: '-1' });
        ui.presetList = h('div', { class: 'gpue-ui-plist', role: 'listbox', 'aria-label': 'Сохранённые профили' });
        ui.presetSave = h('button', { type: 'button', class: 'gpue-b gpue-ui-primary', text: 'Сохранить как…', title: 'Сохранить текущую раскладку как профиль' });
        ui.presetLoad = h('button', { type: 'button', class: 'gpue-b', text: 'Загрузить', title: 'Применить выбранный профиль' });
        ui.presetDel = h('button', { type: 'button', class: 'gpue-b gpue-danger', text: 'Удалить', title: 'Удалить выбранный профиль' });
        ui.exportBtn = h('button', { type: 'button', class: 'gpue-b', text: '⬇ Экспортировать', title: 'Сохранить текущую раскладку в JSON-файл' });
        ui.importBtn = h('button', { type: 'button', class: 'gpue-b', text: '⬆ Импортировать', title: 'Загрузить раскладку из JSON-файла' });
        ui.importFile = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
        ui.toasts = h('div', { class: 'gpue-ui-toasts' });

        const safe = (fn, label) => {
            try { return fn(); } catch (e) {
                console.warn('[UI Layout Editor] ' + label + ' недоступно:', e);
                return h('div', { class: 'gpue-hint', text: label + ' недоступно (см. консоль).' });
            }
        };
        const refTab = (() => { try { return buildRefTabPage(); } catch (e) { console.warn(e); return null; } })();

        const TABS = [
            ['layout', 'layout', 'Раскладка'],
            ['appearance', 'appearance', 'Оформление'],
            ['draw', 'draw', 'Рисование'],
            ['ref', 'ref', 'Референс'],
            ['profiles', 'profiles', 'Профили']
        ];
        ui.tabs = h('div', { id: 'gpue-tabs', role: 'tablist' }, TABS.map(t =>
            h('button', { type: 'button', role: 'tab', 'data-tab': t[0], title: t[2] }, [svgIcon(t[1]), h('span', { text: t[2] })])));

        const card = (title, children, cls) => h('div', { class: 'gpue-ui-card' + (cls ? ' ' + cls : '') }, [
            title ? (typeof title === 'string' ? h('div', { class: 'gpue-ui-card-title', text: title }) : title) : null
        ].concat(children).filter(Boolean));

        const page = (id, children) => h('div', { class: 'gpue-page', 'data-tab': id, role: 'tabpanel' }, children);
        ui.pages = [
            page('layout', [
                ui.editBtn,
                ui.editHint,
                card(h('div', { class: 'gpue-ui-card-title' }, [
                    h('span', { text: 'Элементы интерфейса' }),
                    h('span', { class: 'gpue-ui-muted', style: 'text-transform:none;letter-spacing:0;font-weight:500;font-size:11px', text: '● есть на экране' })
                ]), [ui.elList, ui.select]),
                card(null, [
                    h('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:8px' }, [ui.selName, ui.renameBtn]),
                    ui.status,
                    ui.customRow,
                    h('div', { class: 'gpue-sec', text: 'Положение и размер' }),
                    h('div', { style: 'display:flex;gap:10px;align-items:center' }, [
                        h('div', { class: 'gpue-ui-grid2', style: 'flex:1' }, [fx.wrap, fy.wrap]),
                        ui.dpad
                    ]),
                    ui.whRow,
                    ui.canvasScaleRow,
                    h('label', { class: 'gpue-chk gpue-ui-switch-row' }, [
                        h('span', {}, ['Скрыть элемент',h('small', { text: 'Место сохраняется, соседние элементы не сдвигаются' })]),
                        ui.hidden
                    ]),
                    ui.warn,
                    resetOne
                ]),
                // равный зазор между кнопками верхнего ряда (⚙ UI, 👥, 🎨, 🖼) — порт из студии
                // equal gap between the top-row buttons (⚙ UI, 👥, 🎨, 🖼) - a port from the studio
                card('Кнопки инструментов (верхний ряд)', [
                    safe(() => ToolLayout.row(), 'Кнопки инструментов')
                ]),
                card('Опасная зона', [
                    h('div', { class: 'gpue-hint', text: 'Вернёт исходные положение, размер и видимость всем элементам. Профили, свои элементы, названия и оформление не затрагиваются.' }),
                    resetAll
                ], 'gpue-ui-danger-zone')
            ]),
            page('appearance', [safe(() => GPAppearance.buildPage(), 'Оформление')]),
            // инструменты рисования - отдельная вкладка (кисть, нажим, перемещение холста, слои)
            // drawing tools - a separate tab (brush, pressure, canvas panning, layers)
            page('draw', [h('div', { class: 'gpa', style: 'display:flex;flex-direction:column;gap:10px' }, [
                safe(() => BrushSettings.buildSection(uiSection), 'Кисть'),
                safe(() => PressureSettings.buildSection(uiSection), 'Нажим кисти'),
                safe(() => CanvasPan.buildSection(uiSection), 'Перемещение холста')
            ])]),
            page('ref', [refTab ? refTab.el : h('div', { class: 'gpue-hint', text: 'Референс недоступен.' })]),
            page('profiles', [
                card(h('div', { class: 'gpue-ui-card-title' }, [
                    h('span', { text: 'Профили раскладки' }),
                    h('span', { class: 'gpue-ui-muted', style: 'text-transform:none;letter-spacing:0;font-weight:500;font-size:11px', text: 'хранятся в браузере' })
                ]), [
                    ui.presetList,
                    ui.presetSelect,
                    ui.presetSave,
                    h('div', { class: 'gpue-btnrow' }, [ui.presetLoad, ui.presetDel])
                ]),
                card('Файл', [
                    h('div', { class: 'gpue-btnrow' }, [ui.exportBtn, ui.importBtn]),
                    ui.importFile,
                    h('div', { class: 'gpue-hint', text: 'JSON-файл с положением, размером, скрытием, своими элементами и названиями. Формат совместим с версией 2.4.' })
                ]),
                h('div', { class: 'gpue-hint', text: 'Оформление (тема, картинки, шрифты) сохраняется отдельно: «Оформление» → «Сетапы оформления».' })
            ])
        ];
        ui.refTabSync = refTab ? refTab.sync : null;

        const body = h('div', { id: 'gpue-body' }, ui.pages);

        ui.panel = h('div', { id: 'gpue-panel', role: 'dialog', 'aria-label': 'Gartic UI Editor' }, [ui.head, bar, ui.tabs, body, ui.toasts]);

        document.body.appendChild(ui.hover);
        document.body.appendChild(ui.outline);
        document.body.appendChild(ui.btn);
        document.body.appendChild(ui.panel);

        renderElementList();
        setUiMode(state.uiMode, true);

        // Положение панели
        // Panel position
        const pos = state.panel || { left: Math.max(10, window.innerWidth - 390), top: 50 };
        placePanel(pos.left, pos.top);

        // --- События ----
        // --- Events ----
        ui.btn.addEventListener('click', togglePanel);
        ui.btn.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePanel(); }
        });
        ui.editBtn.addEventListener('click', () => setEditMode(!editMode));
        ui.parentBtn.addEventListener('click', selectParentOfCustom);
        ui.delBtn.addEventListener('click', deleteCustomElement);
        ui.renameBtn.addEventListener('click', renameSelected);
        ui.presetSave.addEventListener('click', savePreset);
        ui.presetLoad.addEventListener('click', loadPreset);
        ui.presetDel.addEventListener('click', deletePreset);
        ui.exportBtn.addEventListener('click', exportSetup);
        ui.importBtn.addEventListener('click', () => ui.importFile.click());
        ui.importFile.addEventListener('change', () => {
            const f = ui.importFile.files && ui.importFile.files[0];
            if (f) importSetupFile(f);
            ui.importFile.value = '';
        });
        refreshPresetSelect();
        ui.close.addEventListener('click', closePanel);
        ui.modeBtns.forEach(b => b.addEventListener('click', () => {
            if (state.uiMode === b.dataset.mode) return;
            setUiMode(b.dataset.mode);
            uiToast(state.uiMode === 'advanced' ? 'Расширенный режим: показаны все параметры' : 'Простой режим: в списке только основные элементы', 'info', 1800);
        }));
        ui.tabs.addEventListener('click', e => {
            const b = e.target.closest ? e.target.closest('button[data-tab]') : null;
            if (b) setTab(b.dataset.tab);
        });
        // ←/→ по вкладкам
        // ←/→ across tabs
        ui.tabs.addEventListener('keydown', e => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            const list = Array.from(ui.tabs.querySelectorAll('button[data-tab]'));
            const i = list.findIndex(b => b.dataset.tab === state.tab);
            const n = list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
            e.preventDefault();
            setTab(n.dataset.tab);
            n.focus();
        });
        setTab(state.tab, true);
        try {
            const syncTrans = () => {
                const on = !!GPAppearance.get('editor.transparent');
                ui.transBtn.classList.toggle('on', on);
                ui.transBtn.setAttribute('aria-pressed', String(on));
            };
            ui.transBtn.addEventListener('click', () => GPAppearance.toggleEditorTransparent());
            GPAppearance.onChange(syncTrans);
            syncTrans();
        } catch (e) { console.warn('[UI Layout Editor] кнопка прозрачности недоступна:', e); }
        ui.panel.addEventListener('keydown', e => e.stopPropagation());
        ui.panel.addEventListener('keyup', e => e.stopPropagation());
        // Нажатия внутри панели не доходят до обработчиков игры на document/window (всплытие).
        // Clicks inside the panel do not reach the game's handlers on document/window (bubbling).
        // Перехватчики фазы захвата редактора (режим редактирования, коррекция координат) уже
        // The editor's capture-phase interceptors (editing mode, coordinate correction) already
        // пропускают панель через isOurs. pointerup/mouseup не глушим: на них заканчивается
        // let the panel through via isOurs. pointerup/mouseup are not muted: they end
        // перетаскивание панели и линии на холсте.
        // the dragging of the panel and of lines on the canvas.
        ['pointerdown', 'mousedown', 'touchstart', 'click', 'dblclick', 'auxclick', 'contextmenu', 'wheel'].forEach(type =>
            ui.panel.addEventListener(type, e => e.stopPropagation(), { passive: true }));

        ui.select.addEventListener('change', () => {
            state.selected = ui.select.value;
            scheduleSave();
            refreshPanel();
        });
        ui.elList.addEventListener('click', e => {
            const row = e.target.closest ? e.target.closest('.gpue-ui-el') : null;
            if (row && ELEMENTS[row.dataset.key]) selectKey(row.dataset.key);
        });
        ui.elList.addEventListener('keydown', e => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            const keys = Object.keys(ui.elRows); // только видимые в текущем режиме строки | only the rows visible in the current mode
            const i = keys.indexOf(state.selected);
            const n = keys[clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, keys.length - 1)];
            e.preventDefault();
            selectKey(n);
            if (ui.elRows[n]) ui.elRows[n].row.focus();
        });

        // Числовые поля. Значение приводится к тем же границам и шагу, что давали ползунки.
        // Numeric fields. The value is clamped to the same bounds and step the sliders used.
        // (X/Y - целые px в RANGE.pos, W/H - % в RANGE.size), применение - через applyLayout как раньше.
        // (X/Y - integer px in RANGE.pos, W/H - % in RANGE.size), applied via applyLayout as before.
        const normNum = (prop, v) => {
            const r = NUM_PROPS[prop];
            v = (prop === 'x' || prop === 'y') ? Math.round(v) : Math.round(v * 10) / 10;
            return clamp(v, r.min, r.max);
        };
        const commitNum = (prop, v) => {
            const s = getEl(state.selected);
            s[prop] = normNum(prop, v);
            applyLayout();
            refreshValues();
            scheduleSave();
        };
        const bindNum = f => {
            const input = f.input, prop = f.prop;
            const normalize = () => { input.value = String(getEl(state.selected)[prop]); };
            input.addEventListener('input', () => {
                if (input.value.trim() === '') return;
                const v = Number(input.value);
                if (isFinite(v)) commitNum(prop, v);
            });
            input.addEventListener('change', normalize);
            input.addEventListener('blur', normalize);
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') { normalize(); input.select(); return; }
                if (e.key === 'Escape') { normalize(); input.blur(); return; }
                if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                e.preventDefault();
                const step = e.shiftKey ? 10 : 1;
                const cur = Number(getEl(state.selected)[prop]) || 0;
                commitNum(prop, cur + (e.key === 'ArrowUp' ? step : -step));
                normalize();
            });
            // колесо над полем в фокусе: ±1 (Shift ±10), страница при этом не прокручивается
            // wheel over a focused field: ±1 (Shift ±10), the page does not scroll meanwhile
            input.addEventListener('wheel', e => {
                if (document.activeElement !== input) return;
                e.preventDefault();
                const cur = Number(getEl(state.selected)[prop]) || 0;
                commitNum(prop, cur + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 10 : 1));
                normalize();
            }, { passive: false });
            // «Скраб»: тянуть подпись поля влево/вправо
            // "Scrub": drag the field label left/right
            let scrub = null;
            f.lab.addEventListener('pointerdown', e => {
                if (e.button !== 0) return;
                scrub = { x: e.clientX, v: Number(getEl(state.selected)[prop]) || 0 };
                try { f.lab.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
                e.preventDefault();
            });
            f.lab.addEventListener('pointermove', e => {
                if (!scrub) return;
                const k = e.shiftKey ? 5 : (prop === 'x' || prop === 'y' ? 1 : 0.5);
                commitNum(prop, scrub.v + (e.clientX - scrub.x) * k);
            });
            const endScrub = () => { if (!scrub) return; scrub = null; flushSave(); };
            f.lab.addEventListener('pointerup', endScrub);
            f.lab.addEventListener('pointercancel', endScrub);
        };
        [fx, fy, fw, fh].forEach(bindNum);

        ui.canvasScale.addEventListener('input', () => {
            const s = getEl('canvas');
            s.w = s.h = 100 + Number(ui.canvasScale.value);
            applyLayout();
            refreshValues();
            scheduleSave();
        });

        ui.hidden.addEventListener('change', () => {
            getEl(state.selected).hidden = ui.hidden.checked;
            applyLayout();
            clearTimeout(saveTimer);
            writeStore(state);
            updateElementList();
        });

        resetOne.addEventListener('click', () => {
            const key = state.selected;
            const before = state.elements[key] ? Object.assign({}, state.elements[key]) : null;
            if (isDefault(before)) { uiToast('Элемент уже в исходном состоянии', 'info', 1800); return; }
            delete state.elements[key];
            applyLayout();
            refreshPanel();
            scheduleSave();
            uiToast('«' + ELEMENTS[key].name + '» сброшен', 'ok', 0, {
                label: 'Вернуть',
                fn: () => {
                    if (!ELEMENTS[key]) return;
                    state.elements[key] = before;
                    applyLayout();
                    refreshPanel();
                    scheduleSave();
                }
            });
        });

        resetAll.addEventListener('click', async () => {
            const changed = Object.keys(state.elements).filter(k => !isDefault(state.elements[k]));
            if (!changed.length) { uiToast('Все элементы уже в исходном состоянии', 'info', 2000); return; }
            const ok = await uiDialog({
                title: 'Сбросить все настройки раскладки?',
                text: 'Изменённых элементов: ' + changed.length + '. Их положение, размер и видимость вернутся к исходным.\n\nПрофили, свои элементы, названия и оформление сохранятся.',
                okText: 'Сбросить всё',
                danger: true
            });
            if (!ok) return;
            const backup = JSON.parse(JSON.stringify(state.elements));
            state.elements = {};
            applyLayout();
            refreshPanel();
            scheduleSave();
            uiToast('Настройки раскладки сброшены', 'warn', 0, {
                label: 'Вернуть',
                fn: () => {
                    state.elements = {};
                    for (const k of Object.keys(backup)) if (ELEMENTS[k]) state.elements[k] = backup[k];
                    applyLayout();
                    refreshPanel();
                    scheduleSave();
                }
            });
        });

        // Перетаскивание панели за заголовок (кнопки заголовка не начинают перетаскивание)
        // Dragging the panel by its header (header buttons do not start dragging)
        let drag = null;
        ui.head.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            if (e.target.closest && e.target.closest('button')) return;
            const r = ui.panel.getBoundingClientRect();
            drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
            panelDragActive = true;
            e.preventDefault();
        });
        document.addEventListener('mousemove', e => {
            if (!drag) return;
            placePanel(e.clientX - drag.dx, e.clientY - drag.dy);
        });
        document.addEventListener('mouseup', () => {
            panelDragActive = false;
            if (!drag) return;
            drag = null;
            const r = ui.panel.getBoundingClientRect();
            state.panel = { left: r.left, top: r.top };
            scheduleSave();
        });

        window.addEventListener('resize', () => {
            if (!ui.panel.classList.contains('open')) return;
            const r = ui.panel.getBoundingClientRect();
            placePanel(r.left, r.top);
        });

        updateModeUi();
        refreshPanel();
    }

    function setTab(id, silent) {
        if (!['layout', 'appearance', 'draw', 'ref', 'profiles'].includes(id)) id = 'layout';
        const changed = state.tab !== id;
        state.tab = id;
        ui.tabs.querySelectorAll('button').forEach(b => {
            const on = b.dataset.tab === id;
            b.classList.toggle('on', on);
            b.setAttribute('aria-selected', String(on));
            b.tabIndex = on ? 0 : -1;
        });
        ui.pages.forEach(p => p.classList.toggle('on', p.dataset.tab === id));
        if (changed && !silent) {
            const body = document.getElementById('gpue-body');
            if (body) body.scrollTop = 0;
        }
        if (id === 'ref' && ui.refTabSync) ui.refTabSync();
        if (id === 'layout') { updateElementList(); scrollSelectedIntoList(); }
        if (!silent) scheduleSave();
    }

    function placePanel(left, top) {
        const pr = ui.panel.getBoundingClientRect();
        const w = pr.width || 380;
        const vh = window.innerHeight;
        left = Math.min(Math.max(0, left), Math.max(0, window.innerWidth - w));
        top = Math.min(Math.max(0, top), Math.max(0, vh - 60));
        // Панель не уходит за нижний край: высота ограничена местом под ней (содержимое прокручивается),
        // The panel does not go past the bottom edge: its height is limited by the space beneath it (the content scrolls),
        // а если места меньше разумного минимума - панель поднимается.
        // and if the space is less than a reasonable minimum - the panel is raised.
        const minH = Math.max(160, Math.min(340, vh - 16));
        if (vh - top - 8 < minH) top = Math.max(0, vh - minH - 8);
        ui.panel.style.left = left + 'px';
        ui.panel.style.top = top + 'px';
        ui.panel.style.maxHeight = Math.max(160, vh - top - 8) + 'px';
    }

    function togglePanel() {
        if (ui.panel.classList.contains('open')) closePanel();
        else openPanel();
    }

    function openPanel() {
        ui.panel.classList.add('open');
        // открытый редактор — кнопка ⚙ светится фиолетовым, как остальные активные
        // open editor - the ⚙ button glows purple, like the other active ones
        if (ui.btn) ui.btn.classList.add('gpue-on');
        refreshPanel();
        if (state.tab === 'ref' && ui.refTabSync) ui.refTabSync(); // окно референса создаётся после панели | the reference window is created after the panel
        ensureLoop();
        const r = ui.panel.getBoundingClientRect();
        placePanel(r.left, r.top);
        scrollSelectedIntoList();
    }

    function closePanel() {
        if (ui.dialogCancel) ui.dialogCancel();
        ui.panel.classList.remove('open');
        // панель закрыта — снимаем свечение (если не включён режим правки)
        // panel closed - remove the glow (unless edit mode is on)
        if (ui.btn && !editMode) ui.btn.classList.remove('gpue-on');
        ensureLoop();
    }

    // Обновляет отображаемые значения. Поле, в котором пользователь сейчас печатает, не перезаписывается.
    // Refreshes the displayed values. The field the user is currently typing in is not overwritten.
    function refreshValues() {
        const s = getEl(state.selected);
        const put = (input, v) => {
            if (!input || document.activeElement === input) return;
            const t = String(v);
            if (input.value !== t) input.value = t;
        };
        put(ui.x, s.x);
        put(ui.y, s.y);
        put(ui.w, s.w);
        put(ui.h, s.h);
        ui.canvasScaleVal.textContent = (s.w - 100) + '%';
        updateElementList();
    }

    let appearanceOnSelect = null; // хук модуля «Внешний вид»: вызывается после обновления панели (смена выбранного элемента) | the "Appearance" module's hook: called after the panel is refreshed (the selected element changed)

    function refreshPanel() {
        if (!ui.panel) return;
        const key = state.selected;
        const s = getEl(key);
        const isCanvas = key === 'canvas';

        ui.select.value = key;

        ui.x.value = s.x;
        ui.y.value = s.y;
        ui.w.value = s.w;
        ui.h.value = s.h;
        // Для канваса s.w/s.h могли отличаться из старых версий/сетапов — ползунок
        // For the canvas s.w/s.h could differ from old versions/setups - the slider
        // показывает большее из двух, а applyLayout приведёт оба к нему при следующем изменении.
        // shows the larger of the two, and applyLayout will bring both to it at the next change.
        ui.canvasScale.value = clamp(Math.round(Math.max(s.w, s.h) - 100), 0, 100);
        ui.hidden.checked = !!s.hidden;
        refreshValues();

        ui.whRow.style.display = isCanvas ? 'none' : '';
        ui.canvasScaleRow.style.display = isCanvas ? 'flex' : 'none';

        ui.statusSig = '';
        renderSelectedStatus();
        ui.warn.style.display = isCanvas ? 'block' : 'none';
        ui.customRow.style.display = ELEMENTS[key].custom ? 'flex' : 'none';
        scrollSelectedIntoList();
        if (typeof appearanceOnSelect === 'function') { try { appearanceOnSelect(); } catch (e) { /* не мешаем редактору */ } }
    }

    // Поддержка стиля при смене экранов игры и статус в панели
    // Keeping the style across game screen changes and the status in the panel
    function tick() {
        if (document.hidden) return;
        applyLayout();
        // страховка от потери перехвата между раундами/экранами (баг C)
        // insurance against losing the hook between rounds/screens (bug C)
        try { BrushSettings.tickCheck(); } catch (e) { /* не мешаем редактору */ }
        if (!ui.panel) return;
        if (ui.panel.classList.contains('open')) refreshPanelStatusOnly();
    }

    function refreshPanelStatusOnly() {
        renderSelectedStatus();
        updateElementList();
    }

    // =====================================================
    // Визуальный режим редактирования (мышью прямо на странице)
    // Visual editing mode (with the mouse, directly on the page)
    // Ничего не меняет в canvas: пока режим включён, события мыши
    // Changes nothing in the canvas: while the mode is on, mouse events
    // просто не доходят до игры, а элементы двигаются только через CSS.
    // simply do not reach the game, and elements move only via CSS.
    // =====================================================
    const HANDLE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    const STATE_CLASS = /^(jsx-.*|fade-.*|active|selected|sel|lock|locked|hover|focus|open|opened|show|shown|hide|hidden|disabled|on|off|visible|current)$/i;
    const lastMouse = { x: -1, y: -1, shift: false };
    let editDrag = null;
    let loopId = 0;

    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

    function isOurs(t) {
        return !!(t && t.closest && t.closest('#gpue-panel, #gpue-btn, #gpue-outline, #gpue-hover, #gpue-wheel, #gpue-wheel-btn, #gpue-ref, #gpue-ref-btn, #gpue-pickov, [id^="gpue-"]'));
    }

    // --- Список элементов ----
    // --- Element list ----
    function rebuildSelect() {
        if (!ui.select) return;
        ui.select.textContent = '';
        for (const key of Object.keys(ELEMENTS)) {
            ui.select.appendChild(h('option', { value: key, text: ELEMENTS[key].name }));
        }
        ui.select.value = state.selected;
        renderElementList();
    }

    function syncControls() {
        if (!ui.panel) return;
        const s = getEl(state.selected);
        ui.x.value = s.x;
        ui.y.value = s.y;
        ui.w.value = s.w;
        ui.h.value = s.h;
        if (state.selected === 'canvas') ui.canvasScale.value = clamp(Math.round(s.w - 100), 0, 100);
        refreshValues();
    }

    function selectKey(key) {
        if (!ELEMENTS[key]) return;
        state.selected = key;
        scheduleSave();
        if (ui.panel) {
            ui.select.value = key;
            refreshPanel();
        }
    }

    // --- Генерация CSS-селектора для неизвестного элемента ----
    // --- CSS selector generation for an unknown element ----
    function partFor(el) {
        if (el.id && !/\d{3,}/.test(el.id)) return '#' + CSS.escape(el.id);
        const classes = Array.from(el.classList)
            .filter(c => !/^gpue/.test(c) && !STATE_CLASS.test(c) && !/\d{3,}/.test(c))
            .slice(0, 3);
        return el.tagName.toLowerCase() + classes.map(c => '.' + CSS.escape(c)).join('');
    }

    function buildSelector(el) {
        const parts = [];
        let cur = el;
        for (let depth = 0; cur && cur.nodeType === 1 && cur !== document.body &&
                cur !== document.documentElement && depth < 8; depth++) {
            let part = partFor(cur);
            const parent = cur.parentElement;
            if (parent) {
                const siblings = Array.from(parent.children);
                let same = 0;
                try { same = siblings.filter(c => c.matches(part)).length; } catch (e) { same = 0; }
                if (same > 1) part += ':nth-child(' + (siblings.indexOf(cur) + 1) + ')';
            }
            parts.unshift(part);
            const sel = parts.join(' > ');
            try {
                const found = document.querySelectorAll(sel);
                if (found.length === 1 && found[0] === el) return sel;
            } catch (e) { /* пробуем выше по дереву */ }
            cur = parent;
        }
        return parts.length ? parts.join(' > ') : null;
    }

    function describeEl(el) {
        let d = el.tagName.toLowerCase();
        if (el.id) d += '#' + el.id;
        else if (el.classList.length) d += '.' + Array.from(el.classList).slice(0, 2).join('.');
        const txt = (el.textContent || '').trim().replace(/\s+/g, ' ');
        if (txt && txt.length <= 20) d += ' «' + txt + '»';
        return d;
    }

    function addCustomElement(el) {
        const selector = buildSelector(el);
        if (!selector) return null;
        for (const k of Object.keys(ELEMENTS)) {
            if (ELEMENTS[k].selector === selector) return k;
        }
        const id = 'custom_' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
        const name = '➕ ' + describeEl(el);
        ELEMENTS[id] = { name, selector, custom: true };
        state.custom[id] = { name, selector };
        rebuildSelect();
        scheduleSave();
        return id;
    }

    function selectParentOfCustom() {
        const key = state.selected;
        const def = ELEMENTS[key];
        if (!def || !def.custom) return;
        let el = null;
        try { el = document.querySelector(def.selector); } catch (e) { /* ignore */ }
        const p = el && el.parentElement;
        if (!p || p === document.body || p === document.documentElement) return;
        const sel = buildSelector(p);
        if (!sel) return;
        const name = '➕ ' + describeEl(p);
        def.selector = sel;
        def.name = name;
        state.custom[key] = { name, selector: sel };
        delete state.elements[key];
        rebuildSelect();
        applyLayout();
        refreshPanel();
        scheduleSave();
    }

    function deleteCustomElement() {
        const key = state.selected;
        if (!ELEMENTS[key] || !ELEMENTS[key].custom) return;
        uiToast('«' + ELEMENTS[key].name + '» убран из списка', 'info');
        delete ELEMENTS[key];
        delete state.custom[key];
        delete state.elements[key];
        state.selected = Object.keys(ELEMENTS)[0];
        rebuildSelect();
        applyLayout();
        refreshPanel();
        clearTimeout(saveTimer);
        writeStore(state);
    }

    // --- Переименование и сетапы (всё хранится локально) ----
    // --- Renaming and setups (everything is stored locally) ----
    const clampNum = (v, a, b, d) => { v = Number(v); return isFinite(v) ? Math.min(b, Math.max(a, v)) : d; };

    // Немедленная запись. Возвращает true, если хранилище приняло данные.
    // Immediate write. Returns true if the storage accepted the data.
    function flushSave() {
        clearTimeout(saveTimer);
        return writeStore(state);
    }

    function sanitizeElState(o) {
        o = o || {};
        return {
            x: Math.round(clampNum(o.x, RANGE.pos.min, RANGE.pos.max, 0)),
            y: Math.round(clampNum(o.y, RANGE.pos.min, RANGE.pos.max, 0)),
            w: clampNum(o.w, RANGE.size.min, RANGE.size.max, 100),
            h: clampNum(o.h, RANGE.size.min, RANGE.size.max, 100),
            hidden: !!o.hidden
        };
    }

    async function renameSelected() {
        const key = state.selected;
        const def = ELEMENTS[key];
        if (!def) return;
        let v = await uiDialog({
            title: 'Переименовать элемент',
            text: def.custom ? 'Новое название элемента:' : 'Новое название элемента. Оставьте поле пустым, чтобы вернуть исходное «' + def.defName + '».',
            input: { value: def.name, maxlength: 60, placeholder: def.custom ? 'Название' : def.defName },
            validate: s => (def.custom && !s.trim() ? 'Введите название.' : ''),
            okText: 'Переименовать'
        });
        if (v === null) return;
        if (ELEMENTS[key] !== def) return; // элемент удалили, пока был открыт диалог | the element was removed while the dialog was open
        v = v.trim().slice(0, 60);
        if (def.custom) {
            if (!v) return;
            def.name = v;
            if (state.custom[key]) state.custom[key].name = v;
        } else if (!v || v === def.defName) {
            def.name = def.defName;
            delete state.names[key];
        } else {
            def.name = v;
            state.names[key] = v;
        }
        rebuildSelect();
        refreshPanel();
        if (flushSave()) uiToast('Название сохранено', 'ok', 1800);
        else uiToast('Название изменено, но хранилище браузера не приняло данные', 'error');
    }

    function snapshotSetup() {
        return JSON.parse(JSON.stringify({
            elements: state.elements,
            custom: state.custom,
            names: state.names
        }));
    }

    function applySetup(setup) {
        // 1) пользовательские элементы
        // 1) user elements
        for (const id of Object.keys(ELEMENTS)) if (ELEMENTS[id].custom) delete ELEMENTS[id];
        state.custom = {};
        const c = setup.custom && typeof setup.custom === 'object' ? setup.custom : {};
        for (const id of Object.keys(c)) {
            const it = c[id];
            if (!/^custom_[a-z0-9]+$/i.test(id) || !it || typeof it.selector !== 'string' || !it.selector) continue;
            try { document.querySelector(it.selector); } catch (e) { continue; }
            const name = (typeof it.name === 'string' && it.name.trim() ? it.name.trim() : id).slice(0, 60);
            ELEMENTS[id] = { name, selector: it.selector, custom: true };
            state.custom[id] = { name, selector: it.selector };
        }
        // 2) названия встроенных элементов
        // 2) names of built-in elements
        state.names = {};
        const n = setup.names && typeof setup.names === 'object' ? setup.names : {};
        for (const k of Object.keys(ELEMENTS)) {
            if (ELEMENTS[k].custom) continue;
            const v = n[k];
            if (typeof v === 'string' && v.trim()) {
                ELEMENTS[k].name = v.trim().slice(0, 60);
                state.names[k] = ELEMENTS[k].name;
            } else {
                ELEMENTS[k].name = ELEMENTS[k].defName;
            }
        }
        // 3) положение / размер / скрытие
        // 3) position / size / hiding
        state.elements = {};
        const e = setup.elements && typeof setup.elements === 'object' ? setup.elements : {};
        for (const k of Object.keys(e)) if (ELEMENTS[k]) state.elements[k] = sanitizeElState(e[k]);
        if (!ELEMENTS[state.selected]) state.selected = Object.keys(ELEMENTS)[0];

        rebuildSelect();
        applyLayout();
        refreshPanel();
        return flushSave();
    }

    function refreshPresetSelect(selectName) {
        if (!ui.presetSelect) return;
        const prev = ui.presetSelect.value;
        const names = Object.keys(state.presets);
        ui.presetSelect.textContent = '';
        if (!names.length) ui.presetSelect.appendChild(h('option', { value: '', text: '— нет сохранённых сетапов —' }));
        for (const nm of names) ui.presetSelect.appendChild(h('option', { value: nm, text: nm }));
        if (selectName && state.presets[selectName]) ui.presetSelect.value = selectName;
        else if (prev && Object.prototype.hasOwnProperty.call(state.presets, prev)) ui.presetSelect.value = prev;
        renderPresetCards();
    }

    async function savePreset() {
        let name = await uiDialog({
            title: 'Сохранить профиль как…',
            text: 'Профиль хранит положение, размер и скрытие элементов, свои элементы и названия.',
            input: { value: ui.presetSelect.value || 'Мой профиль', maxlength: 40, placeholder: 'Название профиля' },
            validate: v => (v.trim() ? '' : 'Введите название профиля.'),
            okText: 'Сохранить'
        });
        if (name === null) return;
        name = name.trim().slice(0, 40).replace(/^(__proto__|constructor|prototype)$/, '_$1');
        if (!name) return;
        if (Object.prototype.hasOwnProperty.call(state.presets, name)) {
            const ok = await uiDialog({
                title: 'Перезаписать профиль?',
                text: 'Профиль «' + name + '» уже есть. Заменить его текущей раскладкой?',
                okText: 'Перезаписать',
                danger: true
            });
            if (!ok) return;
        }
        state.presets[name] = snapshotSetup();
        refreshPresetSelect(name);
        if (flushSave()) uiToast('Профиль «' + name + '» сохранён', 'ok');
        else uiToast('Не удалось записать профиль: хранилище браузера не приняло данные', 'error');
    }

    function loadPreset() {
        const name = ui.presetSelect.value;
        if (!name || !Object.prototype.hasOwnProperty.call(state.presets, name)) {
            uiToast('Выберите профиль в списке', 'warn', 2000);
            return;
        }
        const saved = applySetup(state.presets[name]);
        uiToast(saved ? 'Профиль «' + name + '» загружен' : 'Профиль применён, но хранилище браузера не приняло данные', saved ? 'ok' : 'error');
    }

    async function deletePreset() {
        const name = ui.presetSelect.value;
        if (!name || !Object.prototype.hasOwnProperty.call(state.presets, name)) {
            uiToast('Выберите профиль в списке', 'warn', 2000);
            return;
        }
        const ok = await uiDialog({
            title: 'Удалить профиль?',
            text: 'Профиль «' + name + '» будет удалён. Текущая раскладка не изменится.',
            okText: 'Удалить',
            danger: true
        });
        if (!ok || !Object.prototype.hasOwnProperty.call(state.presets, name)) return;
        delete state.presets[name];
        refreshPresetSelect();
        if (flushSave()) uiToast('Профиль «' + name + '» удалён', 'ok');
        else uiToast('Профиль удалён до перезагрузки: хранилище браузера не приняло данные', 'error');
    }

    function exportSetup() {
        const data = { app: 'gartic-phone-ui-layout-editor', version: 1, setup: snapshotSetup() };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        // ссылка внутри панели, чтобы режим редактирования не перехватил её click
        // a link inside the panel so that the editing mode does not capture its click
        const a = h('a', { href: url, download: 'gartic-ui-layout.json', style: 'display:none' });
        ui.panel.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        uiToast('Файл gartic-ui-layout.json передан браузеру для скачивания', 'info');
    }

    function importSetupFile(file) {
        const reader = new FileReader();
        reader.onload = async () => {
            let data = null;
            try { data = JSON.parse(String(reader.result)); } catch (e) { uiToast('Не удалось прочитать файл: это не JSON.', 'error'); return; }
            const setup = data && data.setup ? data.setup : data;
            if (!setup || typeof setup !== 'object' || (!setup.elements && !setup.custom && !setup.names)) {
                uiToast('Файл не похож на раскладку Gartic Phone UI Layout Editor.', 'error');
                return;
            }
            const ok = await uiDialog({
                title: 'Импортировать раскладку?',
                text: 'Текущая раскладка (положение, размер, скрытие, свои элементы и названия) будет заменена содержимым файла «' + (file.name || 'файл') + '».\n\nСохранённые профили не изменятся.',
                okText: 'Заменить',
                danger: true
            });
            if (!ok) return;
            const saved = applySetup(setup);
            uiToast(saved ? 'Раскладка импортирована' : 'Раскладка применена, но хранилище браузера не приняло данные', saved ? 'ok' : 'error');
        };
        reader.onerror = () => uiToast('Не удалось прочитать файл.', 'error');
        reader.readAsText(file);
    }

    // --- Что находится под курсором ----
    // --- What is under the cursor ----
    // exact = true (Shift): точный элемент под курсором, а не известный контейнер
    // exact = true (Shift): the exact element under the cursor, not a known container
    function resolveTarget(t, exact) {
        if (!t || t === document.body || t === document.documentElement || isOurs(t)) return null;
        let best = null;
        let bestArea = Infinity;
        for (const key of Object.keys(ELEMENTS)) {
            let m = null;
            try {
                m = exact ? (t.matches(ELEMENTS[key].selector) ? t : null) : t.closest(ELEMENTS[key].selector);
            } catch (e) { /* некорректный селектор */ }
            if (!m) continue;
            const r = m.getBoundingClientRect();
            const area = r.width * r.height;
            if (area < bestArea) { best = { key, el: m }; bestArea = area; }
        }
        return best || { key: null, el: t };
    }

    // --- Включение/выключение режима ----
    // --- Enabling/disabling the mode ----
    function updateModeUi() {
        if (!ui.editBtn) return;
        ui.editBtn.classList.toggle('gpue-on', editMode);
        ui.editBtn.setAttribute('aria-pressed', String(editMode));
        if (ui.editTitle) ui.editTitle.textContent = editMode ? 'Готово - выйти из настройки' : 'Настроить на экране';
        ui.editPill.textContent = editMode ? 'Режим включён · Esc - выйти' : 'Перетаскивайте элементы игры мышью';
        ui.btn.textContent = editMode ? '⚙ ✎' : '⚙';
        ui.btn.classList.toggle('gpue-ui-editing', editMode);
        // при выходе из режима правки свечение остаётся, пока панель открыта
        // when leaving edit mode the glow remains while the panel is open
        if (!editMode && ui.panel) ui.btn.classList.toggle('gpue-on', ui.panel.classList.contains('open'));
    }

    function setEditMode(on) {
        editMode = !!on;
        document.documentElement.classList.toggle('gpue-edit', editMode);
        endDrag();
        applyLayout();
        updateModeUi();
        ensureLoop();
    }

    // --- Подсветка и маркеры (обновляются каждый кадр, пока нужны) ----
    // --- Highlight and markers (refreshed every frame while needed) ----
    function ensureLoop() {
        if (!loopId) loopId = requestAnimationFrame(overlayLoop);
    }

    function overlayLoop() {
        loopId = 0;
        if (!ui.panel) return;
        if (document.hidden) { loopId = requestAnimationFrame(overlayLoop); return; }
        const panelOpen = ui.panel.classList.contains('open');
        if (!editMode && !panelOpen) {
            ui.outline.style.display = 'none';
            ui.hover.style.display = 'none';
            return;
        }
        updateSelection();
        updateHover();
        loopId = requestAnimationFrame(overlayLoop);
    }

    function placeBox(box, r) {
        box.style.display = 'block';
        box.style.left = r.left + 'px';
        box.style.top = r.top + 'px';
        box.style.width = r.width + 'px';
        box.style.height = r.height + 'px';
    }

    function updateSelection() {
        const def = ELEMENTS[state.selected];
        const el = def && findVisible(def.selector);
        if (!el) {
            ui.outline.style.display = 'none';
            return;
        }
        const r = el.getBoundingClientRect();
        placeBox(ui.outline, r);
        ui.outline.classList.toggle('editing', editMode);
        if (editMode) {
            const s = getEl(state.selected);
            const label = `${def.name} · X ${Math.round(s.x)} Y ${Math.round(s.y)} · ${s.w}% × ${s.h}%`;
            if (ui.outlineLabel.textContent !== label) ui.outlineLabel.textContent = label;
            ui.outlineLabel.classList.toggle('in', r.top < 22);
        }
    }

    function updateHover() {
        if (!editMode || editDrag) { ui.hover.style.display = 'none'; return; }
        const t = document.elementFromPoint(lastMouse.x, lastMouse.y);
        const res = resolveTarget(t, lastMouse.shift);
        if (!res) { ui.hover.style.display = 'none'; return; }
        const r = res.el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) { ui.hover.style.display = 'none'; return; }
        const known = !!res.key;
        ui.hover.classList.toggle('new', !known);
        const label = known ? ELEMENTS[res.key].name : '➕ ' + describeEl(res.el) + ' (новый)';
        if (ui.hoverLabel.textContent !== label) ui.hoverLabel.textContent = label;
        ui.hoverLabel.classList.toggle('in', r.top < 22);
        placeBox(ui.hover, r);
    }

    // --- Перетаскивание и изменение размера ----
    // --- Dragging and resizing ----
    // Игра масштабирует весь экран через transform: scale(...) на предке, поэтому
    // The game scales the whole screen via transform: scale(...) on an ancestor, so
    // 1 px translate на экране != 1 px мыши. Считаем масштаб предков отдельно по осям.
    // 1 px of translate on the screen != 1 px of mouse. We compute the ancestors' scale separately per axis.
    function ancestorScale(el, s) {
        let kx = 1, ky = 1;
        const r = el.getBoundingClientRect();
        if (el.offsetWidth > 0 && s.w > 0 && r.width > 0) kx = r.width / (el.offsetWidth * s.w / 100);
        if (el.offsetHeight > 0 && s.h > 0 && r.height > 0) ky = r.height / (el.offsetHeight * s.h / 100);
        const ok = k => isFinite(k) && k > 0.05 && k < 20;
        return { kx: ok(kx) ? kx : 1, ky: ok(ky) ? ky : 1 };
    }

    function startMove(e, key) {
        const s = getEl(key);
        const el = findVisible(ELEMENTS[key].selector);
        const k = el ? ancestorScale(el, s) : { kx: 1, ky: 1 };
        editDrag = { type: 'move', key, px: e.clientX, py: e.clientY, sx: s.x, sy: s.y, kx: k.kx, ky: k.ky };
    }

    function startResize(e, dir) {
        const key = state.selected;
        const el = findVisible(ELEMENTS[key].selector);
        if (!el) return;
        const s = getEl(key);
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || s.w <= 0 || s.h <= 0) return;
        const k = ancestorScale(el, s);
        editDrag = {
            type: 'resize', dir, key, kx: k.kx, ky: k.ky,
            px: e.clientX, py: e.clientY,
            sx: s.x, sy: s.y, sw: s.w, sh: s.h,
            rw: r.width, rh: r.height
        };
        e.preventDefault();
    }

    function endDrag() {
        if (!editDrag) return;
        editDrag = null;
        clearTimeout(saveTimer);
        writeStore(state);
    }

    function onPointerDown(e) {
        if (!editMode) return;
        const t = e.target;
        if (t && t.classList && t.classList.contains('gpue-handle')) {
            if (e.button === 0) startResize(e, t.getAttribute('data-dir'));
            return;
        }
        if (isOurs(t)) return;
        e.stopImmediatePropagation();
        if (e.button !== 0) return;
        const res = resolveTarget(t, e.shiftKey);
        if (!res) return;
        const key = res.key || addCustomElement(res.el);
        if (!key) return;
        selectKey(key);
        startMove(e, key);
        ensureLoop();
    }

    function onPointerMove(e) {
        lastMouse.x = e.clientX;
        lastMouse.y = e.clientY;
        lastMouse.shift = e.shiftKey;
        if (!editDrag) return;
        if (e.buttons === 0) { endDrag(); return; }
        e.stopImmediatePropagation();

        const d = editDrag;
        const s = getEl(d.key);
        const dx = e.clientX - d.px;
        const dy = e.clientY - d.py;
        const P = RANGE.pos;
        const Z = RANGE.size;

        if (d.type === 'move') {
            s.x = clamp(Math.round(d.sx + dx / d.kx), P.min, P.max);
            s.y = clamp(Math.round(d.sy + dy / d.ky), P.min, P.max);
        } else {
            const natW = d.rw * 100 / d.sw;
            const natH = d.rh * 100 / d.sh;
            let nx = d.sx, ny = d.sy, nw = d.sw, nh = d.sh;

            if (d.dir.includes('e') || d.dir.includes('w')) {
                const west = d.dir.includes('w');
                const rw = clamp(d.rw + (west ? -dx : dx), natW * Z.min / 100, natW * Z.max / 100);
                nw = Math.round(rw / natW * 1000) / 10;
                if (west) nx = clamp(Math.round(d.sx + (d.rw - rw) / d.kx), P.min, P.max);
            }
            if (d.dir.includes('n') || d.dir.includes('s')) {
                const north = d.dir.includes('n');
                const rh = clamp(d.rh + (north ? -dy : dy), natH * Z.min / 100, natH * Z.max / 100);
                nh = Math.round(rh / natH * 1000) / 10;
                if (north) ny = clamp(Math.round(d.sy + (d.rh - rh) / d.ky), P.min, P.max);
            }
            if (d.key === 'canvas') {
                // Холст всегда растёт пропорционально (как ползунок «Размер холста»,
                // The canvas always grows proportionally (like the "Canvas size" slider,
                // диапазон 100..200 = 0..100%): берём измерение той стороны, за которую
                // range 100..200 = 0..100%): we take the measurement of the side being dragged
                // тянут, и применяем его к обеим осям.
                // and apply it to both axes.
                const changed = (d.dir.includes('e') || d.dir.includes('w')) ? nw : nh;
                nw = nh = clamp(Math.round(changed), 100, 200);
            }

            s.x = nx; s.y = ny; s.w = nw; s.h = nh;
        }

        applyLayout();
        syncControls();
        scheduleSave();
    }

    function onPointerUp(e) {
        if (!editDrag) return;
        e.stopImmediatePropagation();
        endDrag();
    }

    // Пока режим включён, остальные события мыши/касаний игре не передаются
    // While the mode is on, the other mouse/touch events are not passed to the game
    const BLOCKED = ['mousedown', 'click', 'dblclick', 'auxclick', 'contextmenu',
                     'touchstart', 'touchend', 'dragstart', 'selectstart'];
    BLOCKED.forEach(type => {
        window.addEventListener(type, e => {
            if (!editMode || isOurs(e.target)) return;
            e.preventDefault();
            e.stopImmediatePropagation();
        }, { capture: true, passive: false });
    });

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('blur', endDrag);
    window.addEventListener('keydown', e => {
        lastMouse.shift = e.shiftKey;
        if (editMode && e.key === 'Escape') {
            e.stopImmediatePropagation();
            setEditMode(false);
        }
    }, true);
    window.addEventListener('keyup', e => { lastMouse.shift = e.shiftKey; }, true);

    // =====================================================
    // Цветовой круг: кольцо оттенка + треугольник насыщенность/яркость (как в Krita)
    // Color wheel: a hue ring + a saturation/brightness triangle (like in Krita)
    // Меняет ТОЛЬКО значение штатного <input type="color"> игры. Canvas, кисть,
    // Changes ONLY the value of the game's stock <input type="color">. The canvas, brush,
    // координаты мыши и рисование не затрагиваются.
    // mouse coordinates and drawing are not touched.
    // =====================================================
    const WHEEL = { hue: 0, sat: 1, val: 1 };
    let wheelUi = null;
    let wheelFrame = 0;

    function hsv2rgb(h, s, v) {
        h = ((h % 360) + 360) % 360;
        const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
        let r = 0, g = 0, b = 0;
        if (h < 60) { r = c; g = x; }
        else if (h < 120) { r = x; g = c; }
        else if (h < 180) { g = c; b = x; }
        else if (h < 240) { g = x; b = c; }
        else if (h < 300) { r = x; b = c; }
        else { r = c; b = x; }
        return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
    }

    function rgb2hsv(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        let h = 0;
        if (d) {
            if (mx === r) h = ((g - b) / d) % 6;
            else if (mx === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60;
            if (h < 0) h += 360;
        }
        return [h, mx ? d / mx : 0, mx];
    }

    function toHex(rgb) {
        return '#' + rgb.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
    }

    function parseHex(str) {
        const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(str).trim());
        if (!m) return null;
        let x = m[1];
        if (x.length === 3) x = x.split('').map(c => c + c).join('');
        return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
    }

    // Геометрия в пикселях холста N x N: кольцо + вписанный треугольник
    // Geometry in pixels of an N x N canvas: a ring + an inscribed triangle
    // (сверху - чёрный, слева внизу - белый, справа внизу - чистый оттенок)
    // (top - black, bottom left - white, bottom right - pure hue)
    function wheelGeom(N) {
        const cx = N / 2, cy = N / 2;
        const outer = N / 2 - 2, inner = outer - N * 0.105;
        const tr = inner - N * 0.03;
        const pt = a => [cx + tr * Math.cos(a * Math.PI / 180), cy + tr * Math.sin(a * Math.PI / 180)];
        return { cx, cy, outer, inner, tr, black: pt(-90), hue: pt(30), white: pt(150) };
    }

    // Барицентрические веса точки: [чистый оттенок, белый, чёрный]
    // Barycentric weights of a point: [pure hue, white, black]
    function baryWeights(g, x, y) {
        const [x1, y1] = g.hue, [x2, y2] = g.white, [x3, y3] = g.black;
        const den = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
        const wh = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / den;
        const ww = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / den;
        return [wh, ww, 1 - wh - ww];
    }

    const hueFromAngle = deg => (deg + 360 + 180) % 360;

    function buildRing(N) {
        const g = wheelGeom(N);
        const cv = document.createElement('canvas');
        cv.width = cv.height = N;
        const ctx = cv.getContext('2d');
        const img = ctx.createImageData(N, N);
        const d = img.data;
        for (let y = 0; y < N; y++) {
            for (let x = 0; x < N; x++) {
                const dx = x + 0.5 - g.cx, dy = y + 0.5 - g.cy;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const a = Math.min(1, Math.max(0, g.outer - dist + 0.5)) * Math.min(1, Math.max(0, dist - g.inner + 0.5));
                if (a <= 0) continue;
                const rgb = hsv2rgb(hueFromAngle(Math.atan2(dy, dx) * 180 / Math.PI), 1, 1);
                const i = (y * N + x) * 4;
                d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = a * 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        return cv;
    }

    function buildTriangle(N, hue) {
        const g = wheelGeom(N);
        const cv = document.createElement('canvas');
        cv.width = cv.height = N;
        const ctx = cv.getContext('2d');
        const img = ctx.createImageData(N, N);
        const d = img.data;
        const H = hsv2rgb(hue, 1, 1);
        const height = 1.5 * g.tr;
        for (let y = 0; y < N; y++) {
            for (let x = 0; x < N; x++) {
                const [wh, ww, wb] = baryWeights(g, x + 0.5, y + 0.5);
                const a = Math.min(1, Math.max(0, Math.min(wh, ww, wb) * height + 0.5));
                if (a <= 0) continue;
                const cwh = Math.max(0, wh), cww = Math.max(0, ww);
                const i = (y * N + x) * 4;
                d[i] = cwh * H[0] + cww * 255;
                d[i + 1] = cwh * H[1] + cww * 255;
                d[i + 2] = cwh * H[2] + cww * 255;
                d[i + 3] = a * 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        return cv;
    }

    function drawMarker(ctx, x, y, r) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(2, r * 0.4);
        ctx.strokeStyle = '#000';
        ctx.stroke();
        ctx.lineWidth = Math.max(1, r * 0.2);
        ctx.strokeStyle = '#fff';
        ctx.stroke();
    }

    function drawWheel() {
        if (!wheelUi) return;
        const cv = wheelUi.canvas, N = cv.width, ctx = cv.getContext('2d');
        const g = wheelGeom(N);
        ctx.clearRect(0, 0, N, N);
        ctx.drawImage(wheelUi.ring, 0, 0);
        const key = Math.round(WHEEL.hue * 2);
        if (wheelUi.triKey !== key) { wheelUi.tri = buildTriangle(N, WHEEL.hue); wheelUi.triKey = key; }
        ctx.drawImage(wheelUi.tri, 0, 0);

        const r = Math.max(4, N * 0.022);
        const ang = (WHEEL.hue + 180) * Math.PI / 180, mid = (g.outer + g.inner) / 2;
        drawMarker(ctx, g.cx + mid * Math.cos(ang), g.cy + mid * Math.sin(ang), r);

        const wh = WHEEL.sat * WHEEL.val, ww = WHEEL.val * (1 - WHEEL.sat), wb = 1 - WHEEL.val;
        drawMarker(ctx,
            wh * g.hue[0] + ww * g.white[0] + wb * g.black[0],
            wh * g.hue[1] + ww * g.white[1] + wb * g.black[1], r);
    }

    function scheduleWheelDraw() {
        if (wheelFrame) return;
        wheelFrame = requestAnimationFrame(() => { wheelFrame = 0; drawWheel(); });
    }

    function wheelHex() {
        return toHex(hsv2rgb(WHEEL.hue, WHEEL.sat, WHEEL.val));
    }

    function syncWheelUi(skipHexField) {
        if (!wheelUi) return;
        const hex = wheelHex();
        wheelUi.swatch.style.background = hex;
        if (!skipHexField) wheelUi.hex.value = hex;
        palMark();
    }

    function gameColorInput() {
        return document.querySelector('.draw .colors input[type="color"]');
    }

    function readGameColor() {
        const input = gameColorInput();
        const rgb = input && parseHex(input.value);
        if (!rgb) return false;
        setWheelFromRgb(rgb);
        return true;
    }

    function setWheelFromRgb(rgb) {
        const [h, s, v] = rgb2hsv(rgb[0], rgb[1], rgb[2]);
        if (s > 0 && v > 0) WHEEL.hue = h;
        WHEEL.sat = s;
        WHEEL.val = v;
        syncWheelUi();
        scheduleWheelDraw();
    }

    // Выставляем цвет штатному полю игры так, чтобы его увидел React (через нативный setter + input/change)
    // We set the color of the game's stock field so that React sees it (via the native setter + input/change)
    function applyColorToGame(hex) {
        const input = gameColorInput();
        if (!input) return false;
        const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        if (desc && desc.set) desc.set.call(input, hex); else input.value = hex;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    function wheelPointer(e, mode) {
        const cv = wheelUi.canvas, N = cv.width, g = wheelGeom(N);
        const rect = cv.getBoundingClientRect();
        const k = rect.width ? N / rect.width : 1;
        const x = (e.clientX - rect.left) * k, y = (e.clientY - rect.top) * k;
        if (mode === 'hue') {
            WHEEL.hue = hueFromAngle(Math.atan2(y - g.cy, x - g.cx) * 180 / Math.PI);
        } else {
            let [wh, ww, wb] = baryWeights(g, x, y);
            wh = Math.max(0, wh); ww = Math.max(0, ww); wb = Math.max(0, wb);
            const sum = (wh + ww + wb) || 1;
            wh /= sum; ww /= sum; wb /= sum;
            WHEEL.val = wh + ww;
            if (WHEEL.val > 0) WHEEL.sat = wh / WHEEL.val;
        }
        syncWheelUi();
        scheduleWheelDraw();
    }

    function wheelHitMode(e) {
        const cv = wheelUi.canvas, N = cv.width, g = wheelGeom(N);
        const rect = cv.getBoundingClientRect();
        const k = rect.width ? N / rect.width : 1;
        const dx = (e.clientX - rect.left) * k - g.cx, dy = (e.clientY - rect.top) * k - g.cy;
        return Math.sqrt(dx * dx + dy * dy) > g.inner ? 'hue' : 'sv';
    }

    function toggleWheel() {
        if (!wheelUi) return;
        const open = !wheelUi.root.classList.contains('open');
        wheelUi.root.classList.toggle('open', open);
        // активная кнопка светится фиолетовым
        // the active button glows purple
        const wb = document.getElementById('gpue-wheel-btn');
        if (wb) wb.classList.toggle('gpue-on', open);
        if (open) {
            readGameColor();
            scheduleWheelDraw();
            const r = wheelUi.root.getBoundingClientRect();
            placeWheel(r.left, r.top);
        }
    }

    function placeWheel(left, top) {
        const w = wheelUi.root.offsetWidth || 244, hgt = wheelUi.root.offsetHeight || 320;
        left = Math.min(Math.max(0, left), Math.max(0, window.innerWidth - w));
        top = Math.min(Math.max(0, top), Math.max(0, window.innerHeight - Math.min(hgt, 60)));
        wheelUi.root.style.left = left + 'px';
        wheelUi.root.style.top = top + 'px';
    }

    // --------- Пипетка и палитра (дополнение к цветовому кругу) ----------
    // --------- Eyedropper and palette (a companion to the color wheel) ----------
    const PALETTE_MAX = 256;
    let palStatTimer = 0;

    function palCfg() {
        if (!Array.isArray(state.palette)) state.palette = [];
        return state.palette;
    }

    function palStat(text, isErr) {
        if (!wheelUi) return;
        wheelUi.stat.textContent = text || '';
        wheelUi.stat.classList.toggle('err', !!isErr);
        clearTimeout(palStatTimer);
        if (text) palStatTimer = setTimeout(() => { if (wheelUi) wheelUi.stat.textContent = ''; }, 5000);
    }

    function palMark() {
        if (!wheelUi || !wheelUi.palMap) return;
        if (wheelUi.palCur) wheelUi.palCur.classList.remove('cur');
        const el = wheelUi.palMap.get(wheelHex());
        if (el) el.classList.add('cur');
        wheelUi.palCur = el || null;
    }

    function palRender() {
        if (!wheelUi) return;
        wheelUi.pal.textContent = '';
        wheelUi.palMap = new Map();
        wheelUi.palCur = null;
        for (const hex of palCfg()) {
            const el = h('div', { class: 'gpue-wc', title: hex });
            el.dataset.hex = hex;
            el.style.background = hex;
            wheelUi.pal.appendChild(el);
            wheelUi.palMap.set(hex, el);
        }
        palMark();
    }

    // Добавляет цвета (без повторов). Возвращает, сколько реально добавлено.
    // Adds colors (no duplicates). Returns how many were actually added.
    function palAddMany(list) {
        const cur = palCfg();
        let added = 0;
        for (const hex of list) {
            if (cur.length >= PALETTE_MAX) break;
            if (!cur.includes(hex)) { cur.push(hex); added++; }
        }
        if (added) { scheduleSave(); palRender(); }
        return added;
    }

    function palRemove(hex) {
        const cur = palCfg();
        const i = cur.indexOf(hex);
        if (i < 0) return;
        cur.splice(i, 1);
        scheduleSave();
        palRender();
    }

    // Разбор файла палитры: JSON, GPL (GIMP/Krita), а также любой текст со значениями #RRGGBB
    // Palette file parsing: JSON, GPL (GIMP/Krita), and any text with #RRGGBB values
    function parsePaletteText(text) {
        const out = [];
        const push = v => { const rgb = typeof v === 'string' ? parseHex(v) : null; if (rgb) out.push(toHex(rgb)); };
        const t = String(text).replace(/^\uFEFF/, '');
        let data = null;
        try { data = JSON.parse(t); } catch (e) { data = null; }
        if (data && typeof data === 'object') {
            const arr = Array.isArray(data) ? data
                : Array.isArray(data.colors) ? data.colors
                : Array.isArray(data.palette) ? data.palette : [];
            for (const it of arr) {
                if (typeof it === 'string') push(it);
                else if (Array.isArray(it) && it.length >= 3) {
                    const rgb = it.slice(0, 3).map(Number);
                    if (rgb.every(n => Number.isFinite(n))) out.push(toHex(rgb));
                }
                else if (it && typeof it === 'object') push(it.hex || it.color || '');
            }
            return out;
        }
        if (/^\s*GIMP Palette/i.test(t)) {
            for (const line of t.split(/\r?\n/)) {
                const m = /^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s|$)/.exec(line);
                if (m) out.push(toHex([+m[1], +m[2], +m[3]]));
            }
            return out;
        }
        const re = /#([0-9a-f]{6})\b|#([0-9a-f]{3})\b|^\s*([0-9a-f]{6})\s*$/gim;
        let m;
        while ((m = re.exec(t))) push('#' + (m[1] || m[2] || m[3]));
        return out;
    }

    function palExportText(fmt) {
        const cols = palCfg();
        if (fmt === 'gpl') {
            const rows = cols.map(hx => {
                const [r, g, b] = parseHex(hx);
                return String(r).padStart(3) + ' ' + String(g).padStart(3) + ' ' + String(b).padStart(3) + '\t' + hx.toUpperCase();
            });
            return 'GIMP Palette\nName: Gartic Phone\nColumns: 8\n#\n' + rows.join('\n') + '\n';
        }
        if (fmt === 'hex') return cols.map(c => c.toUpperCase()).join('\n') + '\n';
        return JSON.stringify({ name: 'Gartic Phone', colors: cols }, null, 2) + '\n';
    }

    function downloadText(name, text, mime) {
        const url = URL.createObjectURL(new Blob([text], { type: mime }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
    }

    // Цвет пикселя под точкой экрана: сначала картинка референса (без учёта её прозрачности), затем canvas'ы страницы
    // Color of the pixel at a screen point: first the reference image (ignoring its opacity), then the page canvases
    function sampleScreenColor(x, y) {
        const tmp = document.createElement('canvas');
        tmp.width = tmp.height = 1;
        const tctx = tmp.getContext('2d', { willReadFrequently: true });
        const grab = (src, sx, sy) => {
            try {
                tctx.clearRect(0, 0, 1, 1);
                tctx.drawImage(src, sx, sy, 1, 1, 0, 0, 1, 1);
                const d = tctx.getImageData(0, 0, 1, 1).data;
                if (!d[3]) return null;
                const a = d[3] / 255;
                return [d[0] * a + 255 * (1 - a), d[1] * a + 255 * (1 - a), d[2] * a + 255 * (1 - a)];
            } catch (e) { return null; } // чужая картинка без CORS "пачкает" canvas | a foreign image without CORS "taints" the canvas
        };
        const inside = (r) => x >= r.left && x < r.right && y >= r.top && y < r.bottom;
        if (refUi && refUi.root.classList.contains('open') && REF.nw && refUi.img.style.display !== 'none') {
            const r = refUi.img.getBoundingClientRect();
            if (inside(r) && inside(refUi.vp.getBoundingClientRect())) {
                const c = grab(refUi.img, Math.floor((x - r.left) / r.width * REF.nw), Math.floor((y - r.top) / r.height * REF.nh));
                if (c) return c;
            }
        }
        for (const el of document.elementsFromPoint(x, y)) {
            if (!(el instanceof HTMLCanvasElement) || isOurs(el)) continue;
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) continue;
            const c = grab(el, Math.floor((x - r.left) * el.width / r.width), Math.floor((y - r.top) * el.height / r.height));
            if (c) return c;
        }
        return null;
    }

    function takePickedColor(rgb) {
        setWheelFromRgb(rgb.map(v => Math.round(v)));
        applyColorToGame(wheelHex());
    }

    // Запасной вариант для браузеров без EyeDropper (Firefox): клик по холсту/референсу
    // Fallback for browsers without EyeDropper (Firefox): a click on the canvas/reference
    function pickColorFallback() {
        const ov = h('div', { id: 'gpue-pickov', style: 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;cursor:crosshair' });
        const tip = h('div', { style: 'position:fixed;pointer-events:none;padding:3px 8px;font:12px monospace;color:#fff;background:#111;border:1px solid #fff;border-left-width:14px;border-radius:6px;white-space:nowrap' });
        ov.appendChild(tip);
        document.body.appendChild(ov);
        const onKey = e => {
            if (e.key !== 'Escape') return;
            e.stopImmediatePropagation();
            done();
        };
        const done = () => { ov.remove(); window.removeEventListener('keydown', onKey, true); };
        window.addEventListener('keydown', onKey, true);
        ov.addEventListener('pointermove', e => {
            const c = sampleScreenColor(e.clientX, e.clientY);
            tip.style.left = (e.clientX + 16) + 'px';
            tip.style.top = (e.clientY + 16) + 'px';
            tip.textContent = c ? toHex(c) : '—';
            tip.style.borderLeftColor = c ? toHex(c) : '#111';
        });
        ov.addEventListener('click', e => {
            const c = sampleScreenColor(e.clientX, e.clientY);
            done();
            if (c) takePickedColor(c);
        });
    }

    async function pickScreenColor() {
        if (typeof window.EyeDropper === 'function') {
            try {
                const res = await new window.EyeDropper().open();
                const rgb = parseHex(res && res.sRGBHex);
                if (rgb) takePickedColor(rgb);
            } catch (e) { /* отмена (Esc) */ }
            return;
        }
        pickColorFallback();
    }

    const WHEEL_CSS = `
#gpue-wheel-btn{position:fixed;top:8px;right:96px;z-index:2147483646;padding:6px 9px;background:#2b2b3d;color:#fff;
  border:1px solid #6b6b9a;border-radius:8px;font:600 13px/1 Arial,sans-serif;cursor:pointer;opacity:.85}
#gpue-wheel-btn:hover{opacity:1}
#gpue-wheel{position:fixed;z-index:2147483647;width:244px;background:#1e1e2e;color:#eee;border:1px solid #6b6b9a;
  border-radius:10px;font:13px/1.4 Arial,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5);display:none;user-select:none}
#gpue-wheel.open{display:block}
#gpue-wheel-head{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#2b2b3d;
  border-radius:10px 10px 0 0;cursor:move;font-weight:700;touch-action:none}
#gpue-wheel-close{cursor:pointer;padding:0 4px;font-size:16px}
#gpue-wheel-body{padding:10px;display:flex;flex-direction:column;gap:8px;align-items:center}
#gpue-wheel canvas{width:220px;height:220px;touch-action:none;cursor:crosshair}
#gpue-wheel .gpue-wrow{display:flex;gap:6px;align-items:center;width:100%}
#gpue-wheel .gpue-wsw{width:28px;height:28px;border-radius:6px;border:1px solid #888;flex:none}
#gpue-wheel input[type=text]{flex:1;min-width:0;padding:5px;background:#12121c;color:#eee;border:1px solid #444;
  border-radius:5px;font:13px monospace;user-select:text}
#gpue-wheel button{padding:5px 8px;background:#3a3a55;color:#fff;border:1px solid #6b6b9a;border-radius:6px;cursor:pointer}
#gpue-wheel button:hover{background:#4a4a70}
html.gpue-edit #gpue-wheel, html.gpue-edit #gpue-wheel *{cursor:default !important}
html.gpue-edit #gpue-wheel canvas{cursor:crosshair !important}
html.gpue-edit #gpue-wheel button, html.gpue-edit #gpue-wheel-btn, html.gpue-edit #gpue-wheel-close{cursor:pointer !important}
html.gpue-edit #gpue-wheel-head, html.gpue-edit #gpue-wheel-head span:first-child{cursor:move !important}
html.gpue-edit #gpue-wheel input{cursor:text !important;user-select:text !important}
#gpue-wheel .gpue-wtools{display:flex;gap:6px;align-items:center;width:100%;flex-wrap:wrap}
#gpue-wheel .gpue-wtools button{padding:4px 8px}
#gpue-wheel button.on{background:#5a5a9a;border-color:#8fa8ff}
#gpue-wheel .gpue-wpal{display:flex;flex-wrap:wrap;gap:4px;width:100%;max-height:112px;overflow-y:auto;padding:3px;
  box-sizing:border-box;min-height:28px;border:1px dashed #44445a;border-radius:6px}
#gpue-wheel .gpue-wpal:empty::before{content:'Палитра пуста: нажмите ＋';color:#889;font-size:11px;padding:3px}
#gpue-wheel .gpue-wc{width:22px;height:22px;border-radius:4px;border:1px solid #666;cursor:pointer;flex:none;box-sizing:border-box}
#gpue-wheel .gpue-wc.cur{outline:2px solid #fff;outline-offset:1px}
#gpue-wheel .gpue-wpal.del .gpue-wc{outline:2px dashed #ff6b6b;outline-offset:1px}
#gpue-wheel .gpue-wstat{width:100%;font-size:11px;color:#aab;min-height:14px;text-align:left}
#gpue-wheel .gpue-wstat.err{color:#ff8a8a}
#gpue-wheel select{padding:4px;background:#12121c;color:#eee;border:1px solid #444;border-radius:5px}
html.gpue-edit #gpue-wheel .gpue-wc, html.gpue-edit #gpue-wheel select{cursor:pointer !important}
`;

    function buildWheel() {
        if (document.getElementById('gpue-wheel-btn')) return;
        const style = document.createElement('style');
        style.textContent = WHEEL_CSS;
        document.head.appendChild(style);

        const dpr = Math.min(3, window.devicePixelRatio || 1);
        const N = Math.round(220 * dpr);
        const canvas = h('canvas', { width: N, height: N });
        const swatch = h('div', { class: 'gpue-wsw' });
        const hex = h('input', { type: 'text', maxlength: '7', spellcheck: 'false', value: '#000000' });
        const pick = h('button', { text: '↻', title: 'Взять текущий цвет из игры' });
        const closeBtn = h('span', { id: 'gpue-wheel-close', text: '✕' });
        const head = h('div', { id: 'gpue-wheel-head' }, [h('span', { text: '🎨 Цветовой круг' }), closeBtn]);
        const bDrop = h('button', { text: '💧', title: 'Пипетка: взять цвет с экрана (рисунок, референс)' });
        const bAdd = h('button', { text: '＋', title: 'Сохранить текущий цвет в палитру' });
        const bDel = h('button', { text: '🗑', title: 'Режим удаления: клик по цвету удаляет его (правый клик удаляет всегда)' });
        const bClr = h('button', { text: '🧹', title: 'Очистить всю палитру' });
        const pal = h('div', { class: 'gpue-wpal' });
        const bImp = h('button', { text: '📥 Импорт', title: 'Загрузить палитру: JSON, GPL (GIMP/Krita), HEX/TXT' });
        const bExp = h('button', { text: '📤 Экспорт', title: 'Сохранить палитру в файл' });
        const fmt = h('select', { title: 'Формат экспорта' }, [
            h('option', { value: 'json', text: 'JSON' }),
            h('option', { value: 'gpl', text: 'GPL' }),
            h('option', { value: 'hex', text: 'HEX' })
        ]);
        const fileIn = h('input', { type: 'file', accept: '.json,.gpl,.hex,.txt,.css,.csv,text/plain,application/json', style: 'display:none' });
        const stat = h('div', { class: 'gpue-wstat' });
        const body = h('div', { id: 'gpue-wheel-body' }, [
            canvas,
            h('div', { class: 'gpue-wrow' }, [swatch, hex, pick]),
            h('div', { class: 'gpue-wtools' }, [bDrop, bAdd, bDel, bClr]),
            pal,
            h('div', { class: 'gpue-wtools' }, [bImp, bExp, fmt, fileIn]),
            stat
        ]);
        const root = h('div', { id: 'gpue-wheel' }, [head, body]);
        const btn = h('div', { id: 'gpue-wheel-btn', text: '🎨', title: 'Цветовой круг' });
        document.body.appendChild(btn);
        document.body.appendChild(root);

        wheelUi = { root, canvas, swatch, hex, pal, stat, palMap: null, palCur: null, ring: buildRing(N), tri: null, triKey: null };
        palRender();

        const pos = state.wheel || { left: Math.max(10, window.innerWidth - 274), top: 90 };
        placeWheel(pos.left, pos.top);

        // события виджета не должны доходить до игры
        // widget events must not reach the game
        ['pointerdown', 'mousedown', 'touchstart', 'wheel', 'keydown', 'keyup', 'keypress'].forEach(type =>
            root.addEventListener(type, e => e.stopPropagation(), { passive: true }));

        btn.addEventListener('click', toggleWheel);
        closeBtn.addEventListener('click', () => root.classList.remove('open'));
        pick.addEventListener('click', () => { readGameColor(); });

        // пипетка и палитра
        // eyedropper and palette
        bDrop.addEventListener('click', pickScreenColor);
        bAdd.addEventListener('click', () => {
            const hx = wheelHex();
            if (palCfg().includes(hx)) { palStat('Этот цвет уже в палитре'); return; }
            if (palCfg().length >= PALETTE_MAX) { palStat('Палитра заполнена (' + PALETTE_MAX + ')', true); return; }
            palAddMany([hx]);
            palStat('Добавлено: ' + hx);
        });
        bDel.addEventListener('click', () => {
            const on = !pal.classList.contains('del');
            pal.classList.toggle('del', on);
            bDel.classList.toggle('on', on);
        });
        bClr.addEventListener('click', () => {
            if (!palCfg().length) return;
            if (!confirm('Очистить всю палитру (' + palCfg().length + ' цв.)?')) return;
            state.palette = [];
            scheduleSave();
            palRender();
            palStat('Палитра очищена');
        });
        pal.addEventListener('click', e => {
            const el = e.target.closest ? e.target.closest('.gpue-wc') : null;
            if (!el) return;
            const hx = el.dataset.hex;
            if (pal.classList.contains('del')) { palRemove(hx); return; }
            const rgb = parseHex(hx);
            if (!rgb) return;
            setWheelFromRgb(rgb);
            applyColorToGame(wheelHex());
        });
        pal.addEventListener('contextmenu', e => {
            const el = e.target.closest ? e.target.closest('.gpue-wc') : null;
            if (!el) return;
            e.preventDefault();
            palRemove(el.dataset.hex);
        });
        bImp.addEventListener('click', () => fileIn.click());
        fileIn.addEventListener('change', async () => {
            const f = fileIn.files && fileIn.files[0];
            fileIn.value = '';
            if (!f) return;
            try {
                const colors = parsePaletteText(await f.text());
                if (!colors.length) { palStat('В файле не найдено цветов', true); return; }
                const before = palCfg().length;
                const added = palAddMany(colors);
                const skipped = colors.length - added;
                palStat('Импорт: добавлено ' + added + (skipped ? ', пропущено ' + skipped + ' (повторы или лимит ' + PALETTE_MAX + ')' : '') + (before >= PALETTE_MAX ? ' - палитра заполнена' : ''), !added);
            } catch (e) {
                palStat('Не удалось прочитать файл', true);
            }
        });
        bExp.addEventListener('click', () => {
            if (!palCfg().length) { palStat('Палитра пуста - нечего экспортировать', true); return; }
            const f = fmt.value;
            const mime = f === 'json' ? 'application/json' : 'text/plain';
            downloadText('gartic-palette.' + f, palExportText(f), mime);
            palStat('Экспортировано цветов: ' + palCfg().length);
        });

        // выбор цвета на круге; в игру цвет уходит при отпускании кнопки
        // color picking on the wheel; the color goes to the game on button release
        let mode = null;
        canvas.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            mode = wheelHitMode(e);
            try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
            wheelPointer(e, mode);
        });
        canvas.addEventListener('pointermove', e => {
            if (mode) wheelPointer(e, mode);
        });
        const finish = () => {
            if (!mode) return;
            mode = null;
            applyColorToGame(wheelHex());
        };
        canvas.addEventListener('pointerup', finish);
        canvas.addEventListener('pointercancel', finish);

        hex.addEventListener('input', () => {
            const typed = hex.value;
            const rgb = parseHex(typed);
            if (rgb) { setWheelFromRgb(rgb); hex.value = typed; }
        });
        hex.addEventListener('change', () => {
            const rgb = parseHex(hex.value);
            if (!rgb) { syncWheelUi(); return; }
            setWheelFromRgb(rgb);
            applyColorToGame(wheelHex());
        });

        // перетаскивание окна за заголовок
        // dragging the window by its header
        let drag = null;
        head.addEventListener('pointerdown', e => {
            if (e.target === closeBtn || e.button !== 0) return;
            const r = root.getBoundingClientRect();
            drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
            try { head.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
            e.preventDefault();
        });
        head.addEventListener('pointermove', e => {
            if (drag) placeWheel(e.clientX - drag.dx, e.clientY - drag.dy);
        });
        head.addEventListener('pointerup', () => {
            if (!drag) return;
            drag = null;
            const r = root.getBoundingClientRect();
            state.wheel = { left: r.left, top: r.top };
            scheduleSave();
        });

        window.addEventListener('resize', () => {
            if (!root.classList.contains('open')) return;
            const r = root.getBoundingClientRect();
            placeWheel(r.left, r.top);
        });

        readGameColor();
        syncWheelUi();
    }

    // =====================================================
    // ИСПРАВЛЕНИЕ КООРДИНАТ РИСОВАНИЯ ПРИ ИЗМЕНЕНИИ РАЗМЕРА
    // --------- DRAWING COORDINATE CORRECTION ON RESIZE ----------
    // =====================================================
    //
    // ВАЖНО:
    // IMPORTANT:
    // Наш CSS transform применяется к .core и его содержимому.
    // Our CSS transform is applied to .core and its contents.
    // Поэтому нельзя считать масштаб относительно drawingContainer:
    // Therefore the scale must not be computed relative to drawingContainer:
    // он может иметь собственную геометрию, отличающуюся от реального canvas.
    // it can have its own geometry different from the real canvas.
    //
    // Вместо этого:
    // Instead:
    // 1. находим настоящий canvas рисования;
    // 1. find the real drawing canvas;
    // 2. берём его фактический getBoundingClientRect;
    // 2. take its actual getBoundingClientRect;
    // 3. определяем реальный экранный масштаб canvas (по отношению
    // 3. determine the real on-screen scale of the canvas (from the ratio
    // rect к offsetWidth/offsetHeight - та же техника, что уже
    // of the rect to offsetWidth/offsetHeight - the same technique that
    // использует ancestorScale для перетаскивания мышью выше,
    // ancestorScale above already uses for mouse dragging,
    // только измеряется прямо по DOM, а не выводится из наших
    // only measured directly from the DOM rather than derived from our
    // сохранённых W/H);
    // saved W/H);
    // 4. преобразуем координату курсора обратно в систему координат,
    // 4. convert the cursor coordinate back into the coordinate system
    // которую ожидает Gartic Phone.
    // that Gartic Phone expects.
    //
    // Translate(X/Y) отдельно компенсировать НЕ нужно:
    // Translate(X/Y) does NOT need to be compensated separately:
    // положение уже содержится в rect.left / rect.top.
    // the position is already contained in rect.left / rect.top.
    // При отсутствии нашего масштаба (kx=ky=1) событие не трогается.
    // When our scale is absent (kx=ky=1) the event is not touched.
    // Touch-события (мобильная версия и перо на планшетах) корректируются точечно —
    // Touch events (mobile version and pen on tablets) are corrected pointwise -
    // координаты внутри Touch/TouchList, без пересборки и повторной диспетчеризации события.
    // coordinates inside Touch/TouchList, without rebuilding or re-dispatching the event.
    // =====================================================

    let scaledNodes = [];
    let coordFixOn = false;
    let strokeActive = false;
    let panelDragActive = false;

    const fixedEvents = new WeakSet();
    const DEBUG_COORDS = false;


    // ----------------------------------------------------
    // Поиск настоящего canvas рисования
    // Finding the real drawing canvas
    // ----------------------------------------------------
    function getDrawingCanvas() {
        const core = document.querySelector('.draw .core');
        if (!core) return null;

        const canvases = Array.from(core.querySelectorAll('canvas'));

        if (!canvases.length) return null;

        // Наш цветовой круг / элементы редактора исключаем.
        // Our color wheel / editor elements are excluded.
        const candidates = canvases.filter(cv => {
            if (!cv) return false;
            if (cv.id === 'gpue-wheel') return false;
            if (cv.closest('#gpue-panel')) return false;
            if (cv.closest('#gpue-wheel')) return false;

            const r = cv.getBoundingClientRect();
            return r.width > 10 && r.height > 10;
        });

        if (!candidates.length) return null;

        // Настоящий canvas рисования обычно самый большой.
        // The real drawing canvas is usually the largest one.
        candidates.sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return (rb.width * rb.height) - (ra.width * ra.height);
        });

        return candidates[0];
    }


    // ----------------------------------------------------
    // Определяем, есть ли вообще активный наш transform
    // Determining whether our transform is active at all
    // (флаг-оптимизация: чтобы не искать canvas на каждое
    // (a flag optimization: so we do not search for the canvas on every
    // движение мыши, когда ничего не масштабировано)
    // mouse movement when nothing is scaled)
    // ----------------------------------------------------
    function refreshCoordFix() {
        const byNode = new Map();

        for (const key of Object.keys(ELEMENTS)) {
            const st = state.elements[key];
            if (!st) continue;

            const hasTransform =
                st.x !== 0 ||
                st.y !== 0 ||
                st.w !== 100 ||
                st.h !== 100;

            if (!hasTransform) continue;

            let nodes = [];

            try {
                nodes = document.querySelectorAll(ELEMENTS[key].selector);
            } catch (e) {
                continue;
            }

            for (const node of nodes) {
                if (!node) continue;

                // Если несколько наших правил затрагивают один узел,
                // If several of our rules affect one node,
                // последнее правило CSS имеет приоритет.
                // the last CSS rule wins.
                byNode.set(node, {
                    kx: st.w / 100,
                    ky: st.h / 100
                });
            }
        }

        scaledNodes = [];

        byNode.forEach((value, node) => {
            if (value.kx !== 1 || value.ky !== 1) {
                scaledNodes.push({
                    node,
                    kx: value.kx,
                    ky: value.ky
                });
            }
        });

        // Коррекция нужна только если действительно есть наш масштаб.
        // Correction is needed only when our scale is actually present.
        coordFixOn =
            scaledNodes.length > 0 &&
            !editMode;
    }


    // ----------------------------------------------------
    // Масштаб, который добавили именно МЫ, а не игра
    // The scale added by US, not by the game
    // ----------------------------------------------------
    // ВАЖНО: тут нельзя мерить «фактический» масштаб через
    // IMPORTANT: you must not measure the "actual" scale here via
    // rect.width / el.offsetWidth. У холста rect уже включает
    // rect.width / el.offsetWidth. For the canvas the rect already includes
    // ТРИ независимых источника масштаба: родной масштаб экрана
    // THREE independent sources of scale: the game's native screen scale
    // игры (.screen), родной зум игры (Ctrl+колесо) и НАШ
    // (.screen), the game's native zoom (Ctrl+wheel) and OUR
    // transform:scale(w/100,h/100). offsetWidth ни один из них
    // transform:scale(w/100,h/100). offsetWidth accounts for none of them
    // не учитывает (transform на layout не влияет), поэтому их
    // (transform does not affect layout), so their
    // отношение — это произведение ВСЕХ ТРЁХ масштабов сразу.
    // ratio is the product of ALL THREE scales at once.
    // Игра свою часть (экран × её зум) уже сама аккуратно делит
    // The game already divides its part (screen × its zoom) accurately
    // при пересчёте координат — если поделить на неё ещё раз
    // when recomputing coordinates - dividing by it once more here
    // здесь, получится двойной учёт, и при активном зуме игры
    // would double-count, and with the game zoom active
    // (100–300%) появляется новый, уже наш параллакс (проверено
    // (100-300%) a new, our own parallax appears (verified
    // тестами: ошибка получается кратна зуму игры).
    // by tests: the error is a multiple of the game zoom).
    // Поэтому берём только наш собственный масштаб — тот же
    // Therefore we take only our own scale - the same
    // способ, что использует остальной редактор (scaledNodes из
    // method the rest of the editor uses (scaledNodes from
    // refreshCoordFix, посчитанные из state.elements, а не из
    // refreshCoordFix, computed from state.elements, not from
    // геометрии экрана): произведение st.w/100 и st.h/100 всех
    // screen geometry): the product of st.w/100 and st.h/100 of all
    // НАШИХ элементов, внутри которых лежит canvas.
    // OUR elements the canvas lies inside.
    // ----------------------------------------------------
    function getOwnScaleFor(el) {
        let kx = 1, ky = 1;
        for (const s of scaledNodes) {
            if (s.node.contains(el)) { kx *= s.kx; ky *= s.ky; }
        }
        const valid = value => Number.isFinite(value) && value > 0.01 && value < 100;
        return { kx: valid(kx) ? kx : 1, ky: valid(ky) ? ky : 1 };
    }


    // ----------------------------------------------------
    // Найти canvas из event.target / composedPath
    // Find the canvas from event.target / composedPath
    // ----------------------------------------------------
    function findCanvasFromEvent(e) {
        if (!e) return null;

        // Сначала проверяем сам target.
        // First we check the target itself.
        let t = e.target;

        if (t && t.tagName === 'CANVAS') {
            if (
                t.id !== 'gpue-wheel' &&
                !t.closest('#gpue-panel') &&
                !t.closest('#gpue-wheel')
            ) {
                return t;
            }
        }

        // Затем composedPath — надёжнее при вложенных элементах.
        // Then composedPath - more reliable with nested elements.
        if (typeof e.composedPath === 'function') {
            const path = e.composedPath();

            for (const node of path) {
                if (!node || node.nodeType !== 1) continue;
                if (node.tagName !== 'CANVAS') continue;

                if (node.id === 'gpue-wheel') continue;
                if (node.closest('#gpue-panel')) continue;
                if (node.closest('#gpue-wheel')) continue;

                const r = node.getBoundingClientRect();

                if (r.width > 10 && r.height > 10) {
                    return node;
                }
            }
        }

        return getDrawingCanvas();
    }


    // ----------------------------------------------------
    // Исправление координат ОДНОГО события-объекта. Применяется и к несущему
    // Coordinate correction of ONE event object. Applied both to the carrying
    // событию, и к каждому коалесцированному под-событию стилуса (см. ниже).
    // event and to each coalesced pen sub-event (see below).
    // pressure/tiltX/tiltY/twist/pointerId/pointerType/buttons/isPrimary/
    // timeStamp не трогаем — только координаты.
    // timeStamp is not touched - coordinates only.
    // ----------------------------------------------------
    function correctEventObject(ev, canvas, scale, rect) {
        if (!ev || fixedEvents.has(ev)) return;

        const localX = ev.clientX - rect.left;
        const localY = ev.clientY - rect.top;

        // Из экранной системы обратно в исходную — делим только на НАШ масштаб.
        // From the screen system back to the original one - divide only by OUR scale.
        const correctedX = rect.left + localX / scale.kx;
        const correctedY = rect.top + localY / scale.ky;

        if (!Number.isFinite(correctedX) || !Number.isFinite(correctedY)) return;

        const dx = correctedX - ev.clientX;
        const dy = correctedY - ev.clientY;

        const define = (name, value) => {
            try { Object.defineProperty(ev, name, { value, configurable: true }); return true; }
            catch (err) { return false; /* readonly-свойство браузера */ }
        };

        // Если ключевые координаты не удалось подменить (нерасширяемый Touch и т.п.),
        // If the key coordinates could not be replaced (a non-expandable Touch etc.),
        // НЕ помечаем событие исправленным: иначе коррекция молча «теряется».
        // we do NOT mark the event as corrected: otherwise the correction silently "gets lost".
        if (!define('clientX', correctedX) || !define('clientY', correctedY)) return;
        define('x', correctedX);
        define('y', correctedY);

        // pageX/pageY считаем заново, а не через старое значение — иначе при
        // pageX/pageY are recomputed rather than derived from the old value - otherwise on
        // прокрутке страницы можно получить дополнительное смещение.
        // page scroll an extra offset can appear.
        define('pageX', correctedX + window.scrollX);
        define('pageY', correctedY + window.scrollY);

        define('screenX', ev.screenX + dx);
        define('screenY', ev.screenY + dy);

        // offsetX/offsetY — только если цель самого события это и есть canvas:
        // offsetX/offsetY - only if the event target is the canvas itself:
        // тогда браузер отдаёт локальную координату цели, и деление на наш
        // then the browser returns the target's local coordinate, and dividing it by our
        // масштаб для неё корректно. Для чужого target трогать нельзя.
        // scale is correct. For someone else's target it must not be touched.
        if (ev.target === canvas) {
            define('offsetX', localX / scale.kx);
            define('offsetY', localY / scale.ky);
        }

        fixedEvents.add(ev);
    }

    function logCoords(e, canvas, scale, rect) {
        const cs = getComputedStyle(canvas);
        const describe = ev => [
            ev.type, ev.pointerType || 'mouse',
            'c=' + Math.round(ev.clientX) + ',' + Math.round(ev.clientY),
            'o=' + Math.round(ev.offsetX) + ',' + Math.round(ev.offsetY),
            'p=' + (ev.pressure != null ? ev.pressure : '-')
        ].join(' ');
        console.log('[GPUE]', describe(e),
            '| rect', Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height),
            '| k', scale.kx.toFixed(3), scale.ky.toFixed(3),
            '| tr', cs.transform,
            '| coal', (typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents().length : 'n/a'),
            '| tgt', e.target && (e.target.tagName + '.' + (e.target.className || '')));
    }

    // ----------------------------------------------------
    // Исправление координат исходного события (мышь, перо и обычный touch-эмулирующий
    // Coordinate correction of the original event (mouse, pen and a regular touch-emulating
    // pointermove — обработчик один и тот же для всех pointerType, включая 'pen').
    // pointermove - one handler for all pointerTypes, including 'pen').
    // ----------------------------------------------------
    function fixEventCoords(e, canvas) {
        if (!e || !canvas || fixedEvents.has(e)) {
            return;
        }

        if (editMode || panelDragActive) {
            return;
        }

        const rect = canvas.getBoundingClientRect();

        if (
            !rect ||
            rect.width <= 0 ||
            rect.height <= 0
        ) {
            return;
        }

        const scale = getOwnScaleFor(canvas);

        // Если canvas фактически не масштабирован,
        // If the canvas is not actually scaled,
        // событие вообще не трогаем.
        // the event is not touched at all.
        //
        // Небольшой допуск нужен из-за дробных размеров браузера.
        // A small tolerance is needed because of fractional browser sizes.
        if (
            Math.abs(scale.kx - 1) < 0.0001 &&
            Math.abs(scale.ky - 1) < 0.0001
        ) {
            return;
        }

        correctEventObject(e, canvas, scale, rect);

        // КЛЮЧЕВОЕ ДЛЯ ПЕРА: высокочастотные под-события стилуса. Между двумя
        // KEY FOR THE PEN: high-frequency pen sub-events. Between two
        // кадрами отрисовки планшет успевает прислать несколько точек, браузер
        // render frames the tablet manages to send several points, and the browser
        // складывает их в event.getCoalescedEvents — исходный pointermove
        // folds them into event.getCoalescedEvents - the original pointermove
        // несёт только последнюю. Если игра рисует штрих именно по ним (гладкая
        // carries only the last one. If the game draws the stroke precisely from them (a smooth
        // линия с учётом давления), а мы правим только «обёртку», все
        // line with pressure), and we correct only the "envelope", all
        // промежуточные точки штриха остаются со старыми, немасштабированными
        // intermediate stroke points keep old, unscaled
        // координатами — отсюда параллакс у пера при работе мышь при этом
        // coordinates - hence the pen parallax, while the mouse is unaffected:
        // не задета: у неё коалесцированных под-событий, как правило, нет.
        // it usually has no coalesced sub-events.
        if (typeof e.getCoalescedEvents === 'function') {
            try {
                const coalesced = e.getCoalescedEvents();
                if (coalesced) for (const sub of coalesced) correctEventObject(sub, canvas, scale, rect);
            } catch (err) { /* метод недоступен в этом браузере/контексте */ }
        }

        if (DEBUG_COORDS) logCoords(e, canvas, scale, rect);
    }


    // ----------------------------------------------------
    // MOUSE DOWN
    // ----------------------------------------------------
    function onMouseDownFix(e) {
        if (panelDragActive || editMode) {
            return;
        }

        refreshCoordFix();

        if (!coordFixOn || isOurs(e.target)) {
            return;
        }

        const canvas = findCanvasFromEvent(e);

        if (!canvas) {
            return;
        }

        const core = document.querySelector('.draw .core');

        if (!core || !core.contains(canvas)) {
            return;
        }

        strokeActive = true;

        fixEventCoords(e, canvas);
    }


    // ----------------------------------------------------
    // MOUSE MOVE
    // ----------------------------------------------------
    function onMouseMoveFix(e) {
        if (
            !coordFixOn ||
            panelDragActive ||
            editMode ||
            isOurs(e.target)
        ) {
            return;
        }

        const canvas = findCanvasFromEvent(e);

        if (!canvas) {
            return;
        }

        const core = document.querySelector('.draw .core');

        if (!core || !core.contains(canvas)) {
            return;
        }

        // Во время рисования корректируем все движения.
        // While drawing we correct all movements.
        // Вне рисования — только когда курсор действительно
        // Outside drawing - only when the cursor is actually
        // находится над canvas.
        // over the canvas.
        const rect = canvas.getBoundingClientRect();

        const inside =
            e.clientX >= rect.left &&
            e.clientX <= rect.right &&
            e.clientY >= rect.top &&
            e.clientY <= rect.bottom;

        if (strokeActive || inside) {
            fixEventCoords(e, canvas);
        }
    }


    // ----------------------------------------------------
    // Курсор-кружок кисти рисуется отдельным canvas — соседом .drawing
    // The brush circle cursor is drawn on a separate canvas - a sibling of .drawing
    // внутри .core, НЕ тем canvas, где рисуется сам мазок. У него
    // inside .core, NOT the canvas where the stroke itself is drawn. It has
    // pointer-events:none, поэтому обычный hit-test (через target/
    // pointer-events:none, so a regular hit-test (via target/
    // composedPath, как в findCanvasFromEvent) всегда попадает на canvas
    // composedPath, as in findCanvasFromEvent) always lands on the drawing
    // рисования — курсор в игре считается относительно СВОЕГО прямоугольника,
    // canvas - the cursor in the game is computed relative to ITS OWN rectangle,
    // отдельно от .drawing (а значит, без её родного зума поверх нашего).
    // separately from .drawing (and hence without its native zoom on top of ours).
    // ----------------------------------------------------
    function getCursorCanvas() {
        const list = document.querySelectorAll('.draw .core > canvas');
        for (const c of list) {
            if (!c.closest('.drawingContainer')) return c;
        }
        return null;
    }

    // ----------------------------------------------------
    // POINTER MOVE / POINTER RAW UPDATE — двигает ТОЛЬКО кружок кисти
    // POINTER MOVE / POINTER RAW UPDATE - moves ONLY the brush circle
    // (подтверждено логами: сам мазок у этой игры идёт через
    // (confirmed by logs: the stroke itself in this game goes through
    // mousedown/mousemove или touchstart/touchmove — см. onMouseDownFix/
    // mousedown/mousemove or touchstart/touchmove - see onMouseDownFix/
    // onMouseMoveFix/onTouchStartFix/onTouchMoveFix, которые не менялись).
    // onMouseMoveFix/onTouchStartFix/onTouchMoveFix, which were not changed).
    // Поэтому здесь всегда правим координаты относительно КУРСОРНОГО canvas,
    // Therefore here we always correct coordinates relative to the CURSOR canvas,
    // а не относительно того, что вернул бы обычный hit-test.
    // not relative to what a regular hit-test would return.
    // ----------------------------------------------------
    function onPointerMoveFix(e) {
        if (
            !coordFixOn ||
            panelDragActive ||
            editMode ||
            isOurs(e.target)
        ) {
            return;
        }

        const canvas = getCursorCanvas();

        if (!canvas) {
            return;
        }

        const core = document.querySelector('.draw .core');

        if (!core || !core.contains(canvas)) {
            return;
        }

        // Как и для mouse: вне активного штриха правим только когда указатель
        // As with the mouse: outside an active stroke we correct only when the pointer
        // действительно над canvas. Иначе координаты «прыгают» над панелями,
        // is actually over the canvas. Otherwise coordinates "jump" over panels,
        // ползунками и окном слоёв при масштабировании холста.
        // sliders and the layers window while the canvas is scaled.
        const p = rawXY(e), rect = canvas.getBoundingClientRect();
        const inside = !!p &&
            p[0] >= rect.left && p[0] <= rect.right &&
            p[1] >= rect.top && p[1] <= rect.bottom;

        if (!strokeActive && !inside) return;

        fixEventCoords(e, canvas);
    }


    // ----------------------------------------------------
    // TOUCH: подтверждено реальными логами диагностики — у части
    // TOUCH: confirmed by real diagnostic logs - for some
    // стилусов/планшетов браузер НЕ генерирует компат-mousedown для пера
    // styluses/tablets the browser does NOT generate a compat mousedown for the pen
    // вообще, вместо этого параллельно с pointerdown идёт touchstart на
    // at all; instead, in parallel with pointerdown a touchstart goes to
    // тот же canvas (Gartic слушает mousedown ИЛИ touchstart — что
    // the same canvas (Gartic listens to mousedown OR touchstart - whichever
    // придёт). Раньше touch сознательно не трогали («только мобильное») —
    // comes). Touch used to be deliberately untouched ("mobile only") -
    // это предположение оказалось неверным для десктопных планшетов.
    // that assumption proved wrong for desktop tablets.
    //
    // У TouchEvent нет top-level clientX/clientY — координаты лежат
    // TouchEvent has no top-level clientX/clientY - the coordinates lie
    // внутри touches/changedTouches/targetTouches, в объектах Touch.
    // inside touches/changedTouches/targetTouches, in Touch objects.
    // Правим их точечно, как и раньше — НЕ пересобираем и НЕ диспатчим
    // We correct them pointwise, as before - we do NOT rebuild and do NOT dispatch
    // новое событие (синтетическое TouchEvent так же будет отброшено
    // a new event (a synthetic TouchEvent would likewise be rejected
    // игрой по тому же isTrusted-чеку, что и с pointerdown/pointermove).
    // by the game via the same isTrusted check as pointerdown/pointermove).
    // ----------------------------------------------------
    const fixedTouches = new WeakSet();

    function correctTouchList(list, canvas, scale, rect) {
        if (!list) return;
        for (let i = 0; i < list.length; i++) {
            const t = list[i];
            if (!t || fixedTouches.has(t)) continue;

            const localX = t.clientX - rect.left;
            const localY = t.clientY - rect.top;
            const cx = rect.left + localX / scale.kx;
            const cy = rect.top + localY / scale.ky;

            if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;

            const dx = cx - t.clientX, dy = cy - t.clientY;
            const define = (name, value) => {
                try { Object.defineProperty(t, name, { value, configurable: true }); } catch (err) { /* readonly в этом браузере */ }
            };
            define('clientX', cx); define('clientY', cy);
            define('pageX', cx + window.scrollX); define('pageY', cy + window.scrollY);
            define('screenX', t.screenX + dx); define('screenY', t.screenY + dy);

            fixedTouches.add(t);
        }
    }

    function fixTouchEventCoords(e, canvas) {
        if (!e || !canvas) return;
        if (editMode || panelDragActive) return;

        const rect = canvas.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return;

        const scale = getOwnScaleFor(canvas);
        if (Math.abs(scale.kx - 1) < 0.0001 && Math.abs(scale.ky - 1) < 0.0001) return;

        // Один Touch-объект может присутствовать сразу в нескольких списках
        // One Touch object can be present in several lists at once
        // (touches/targetTouches/changedTouches) — fixedTouches не даёт
        // (touches/targetTouches/changedTouches) - fixedTouches does not let
        // поправить его дважды.
        // it be corrected twice.
        correctTouchList(e.touches, canvas, scale, rect);
        correctTouchList(e.targetTouches, canvas, scale, rect);
        correctTouchList(e.changedTouches, canvas, scale, rect);
    }

    function firstTouch(e) {
        return (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || null;
    }

    function onTouchStartFix(e) {
        if (panelDragActive || editMode) return;

        refreshCoordFix();
        if (!coordFixOn || isOurs(e.target)) return;

        const canvas = findCanvasFromEvent(e);
        if (!canvas) return;

        const core = document.querySelector('.draw .core');
        if (!core || !core.contains(canvas)) return;

        strokeActive = true;
        fixTouchEventCoords(e, canvas);
    }

    function onTouchMoveFix(e) {
        if (!coordFixOn || panelDragActive || editMode || isOurs(e.target)) return;

        const canvas = findCanvasFromEvent(e);
        if (!canvas) return;

        const core = document.querySelector('.draw .core');
        if (!core || !core.contains(canvas)) return;

        if (!strokeActive) {
            const rect = canvas.getBoundingClientRect();
            const t = firstTouch(e);
            if (!t) return;
            const inside = t.clientX >= rect.left && t.clientX <= rect.right &&
                           t.clientY >= rect.top && t.clientY <= rect.bottom;
            if (!inside) return;
        }

        fixTouchEventCoords(e, canvas);
    }


    // ----------------------------------------------------
    // Регистрация событий
    // Event registration
    //
    // pointerrawupdate — событие с меньшей задержкой, чем pointermove
    // pointerrawupdate - an event with lower latency than pointermove
    // (Chromium); координаты в нём и в его getCoalescedEvents исправляем
    // (Chromium); its coordinates and those of its getCoalescedEvents are corrected
    // тем же обработчиком. touchstart/touchmove регистрируем с
    // by the same handler. touchstart/touchmove are registered with
    // passive:false — иначе браузер по умолчанию не даст трогать событие.
    // passive:false - otherwise the browser will not let the event be touched by default.
    // ----------------------------------------------------
    window.addEventListener('mousedown', onMouseDownFix, true);
    window.addEventListener('mousemove', onMouseMoveFix, true);
    window.addEventListener('pointermove', onPointerMoveFix, true);
    window.addEventListener('pointerrawupdate', onPointerMoveFix, true);
    window.addEventListener('touchstart', onTouchStartFix, { capture: true, passive: false });
    window.addEventListener('touchmove', onTouchMoveFix, { capture: true, passive: false });
    window.addEventListener('mouseup', () => { strokeActive = false; }, true);
    window.addEventListener('pointerup', () => { strokeActive = false; }, true);
    window.addEventListener('pointercancel', () => { strokeActive = false; }, true);
    window.addEventListener('touchend', () => { strokeActive = false; }, true);
    window.addEventListener('touchcancel', () => { strokeActive = false; }, true);
    window.addEventListener('blur', () => { strokeActive = false; });

    // =====================================================
    // Окно референса: картинка по ссылке или локальный файл.
    // Reference window: an image by URL or a local file.
    // Это отдельное плавающее окно поверх страницы. Canvas, кисть и
    // It is a separate floating window on top of the page. The canvas, brush and
    // координаты рисования не затрагиваются; события окна до игры не доходят.
    // drawing coordinates are not touched; the window's events do not reach the game.
    // Локальный файл: кнопка «Файл», перетаскивание в окно или Ctrl+V.
    // Local file: the "File" button, dragging into the window or Ctrl+V.
    // (Браузер не разрешает странице в сети открывать файл по пути C:\... -
    // (The browser does not allow a web page to open a file by path C:\... -
    // можно выбрать файл только через системный диалог.)
    // a file can only be chosen via the system dialog.)
    // =====================================================
    const REF = { objUrl: null, token: 0, nw: 0, nh: 0, s: 1, x: 0, y: 0, userView: false, urlLoaded: false };
    let refUi = null;

    const REF_CSS = `
#gpue-ref-btn{position:fixed;top:8px;right:136px;z-index:2147483646;padding:6px 9px;background:#2b2b3d;color:#fff;
  border:1px solid #6b6b9a;border-radius:8px;font:600 13px/1 Arial,sans-serif;cursor:pointer;opacity:.85}
#gpue-ref-btn:hover{opacity:1}
#gpue-ref{position:fixed;z-index:2147483647;color:#eee;border:1px solid #6b6b9a;border-radius:10px;overflow:hidden;
  font:13px/1.4 Arial,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5);display:none;flex-direction:column;
  user-select:none;outline:none;--a:1;pointer-events:none}
#gpue-ref.open{display:flex}
#gpue-ref-head{display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:#2b2b3d;
  cursor:move;font-weight:700;touch-action:none;flex:none;pointer-events:auto}
#gpue-ref-close,#gpue-ref-fold{cursor:pointer;padding:0 5px;font-size:16px}
#gpue-ref-btns{display:flex;align-items:center;gap:2px}
#gpue-ref.fold .gpue-ref-row,#gpue-ref.fold #gpue-ref-info{display:none}
.gpue-ref-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:5px 8px;background:#1e1e2e;flex:none;pointer-events:auto}
#gpue-ref input[type=text]{flex:1;min-width:0;padding:5px;background:#12121c;color:#eee;border:1px solid #444;
  border-radius:5px;font:12px Arial,sans-serif;user-select:text}
#gpue-ref input[type=range]{flex:1;min-width:40px}
#gpue-ref button{padding:4px 8px;background:#3a3a55;color:#fff;border:1px solid #6b6b9a;border-radius:6px;cursor:pointer;flex:none}
#gpue-ref button:hover{background:#4a4a70}
#gpue-ref-info{padding:0 8px 5px;background:#1e1e2e;font-size:11px;color:#aab;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;flex:none;pointer-events:auto}
#gpue-ref-info.err{color:#ff8a8a}
#gpue-ref-vp{position:relative;flex:1;min-height:0;overflow:hidden;background:rgba(18,18,28,var(--a));touch-action:none;pointer-events:none}
#gpue-ref.move #gpue-ref-vp{pointer-events:auto;cursor:grab}
#gpue-ref.fold #gpue-ref-vp{pointer-events:none !important}
#gpue-ref-vp.pan{cursor:grabbing}
#gpue-ref-vp img{position:absolute;left:0;top:0;max-width:none;max-height:none;transform-origin:0 0;
  opacity:var(--a);pointer-events:none;-webkit-user-drag:none;display:none}
#gpue-ref-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;
  padding:10px;color:#99a;font-size:12px;white-space:pre-line;pointer-events:none}
#gpue-ref.drop #gpue-ref-vp{outline:2px dashed #8fa8ff;outline-offset:-4px}
#gpue-ref-size{cursor:nwse-resize;padding:0 5px;font-size:16px;touch-action:none}
#gpue-ref button.on{background:#5a5a9a;border-color:#8fa8ff}
html.gpue-edit #gpue-ref, html.gpue-edit #gpue-ref *{cursor:default !important}
html.gpue-edit #gpue-ref button, html.gpue-edit #gpue-ref-btn, html.gpue-edit #gpue-ref-close, html.gpue-edit #gpue-ref-fold{cursor:pointer !important}
html.gpue-edit #gpue-ref-head{cursor:move !important}
html.gpue-edit #gpue-ref-size{cursor:nwse-resize !important}
html.gpue-edit #gpue-ref input[type=text]{cursor:text !important;user-select:text !important}
`;

    function refCfg() {
        if (!state.ref || typeof state.ref !== 'object') state.ref = {};
        return state.ref;
    }

    function placeRef(left, top) {
        const r = refUi.root;
        const w = r.offsetWidth || 320;
        left = Math.min(Math.max(0, left), Math.max(0, window.innerWidth - w));
        top = Math.min(Math.max(0, top), Math.max(0, window.innerHeight - 60));
        r.style.left = left + 'px';
        r.style.top = top + 'px';
    }

    function refSize(w, hgt) {
        w = clampNum(w, 240, Math.max(240, window.innerWidth), 320);
        hgt = clampNum(hgt, 100, Math.max(200, window.innerHeight), 360);
        refUi.root.style.width = w + 'px';
        refUi.root.style.height = hgt + 'px';
    }

    function refApplyView() {
        refUi.img.style.transform = 'translate(' + REF.x + 'px,' + REF.y + 'px) scale(' + REF.s + ')';
    }

    function refFit() {
        if (!REF.nw || !REF.nh) return;
        const vw = refUi.vp.clientWidth, vh = refUi.vp.clientHeight;
        if (vw <= 0 || vh <= 0) return;
        REF.s = Math.min(4, vw / REF.nw, vh / REF.nh);
        REF.x = (vw - REF.nw * REF.s) / 2;
        REF.y = (vh - REF.nh * REF.s) / 2;
        REF.userView = false;
        refApplyView();
    }

    function refInfo(text, isErr, title) {
        refUi.info.textContent = text || '';
        refUi.info.title = title || text || '';
        refUi.info.classList.toggle('err', !!isErr);
    }

    // Показать картинку (src - обычный URL или blob:). Возвращает true при успехе.
    // Show an image (src - a regular URL or blob:). Returns true on success.
    function refShow(src, label, isObj) {
        const tok = ++REF.token;
        return new Promise(resolve => {
            const probe = new Image();
            probe.onload = () => {
                if (tok !== REF.token) { if (isObj) URL.revokeObjectURL(src); return resolve(false); }
                if (REF.objUrl && REF.objUrl !== src) { URL.revokeObjectURL(REF.objUrl); }
                REF.objUrl = isObj ? src : null;
                REF.nw = probe.naturalWidth || 1;
                REF.nh = probe.naturalHeight || 1;
                const img = refUi.img;
                img.style.width = REF.nw + 'px';
                img.style.height = REF.nh + 'px';
                img.src = src;
                img.style.display = 'block';
                refUi.empty.style.display = 'none';
                refInfo(label + '  (' + REF.nw + '×' + REF.nh + ')', false, label);
                refFit();
                resolve(true);
            };
            probe.onerror = () => {
                if (isObj) URL.revokeObjectURL(src);
                resolve(false);
            };
            probe.src = src;
        });
    }

    function gmFetchBlob(url) {
        return new Promise(resolve => {
            try {
                GM_xmlhttpRequest({
                    method: 'GET', url, responseType: 'blob', timeout: 20000,
                    onload: r => resolve(r.status >= 200 && r.status < 300 ? r.response : null),
                    onerror: () => resolve(null),
                    ontimeout: () => resolve(null)
                });
            } catch (e) { resolve(null); }
        });
    }

    async function refLoadUrl(raw) {
        let u = String(raw || '').trim().replace(/^["']+|["']+$/g, '');
        if (!u) return;
        // локальные пути: странице сайта они недоступны
        // local paths: the site page cannot access them
        if (/^file:/i.test(u) || /^[a-z]:[\\/]/i.test(u) || /^\\\\/.test(u) || /^\/(?!\/)/.test(u)) {
            refInfo('Путь к файлу открыть нельзя: нажмите «📁 Файл», перетащите картинку в окно или вставьте через Ctrl+V', true);
            return;
        }
        if (!/^(https?:|data:image\/|blob:)/i.test(u)) u = 'https://' + u.replace(/^\/\//, '');
        refUi.url.value = u;
        refInfo('Загрузка…');
        let ok = await refShow(u, u, false);
        // если сайт запрещает показ чужих картинок (CSP/hotlink) - качаем через менеджер скриптов
        // if the site blocks showing other people's images (CSP/hotlink) - we download via the userscript manager
        if (!ok && /^https?:/i.test(u) && typeof GM_xmlhttpRequest === 'function') {
            const blob = await gmFetchBlob(u);
            if (blob) ok = await refShow(URL.createObjectURL(blob), u, true);
        }
        if (ok) {
            const c = refCfg();
            c.url = u;
            scheduleSave();
        } else {
            refInfo('Не удалось загрузить картинку по ссылке', true);
        }
    }

    async function refLoadFile(file) {
        if (!file) return;
        if (!/^image\//i.test(file.type || '')) { refInfo('Это не изображение: ' + (file.name || ''), true); return; }
        refInfo('Загрузка…');
        const ok = await refShow(URL.createObjectURL(file), '📄 ' + (file.name || 'из буфера обмена'), true);
        if (ok) {
            refUi.url.value = '';
            const c = refCfg();
            c.url = '';
            scheduleSave();
        } else {
            refInfo('Не удалось открыть изображение', true);
        }
    }

    function refClear() {
        REF.token++;
        if (REF.objUrl) { URL.revokeObjectURL(REF.objUrl); REF.objUrl = null; }
        REF.nw = REF.nh = 0;
        refUi.img.removeAttribute('src');
        refUi.img.style.display = 'none';
        refUi.empty.style.display = 'flex';
        refUi.url.value = '';
        refInfo('');
        const c = refCfg();
        c.url = '';
        scheduleSave();
    }

    function refSaveGeom() {
        const r = refUi.root.getBoundingClientRect();
        const c = refCfg();
        c.left = Math.round(r.left); c.top = Math.round(r.top);
        c.w = Math.round(r.width); c.h = Math.round(r.height);
        scheduleSave();
    }

    function toggleRef(force) {
        const open = typeof force === 'boolean' ? force : !refUi.root.classList.contains('open');
        refUi.root.classList.toggle('open', open);
        // активная кнопка светится фиолетовым
        // the active button glows purple
        const rb = document.getElementById('gpue-ref-btn');
        if (rb) rb.classList.toggle('gpue-on', open);
        if (open) {
            const r = refUi.root.getBoundingClientRect();
            placeRef(r.left, r.top);
            if (!REF.urlLoaded) {
                REF.urlLoaded = true;
                const u = refCfg().url;
                if (u && !REF.nw) refLoadUrl(u);
            }
            refFit();
        }
    }

    function buildRef() {
        if (document.getElementById('gpue-ref-btn')) return;
        const style = document.createElement('style');
        style.textContent = REF_CSS;
        document.head.appendChild(style);

        const cfg = refCfg();
        const img = h('img', { alt: '', draggable: 'false' });
        const empty = h('div', { id: 'gpue-ref-empty', text: 'Вставьте ссылку, выберите файл,\nперетащите картинку сюда\nили нажмите Ctrl+V' });
        const vp = h('div', { id: 'gpue-ref-vp' }, [img, empty]);
        const url = h('input', { type: 'text', placeholder: 'Ссылка на изображение (https://…)', spellcheck: 'false' });
        const go = h('button', { text: 'OK', title: 'Загрузить по ссылке (Enter)' });
        const fileInput = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
        const pick = h('button', { text: '📁 Файл', title: 'Выбрать картинку на компьютере' });
        const fit = h('button', { text: '⤢', title: 'Вписать в окно (двойной клик по картинке)' });
        const zin = h('button', { text: '＋', title: 'Приблизить' });
        const zout = h('button', { text: '－', title: 'Отдалить' });
        const move = h('button', { text: '✋', title: 'Двигать картинку: колесо - масштаб, перетаскивание - сдвиг. Пока включено, картинка ловит мышь и рисовать под ней нельзя' });
        const clear = h('button', { text: '🗑', title: 'Убрать картинку' });
        const op = h('input', { type: 'range', min: '15', max: '100', step: '1', value: String(clampNum(cfg.opacity, 15, 100, 100)), title: 'Прозрачность' });
        const info = h('div', { id: 'gpue-ref-info' });
        const closeBtn = h('span', { id: 'gpue-ref-close', text: '✕', title: 'Закрыть' });
        const sizeBtn = h('span', { id: 'gpue-ref-size', text: '⤡', title: 'Тяните, чтобы изменить размер окна' });
        const foldBtn = h('span', { id: 'gpue-ref-fold', text: '▴', title: 'Свернуть/развернуть поле ссылки и кнопки' });
        const head = h('div', { id: 'gpue-ref-head' }, [h('span', { text: '🖼 Референс' }), h('span', { id: 'gpue-ref-btns' }, [sizeBtn, foldBtn, closeBtn])]);
        const root = h('div', { id: 'gpue-ref', tabindex: '-1' }, [
            head,
            h('div', { class: 'gpue-ref-row' }, [url, go]),
            h('div', { class: 'gpue-ref-row' }, [pick, fit, zin, zout, move, clear, op, fileInput]),
            info, vp
        ]);
        const btn = h('div', { id: 'gpue-ref-btn', text: '🖼', title: 'Окно с референсом' });
        document.body.appendChild(btn);
        document.body.appendChild(root);

        refUi = { root, vp, img, empty, info, url, op };
        root.style.setProperty('--a', String(clampNum(cfg.opacity, 15, 100, 100) / 100));
        refSize(cfg.w, cfg.h);
        placeRef(clampNum(cfg.left, 0, 99999, 20), clampNum(cfg.top, 0, 99999, 90));

        // события окна не должны доходить до игры
        // the window's events must not reach the game
        ['pointerdown', 'mousedown', 'touchstart', 'wheel', 'keydown', 'keyup', 'keypress'].forEach(type =>
            root.addEventListener(type, e => e.stopPropagation(), { passive: true }));
        root.addEventListener('pointerdown', e => {
            if (!(e.target instanceof HTMLInputElement)) root.focus({ preventScroll: true });
        });

        const setFold = on => {
            root.classList.toggle('fold', on);
            if (on) { root.classList.remove('move'); move.classList.remove('on'); }
            foldBtn.textContent = on ? '▾' : '▴';
            refCfg().fold = on;
            scheduleSave();
        };
        if (cfg.fold) { root.classList.add('fold'); foldBtn.textContent = '▾'; }
        foldBtn.addEventListener('click', () => setFold(!root.classList.contains('fold')));

        btn.addEventListener('click', () => toggleRef());
        closeBtn.addEventListener('click', () => toggleRef(false));
        go.addEventListener('click', () => refLoadUrl(url.value));
        url.addEventListener('keydown', e => { if (e.key === 'Enter') refLoadUrl(url.value); });
        pick.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => {
            const f = fileInput.files && fileInput.files[0];
            fileInput.value = '';
            refLoadFile(f);
        });
        fit.addEventListener('click', refFit);
        const zoomBy = k => {
            if (!REF.nw) return;
            const cx = vp.clientWidth / 2, cy = vp.clientHeight / 2;
            const ns = Math.min(40, Math.max(0.02, REF.s * k));
            REF.x = cx - (cx - REF.x) * (ns / REF.s);
            REF.y = cy - (cy - REF.y) * (ns / REF.s);
            REF.s = ns;
            REF.userView = true;
            refApplyView();
        };
        zin.addEventListener('click', () => zoomBy(1.25));
        zout.addEventListener('click', () => zoomBy(0.8));
        // те же действия доступны из вкладки «Референс» (без дублирования логики)
        // the same actions are available from the "Reference" tab (without duplicating the logic)
        refUi.zoomBy = zoomBy;
        refUi.moveBtn = move;
        move.addEventListener('click', () => {
            if (root.classList.contains('fold')) return;
            const on = !root.classList.contains('move');
            root.classList.toggle('move', on);
            move.classList.toggle('on', on);
        });
        clear.addEventListener('click', refClear);
        op.addEventListener('input', () => {
            root.style.setProperty('--a', String(op.value / 100));
            refCfg().opacity = Number(op.value);
            scheduleSave();
        });

        // перетаскивание файла/ссылки в окно
        // dragging a file/link into the window
        root.addEventListener('dragover', e => { e.preventDefault(); root.classList.add('drop'); });
        root.addEventListener('dragleave', e => { if (!root.contains(e.relatedTarget)) root.classList.remove('drop'); });
        root.addEventListener('drop', e => {
            e.preventDefault();
            root.classList.remove('drop');
            const dt = e.dataTransfer;
            if (!dt) return;
            if (dt.files && dt.files.length) { refLoadFile(dt.files[0]); return; }
            const text = dt.getData('text/uri-list') || dt.getData('text/plain');
            if (text) refLoadUrl(text.split(/\r?\n/).find(l => l && l[0] !== '#') || text);
        });

        // вставка из буфера (Ctrl+V): картинка или ссылка; работает, пока курсор над окном или оно в фокусе
        // paste from the clipboard (Ctrl+V): an image or a link; works while the cursor is over the window or it is focused
        document.addEventListener('paste', e => {
            if (!root.classList.contains('open')) return;
            if (!(root.matches(':hover') || root.contains(document.activeElement))) return;
            const cd = e.clipboardData;
            if (!cd) return;
            for (const it of cd.items || []) {
                if (it.kind === 'file' && /^image\//i.test(it.type)) {
                    const f = it.getAsFile();
                    if (f) { e.preventDefault(); refLoadFile(f); return; }
                }
            }
            if (document.activeElement === url) return; // обычная вставка текста в поле ссылки | a regular text paste into the link field
            const text = cd.getData('text/plain');
            if (text) { e.preventDefault(); refLoadUrl(text.trim().split(/\s+/)[0]); }
        }, true);

        // перемещение окна за заголовок
        // moving the window by its header
        let drag = null;
        head.addEventListener('pointerdown', e => {
            if (e.target === closeBtn || e.target === foldBtn || e.button !== 0) return;
            const r = root.getBoundingClientRect();
            drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
            try { head.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
            e.preventDefault();
        });
        head.addEventListener('pointermove', e => { if (drag) placeRef(e.clientX - drag.dx, e.clientY - drag.dy); });
        const endHeadDrag = () => { if (!drag) return; drag = null; refSaveGeom(); };
        head.addEventListener('pointerup', endHeadDrag);
        head.addEventListener('pointercancel', endHeadDrag);

        // изменение размера окна: тянуть кнопку ⤡ в корешке
        // window resizing: drag the ⌥ button in the corner
        let rs = null;
        sizeBtn.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            const r = root.getBoundingClientRect();
            rs = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
            try { sizeBtn.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
            e.preventDefault();
            e.stopPropagation();
        });
        sizeBtn.addEventListener('pointermove', e => {
            if (!rs) return;
            refSize(rs.w + e.clientX - rs.x, rs.h + e.clientY - rs.y);
        });
        const endResize = () => {
            if (!rs) return;
            rs = null;
            const r = root.getBoundingClientRect();
            placeRef(r.left, r.top);
            refSaveGeom();
        };
        sizeBtn.addEventListener('pointerup', endResize);
        sizeBtn.addEventListener('pointercancel', endResize);

        // колесо: масштаб к точке под курсором; перетаскивание: сдвиг; двойной клик: вписать
        // wheel: scale to the point under the cursor; dragging: pan; double click: fit
        vp.addEventListener('wheel', e => {
            if (!REF.nw) return;
            e.preventDefault();
            const rect = vp.getBoundingClientRect();
            const px = e.clientX - rect.left, py = e.clientY - rect.top;
            const ns = Math.min(40, Math.max(0.02, REF.s * Math.exp(-e.deltaY * 0.0015)));
            REF.x = px - (px - REF.x) * (ns / REF.s);
            REF.y = py - (py - REF.y) * (ns / REF.s);
            REF.s = ns;
            REF.userView = true;
            refApplyView();
        }, { passive: false });
        let pan = null;
        vp.addEventListener('pointerdown', e => {
            if (e.button !== 0 || !REF.nw) return;
            pan = { x: e.clientX, y: e.clientY, ox: REF.x, oy: REF.y };
            vp.classList.add('pan');
            try { vp.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
            e.preventDefault();
        });
        vp.addEventListener('pointermove', e => {
            if (!pan) return;
            REF.x = pan.ox + e.clientX - pan.x;
            REF.y = pan.oy + e.clientY - pan.y;
            REF.userView = true;
            refApplyView();
        });
        const endPan = () => { pan = null; vp.classList.remove('pan'); };
        vp.addEventListener('pointerup', endPan);
        vp.addEventListener('pointercancel', endPan);
        vp.addEventListener('dblclick', refFit);

        // при изменении размера окна заново вписываем, если пользователь не двигал вид сам
        // when the window is resized we fit again, unless the user moved the view themselves
        if (typeof ResizeObserver === 'function') {
            new ResizeObserver(() => { if (!REF.userView && REF.nw) refFit(); }).observe(vp);
        }
        window.addEventListener('resize', () => {
            if (!root.classList.contains('open')) return;
            const r = root.getBoundingClientRect();
            placeRef(r.left, r.top);
        });
    }

    // =====================================================

    // Запуск
    // Bootstrap
    // =====================================================
    // =====================================================
    // Вкладка «Референс» в меню ⚙ UI (управляет окном референса, не дублируя его логику)
    // The "Reference" tab in the ⚙ UI menu (controls the reference window without duplicating its logic)
    // =====================================================
    function buildRefTabPage() {
        const open = h('button', { type: 'button', class: 'gpue-b gpue-ui-primary', text: 'Открыть окно референса' });
        const winBadge = h('span', { class: 'gpue-ui-badge', 'data-st': 'missing', text: 'Окно закрыто' });
        const imgInfo = h('span', { class: 'gpue-ui-muted', style: 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' });
        const url = h('input', { type: 'text', placeholder: 'Ссылка на изображение (https://…)', spellcheck: 'false', 'aria-label': 'Ссылка на изображение' });
        const go = h('button', { type: 'button', class: 'gpue-b', text: 'OK', style: 'flex:none;padding:0 14px', title: 'Загрузить по ссылке (Enter)' });
        const pick = h('button', { type: 'button', class: 'gpue-b', text: '📁 Выбрать файл', title: 'Выбрать картинку на компьютере' });
        const paste = h('button', { type: 'button', class: 'gpue-b', text: '📋 Вставить', title: 'Вставить изображение из буфера обмена' });
        const clearImg = h('button', { type: 'button', class: 'gpue-b gpue-ui-ghost', text: 'Убрать картинку', title: 'Убрать картинку из окна референса' });
        const file = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });

        const zout = h('button', { type: 'button', class: 'gpue-b', text: '－', title: 'Отдалить', 'aria-label': 'Отдалить' });
        const zfit = h('button', { type: 'button', class: 'gpue-b', text: 'Вписать', title: 'Вписать картинку в окно' });
        const zin = h('button', { type: 'button', class: 'gpue-b', text: '＋', title: 'Приблизить', 'aria-label': 'Приблизить' });
        const zval = h('span', { class: 'gpue-val', style: 'flex:none;min-width:58px;text-align:center', text: '—' });
        const moveBtn = h('button', { type: 'button', class: 'gpue-b', text: '✋ Двигать картинку', title: 'Пока включено, картинку можно двигать мышью и масштабировать колесом прямо в окне; рисовать под ней нельзя' });

        const mk = (label, min, max) => {
            const input = h('input', { type: 'range', min: String(min), max: String(max), step: '1', 'aria-label': label });
            const val = h('span', { class: 'gpue-val' });
            return { input, val, row: h('div', { class: 'gpue-row' }, [h('span', { text: label }), input, val]) };
        };
        const op = mk('Прозрачн.', 15, 100);
        const w = mk('Ширина', 240, 1400);
        const hg = mk('Высота', 100, 1000);
        const px = mk('X', 0, 2000);
        const py = mk('Y', 0, 1400);
        const reset = h('button', { type: 'button', class: 'gpue-b', text: '↺ Сбросить размер и положение' });
        const hint = h('div', {
            class: 'gpue-hint',
            text: 'Картинка в окне референса не мешает рисовать: сквозь неё проходят клики. Картинку также можно перетащить в окно или вставить через Ctrl+V, наведя на него курсор.'
        });

        const num = (v, d) => { v = parseInt(v, 10); return isFinite(v) ? v : d; };
        let observed = false;
        const sync = () => {
            if (!refUi) return;
            if (!observed && typeof MutationObserver === 'function') {
                // окно можно открыть/закрыть и его собственными кнопками - вкладка обновляется сама
                // the window can be opened/closed by its own buttons too - the tab updates itself
                observed = true;
                new MutationObserver(() => sync()).observe(refUi.root, { attributes: true, attributeFilter: ['class'] });
            }
            const c = refCfg();
            const root = refUi.root;
            const isOpen = root.classList.contains('open');
            const vals = {
                op: clampNum(c.opacity, 15, 100, 100),
                w: num(root.style.width, 320), h: num(root.style.height, 360),
                x: num(root.style.left, 20), y: num(root.style.top, 90)
            };
            px.input.max = String(Math.max(100, window.innerWidth));
            py.input.max = String(Math.max(100, window.innerHeight));
            op.input.value = vals.op; op.val.textContent = vals.op + '%';
            w.input.value = vals.w; w.val.textContent = vals.w;
            hg.input.value = vals.h; hg.val.textContent = vals.h;
            px.input.value = vals.x; px.val.textContent = vals.x;
            py.input.value = vals.y; py.val.textContent = vals.y;
            if (!url.matches(':focus')) url.value = c.url || '';
            open.textContent = isOpen ? 'Скрыть окно референса' : 'Открыть окно референса';
            open.classList.toggle('gpue-ui-primary', !isOpen);
            winBadge.dataset.st = isOpen ? 'found' : 'missing';
            winBadge.textContent = isOpen ? 'Окно открыто' : 'Окно закрыто';
            const err = refUi.info.classList.contains('err');
            imgInfo.textContent = REF.nw ? (refUi.info.title || refUi.info.textContent || 'картинка загружена') : (err ? refUi.info.textContent : 'картинка не выбрана');
            imgInfo.title = imgInfo.textContent;
            imgInfo.style.color = err ? '#FFB4AE' : '';
            zval.textContent = REF.nw ? Math.round(REF.s * 100) + '%' : '—';
            const moving = root.classList.contains('move');
            moveBtn.classList.toggle('gpue-on', moving);
            moveBtn.setAttribute('aria-pressed', String(moving));
            [zout, zfit, zin, clearImg].forEach(b => { b.disabled = !REF.nw; });
        };
        const saveGeom = () => {
            if (!refUi) return;
            const c = refCfg();
            c.w = num(refUi.root.style.width, 320); c.h = num(refUi.root.style.height, 360);
            c.left = num(refUi.root.style.left, 20); c.top = num(refUi.root.style.top, 90);
            scheduleSave();
        };
        // Загрузка из вкладки сразу показывает окно, иначе результат не виден
        // Loading from the tab immediately shows the window, otherwise the result is invisible
        const ensureOpen = () => { if (refUi && !refUi.root.classList.contains('open')) toggleRef(true); };
        const afterLoad = p => Promise.resolve(p).then(() => {
            sync();
            if (refUi.info.classList.contains('err')) uiToast(refUi.info.textContent || 'Не удалось загрузить картинку', 'error');
            else if (REF.nw) uiToast('Картинка загружена', 'ok', 1800);
        });

        open.addEventListener('click', () => { if (refUi) { toggleRef(); sync(); } });
        const loadUrl = () => {
            if (!refUi || !url.value.trim()) return;
            ensureOpen();
            afterLoad(refLoadUrl(url.value));
        };
        go.addEventListener('click', loadUrl);
        url.addEventListener('keydown', e => { if (e.key === 'Enter') loadUrl(); });
        pick.addEventListener('click', () => file.click());
        file.addEventListener('change', () => {
            const f = file.files && file.files[0];
            file.value = '';
            if (f && refUi) { ensureOpen(); afterLoad(refLoadFile(f)); }
        });
        paste.addEventListener('click', async () => {
            if (!refUi) return;
            const hintKeys = 'Наведите курсор на окно референса и нажмите Ctrl+V.';
            if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
                ensureOpen();
                uiToast('Браузер не даёт читать буфер обмена по кнопке. ' + hintKeys, 'warn');
                return;
            }
            try {
                const items = await navigator.clipboard.read();
                for (const it of items) {
                    const type = (it.types || []).find(t => /^image\//i.test(t));
                    if (!type) continue;
                    const blob = await it.getType(type);
                    ensureOpen();
                    await afterLoad(refLoadFile(blob));
                    return;
                }
                uiToast('В буфере обмена нет изображения. Ссылку вставьте в поле выше.', 'warn');
            } catch (e) {
                ensureOpen();
                uiToast('Нет доступа к буферу обмена. ' + hintKeys, 'warn');
            }
        });
        clearImg.addEventListener('click', () => { if (refUi) { refClear(); sync(); uiToast('Картинка убрана', 'info', 1600); } });
        zin.addEventListener('click', () => { if (refUi && refUi.zoomBy) { refUi.zoomBy(1.25); sync(); } });
        zout.addEventListener('click', () => { if (refUi && refUi.zoomBy) { refUi.zoomBy(0.8); sync(); } });
        zfit.addEventListener('click', () => { if (refUi) { ensureOpen(); refFit(); sync(); } });
        moveBtn.addEventListener('click', () => {
            if (!refUi || !refUi.moveBtn) return;
            ensureOpen();
            if (refUi.root.classList.contains('fold')) { uiToast('Окно референса свёрнуто: разверните его кнопкой ▾ в заголовке окна.', 'warn'); return; }
            refUi.moveBtn.click();
            sync();
        });
        op.input.addEventListener('input', () => {
            if (!refUi) return;
            const v = Number(op.input.value);
            refCfg().opacity = v;
            refUi.root.style.setProperty('--a', String(v / 100));
            if (refUi.op) refUi.op.value = String(v);
            op.val.textContent = v + '%';
            scheduleSave();
        });
        const onSize = () => {
            if (!refUi) return;
            refSize(Number(w.input.value), Number(hg.input.value));
            w.val.textContent = w.input.value; hg.val.textContent = hg.input.value;
            saveGeom();
        };
        w.input.addEventListener('input', onSize);
        hg.input.addEventListener('input', onSize);
        const onPos = () => {
            if (!refUi) return;
            placeRef(Number(px.input.value), Number(py.input.value));
            px.val.textContent = px.input.value; py.val.textContent = py.input.value;
            saveGeom();
        };
        px.input.addEventListener('input', onPos);
        py.input.addEventListener('input', onPos);
        reset.addEventListener('click', () => {
            if (!refUi) return;
            refSize(320, 360);
            placeRef(20, 90);
            refCfg().opacity = 100;
            refUi.root.style.setProperty('--a', '1');
            if (refUi.op) refUi.op.value = '100';
            saveGeom();
            sync();
            uiToast('Размер, положение и прозрачность окна сброшены', 'info', 1800);
        });

        const card = (title, children) => h('div', { class: 'gpue-ui-card' }, [h('div', { class: 'gpue-ui-card-title', text: title })].concat(children));
        const el = h('div', { class: 'gpue-page-inner', style: 'display:flex;flex-direction:column;gap:10px' }, [
            card('Окно референса', [
                h('div', { class: 'gpue-ui-statusline', style: 'flex-wrap:nowrap' }, [winBadge, imgInfo]),
                open
            ]),
            card('Добавить изображение', [
                h('div', { class: 'gpue-btnrow' }, [url, go]),
                h('div', { class: 'gpue-btnrow' }, [pick, paste]),
                file,
                clearImg
            ]),
            card('Масштаб', [
                h('div', { class: 'gpue-btnrow' }, [zout, zval, zin, zfit]),
                moveBtn,
                h('div', { class: 'gpue-hint', text: 'Колесо мыши над картинкой масштабирует её, двойной клик - вписывает (когда включено «Двигать картинку»).' })
            ]),
            card('Наложение', [op.row]),
            card('Положение и размер окна', [w.row, hg.row, px.row, py.row, reset]),
            hint
        ]);
        return { el, sync };
    }

    // =====================================================
    // GPAppearance: вкладка «Внешний вид»
    // GPAppearance: the "Appearance" tab
    //
    // Правила безопасности (чтобы не сломать координаты рисования):
    // Safety rules (so as not to break the drawing coordinates):
    // только CSS и «плавающие» картинки поверх страницы; никаких transform/zoom/padding/border/margin
    // CSS only and "floating" images over the page; no transform/zoom/padding/border/margin
    // и размеров на canvas и его контейнерах;
    // or sizes on the canvas and its containers;
    // тени и рамки-цвета рисуются через box-shadow (геометрию не меняют);
    // shadows and colored frames are drawn via box-shadow (they do not change the geometry);
    // рамки-картинки - отдельные элементы position:fixed с pointer-events:none: клики и перо идут сквозь них;
    // image frames are separate position:fixed elements with pointer-events:none: clicks and the pen go through them;
    // цвет/шрифт только внутри панелей Gartic, а не на всём .draw;
    // color/font only inside Gartic panels, not on the whole .draw;
    // фон/цвет через background-color (иконки-картинки на кнопках остаются);
    // background/color via background-color (image icons on buttons remain);
    // группа применяется, только если пользователь её менял: пока ничего не тронуто, вид игры прежний.
    // a group is applied only if the user changed it: while nothing is touched, the game looks as before.
    // =====================================================
    const GPAppearance = (() => {
        const APP_KEY = 'gpUiAppearance.v1';
        const COLOR_RE = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i;
        const IMG_RE = /^data:image\/(?:png|jpe?g|webp|gif|avif|bmp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
        const IMG_MAX_CHARS = 5000000;   // одна картинка (data URL), ~3,7 МБ файла | one image (a data URL), ~3.7 MB of the file
        const IMG_TOTAL_MAX = 24000000;  // все картинки вместе | all images together
        const GROUPS = ['interface', 'panels', 'buttons', 'text'];
        const BTN_TARGETS = ['all', 'tools', 'colors', 'bottom', 'header', 'done', 'custom'];
        const EXTRA = ['editor', 'custom', 'overlay', 'background']; // группы без «touched»: работают независимо от остального | groups without "touched": they work independently of the rest
        const OV_FITS = ['stretch', 'contain', 'cover'];
        const OV_FIT_LABELS = { stretch: 'Растянуть', contain: 'Вписать', cover: 'Заполнить' };
        const BG_FITS = ['cover', 'contain', 'stretch', 'repeat', 'center'];
        const BG_FIT_LABELS = { cover: 'Заполнить', contain: 'Вписать', stretch: 'Растянуть', repeat: 'Плиткой', center: 'По центру' };
        const ENUMS = {
            'overlay.fit': OV_FITS,
            'background.mode': ['none', 'color', 'image'],
            'background.fit': BG_FITS,
            'buttons.fontWeight': ['', 'normal', '500', '600', 'bold'],
            'buttons.target': BTN_TARGETS
        };
        // Настоящий canvas рисования: тот, что внутри .drawingContainer (курсорный canvas лежит прямо в .core - см. getCursorCanvas).
        // The real drawing canvas: the one inside .drawingContainer (the cursor canvas lies right in .core - see getCursorCanvas).
        const CANVAS_FRAME_SEL = '.draw .drawingContainer canvas';
        const OVERLAY_ID = 'gpue-bg-overlay';
        const OVERLAY_KEY = 'bgoverlay'; // ключ в ELEMENTS / state.elements (положение и размер задаются во вкладке «Раскладка») | a key in ELEMENTS / state.elements (the position and size are set in the "Layout" tab)
        const SKIN_MAX_COUNT = 40;
        const SKIN_MAX_SIZE = 2000;
        // Картинки (рамка, фон, замены элементов) лежат отдельно от настроек: чтобы каждое движение ползунка не
        // Images (frame, background, element replacements) are stored separately from the settings: so that every slider movement does not
        // переписывало мегабайты данных. В настройках остаются только имена файлов и размеры.
        // rewrite megabytes of data. Only file names and sizes remain in the settings.
        const IMG_KEY = 'gpUiAppearance.images.v1';
        const IMG_SLOT_RE = /^(overlay|background|skin:[a-z0-9_]{1,40})$/;
        const imgStore = new Map(); // слот -> data URL | slot -> data URL
        const TARGET_LABELS = {
            colors: 'Цвета', tools: 'Инструменты', bottom: 'Нижняя', timer: 'Таймер', round: 'Раунд', header: 'Верхняя'
        };

        const DEFAULTS = {
            enabled: true,
            theme: 'default',
            touched: { interface: false, panels: false, buttons: false, text: false },
            interface: { opacity: 100, radius: 8, shadow: true, blur: false },
            panels: {
                background: '#1b1b1b', opacity: 95, border: true, borderColor: '#3a3a3a', borderWidth: 1,
                targets: { colors: true, tools: true, bottom: true, timer: false, round: false, header: false }
            },
            // Свойства со значением «как в игре» (пусто / 0 / 100) в CSS не попадают: меняется только то, что трогал пользователь.
            // Properties with the value "as in the game" (empty / 0 / 100) do not get into the CSS: only what the user touched changes.
            buttons: {
                background: '#292929', hover: '#3a3a3a', active: '#008cff', text: '#ffffff', radius: 6,
                borderColor: '#00aaff', borderWidth: 0, shadow: false, opacity: 100,
                fontFamily: '', fontSize: 0, fontWeight: '',
                target: 'all', customSelector: ''
            },
            text: { font: 'Arial, sans-serif', size: 14, color: '#ffffff', bold: false, shadow: false },
            // Рамка холста: PNG поверх холста; клики и перо проходят сквозь него (кроме режима редактирования)
            // Canvas frame: a PNG over the canvas; clicks and the pen go through it (except in editing mode)
            overlay: { enabled: true, opacity: 100, fit: 'stretch', imageName: '' },
            // Фон страницы: цвет или картинка/GIF
            // Page background: a color or an image/GIF
            background: { mode: 'none', color: '#202020', fit: 'cover', imageName: '' },
            // Замена элементов интерфейса картинками: [{ key, w, h, fit, hide, imageName }]; w/h = 0 - размер элемента
            // Replacing UI elements with images: [{ key, w, h, fit, hide, imageName }]; w/h = 0 - the size of the element
            skins: [],
            editor: { transparent: false, opacity: 50, solidOnHover: true },
            custom: { enabled: false, important: true, css: '' }
        };

        const RANGES = {
            'interface.opacity': [20, 100], 'interface.radius': [0, 30],
            'panels.opacity': [0, 100], 'panels.borderWidth': [0, 10],
            'buttons.radius': [0, 30], 'buttons.borderWidth': [0, 6], 'buttons.opacity': [20, 100], 'buttons.fontSize': [0, 32],
            'text.size': [8, 32],
            'overlay.opacity': [10, 100],
            'editor.opacity': [15, 95]
        };

        // Темы задают только «внешность»: цвета, рамки, тени. Размеры, шрифты и выбор целей они не меняют.
        // Themes define only the "look": colors, frames, shadows. They do not change sizes, fonts or target selection.
        const THEMES = {
            standard: {
                name: 'Standard', blur: false,
                panels: { background: '#1b1b1b', opacity: 95, borderColor: '#3a3a3a' },
                buttons: { background: '#292929', hover: '#3a3a3a', active: '#008cff', text: '#ffffff' },
                text: { color: '#ffffff' }
            },
            dark: {
                name: 'Dark', blur: false,
                panels: { background: '#111111', opacity: 97, borderColor: '#303030' },
                buttons: { background: '#1c1c1c', hover: '#303030', active: '#008cff', text: '#ffffff' },
                text: { color: '#ffffff' }
            },
            light: {
                name: 'Light', blur: false,
                panels: { background: '#eeeeee', opacity: 98, borderColor: '#cccccc' },
                buttons: { background: '#ffffff', hover: '#dddddd', active: '#2589ff', text: '#222222' },
                text: { color: '#222222' }
            },
            glass: {
                name: 'Glass', blur: true,
                panels: { background: '#191919', opacity: 55, borderColor: '#5a5a5a' },
                buttons: { background: '#3b3b3b', hover: '#505050', active: '#0096ff', text: '#ffffff' },
                text: { color: '#ffffff' }
            },
            neon: {
                name: 'Neon', blur: false,
                panels: { background: '#0d1117', opacity: 97, borderColor: '#00aaff' },
                buttons: { background: '#111827', hover: '#172554', active: '#00d9ff', text: '#ffffff', borderColor: '#00d9ff', borderWidth: 1 },
                text: { color: '#00eaff' }
            },
            cyberpunk: {
                name: 'Cyberpunk', blur: false,
                interface: { radius: 4 },
                panels: { background: '#0b0b1a', opacity: 94, borderColor: '#ff2bd6' },
                buttons: { background: '#14102a', hover: '#241a4a', active: '#00f0ff', text: '#00f0ff', radius: 4, borderColor: '#ff2bd6', borderWidth: 1, shadow: true },
                text: { color: '#00f0ff' }
            },
            retro: {
                name: 'Retro', blur: false,
                interface: { radius: 0, shadow: false },
                panels: { background: '#c9b88a', opacity: 100, borderColor: '#5b4a2a', borderWidth: 2 },
                buttons: { background: '#e3d4a1', hover: '#f0e4b8', active: '#d9822b', text: '#3b2f1a', radius: 0, borderColor: '#5b4a2a', borderWidth: 2 },
                text: { color: '#3b2f1a' }
            }
        };

        const FONTS = [
            ['Arial', 'Arial, sans-serif'],
            ['Segoe UI', "'Segoe UI', Tahoma, sans-serif"],
            ['Verdana', 'Verdana, Geneva, sans-serif'],
            ['Tahoma', 'Tahoma, Geneva, sans-serif'],
            ['Trebuchet MS', "'Trebuchet MS', sans-serif"],
            ['Georgia', 'Georgia, serif'],
            ['Times New Roman', "'Times New Roman', serif"],
            ['Courier New', "'Courier New', monospace"],
            ['Comic Sans MS', "'Comic Sans MS', cursive"],
            ['Системный', 'system-ui, sans-serif']
        ];

        const clone = o => JSON.parse(JSON.stringify(o));
        let settings = clone(DEFAULTS);
        let saveT = null;
        let syncAll = () => {};
        let syncTheme = () => {};

        // --------- проверка значений (импортируемым файлам не доверяем) ----------
        // --------- value validation (imported files are not trusted) ----------
        const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
        const normColor = v => {
            let c = String(v).toLowerCase();
            if (c.length === 4) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
            return c;
        };
        function cleanFont(v, def) {
            if (typeof v !== 'string') return def;
            const f = v.trim();
            return f && f.length <= 120 && /^[\p{L}\p{N}\s,'"\-.]+$/u.test(f) ? f : def;
        }
        // Селектор для кнопок «Выбранный элемент»: без {} ; \ / , и с проверкой браузером, чтобы он не мог вырваться из CSS-правила.
        // Selector for the "Selected element" buttons: no {} ; \ / , and checked by the browser so that it cannot break out of the CSS rule.
        function cleanSelector(v) {
            if (typeof v !== 'string') return '';
            const t = v.trim();
            if (!t || t.length > 200 || !/^[\p{L}\p{N}\s>+~.#:\[\]="'()*^$|_-]+$/u.test(t)) return '';
            try { document.querySelector(t); } catch (e) { return ''; }
            return t;
        }
        function cleanImageName(v) {
            return String(v == null ? '' : v).replace(/[\u0000-\u001f<>\\/:*?"|]/g, '').trim().slice(0, 80);
        }
        // Допустимый ключ элемента: собственный ключ ELEMENTS или custom_* (унаследованные имена вроде constructor и __proto__ не проходят)
        // A valid element key: an own ELEMENTS key or custom_* (inherited names like constructor and __proto__ are rejected)
        const validElKey = k => typeof k === 'string' && (has(ELEMENTS, k) || /^custom_[a-z0-9]{1,30}$/.test(k));
        function cleanSkin(sk) {
            if (!sk || typeof sk !== 'object' || !validElKey(sk.key)) return null;
            const n = v => Math.min(SKIN_MAX_SIZE, Math.max(0, Math.round(Number(v) || 0)));
            return {
                key: sk.key, w: n(sk.w), h: n(sk.h),
                fit: OV_FITS.includes(sk.fit) ? sk.fit : 'stretch',
                hide: typeof sk.hide === 'boolean' ? sk.hide : true,
                imageName: cleanImageName(sk.imageName)
            };
        }
        const cleanThemeName = n => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
        const isThemeName = n => typeof n === 'string' && (has(THEMES, n) || n === 'custom' || n === 'default' || /^user:[a-z0-9]{3,24}$/.test(n));

        function coerce(path, v, def) {
            if (typeof def === 'number') {
                const n = Number(v);
                if (!isFinite(n)) return def;
                const r = RANGES[path];
                return r ? Math.min(r[1], Math.max(r[0], Math.round(n))) : n;
            }
            if (typeof def === 'boolean') return typeof v === 'boolean' ? v : def;
            if (path === 'text.font') return cleanFont(v, def);
            if (path === 'custom.css') return typeof v === 'string' ? v.slice(0, 100000) : def;
            if (path === 'buttons.fontFamily') return v === '' ? '' : cleanFont(v, '');
            if (path === 'buttons.customSelector') return cleanSelector(v);
            if (/\.imageName$/.test(path)) return cleanImageName(v);
            if (has(ENUMS, path)) return ENUMS[path].includes(v) ? v : def;
            return typeof v === 'string' && COLOR_RE.test(v) ? normColor(v) : def;
        }
        function sanitize(src) {
            const out = clone(DEFAULTS);
            if (!src || typeof src !== 'object') return out;
            const s = src.settings && typeof src.settings === 'object' ? src.settings : src;
            if (typeof s.enabled === 'boolean') out.enabled = s.enabled;
            if (isThemeName(s.theme)) out.theme = s.theme;
            if (s.touched && typeof s.touched === 'object') {
                for (const g of GROUPS) if (typeof s.touched[g] === 'boolean') out.touched[g] = s.touched[g];
            }
            for (const g of GROUPS.concat(EXTRA)) {
                const src2 = s[g];
                if (!src2 || typeof src2 !== 'object') continue;
                for (const k of Object.keys(DEFAULTS[g])) {
                    if (k === 'targets') {
                        const t = src2.targets;
                        if (t && typeof t === 'object') {
                            for (const tk of Object.keys(DEFAULTS.panels.targets)) {
                                if (typeof t[tk] === 'boolean') out.panels.targets[tk] = t[tk];
                            }
                        }
                        continue;
                    }
                    if (has(src2, k)) out[g][k] = coerce(g + '.' + k, src2[k], DEFAULTS[g][k]);
                }
            }
            if (Array.isArray(s.skins)) {
                const seen = new Set();
                for (const sk of s.skins.slice(0, SKIN_MAX_COUNT)) {
                    const e = cleanSkin(sk);
                    if (e && !seen.has(e.key)) { seen.add(e.key); out.skins.push(e); }
                }
            }
            return out;
        }

        // --------- хранение (тот же механизм, что у редактора, но отдельный ключ) ----------
        // --------- storage (the same mechanism as the editor's, but a separate key) ----------
        const slotImage = slot => imgStore.get(slot) || '';

        function loadImages() {
            imgStore.clear();
            const o = readKey(IMG_KEY);
            if (!o || typeof o !== 'object') return;
            let total = 0;
            for (const slot of Object.keys(o)) {
                const v = o[slot];
                if (!IMG_SLOT_RE.test(slot) || typeof v !== 'string' || v.length > IMG_MAX_CHARS || !IMG_RE.test(v)) continue;
                total += v.length;
                if (total > IMG_TOTAL_MAX) break;
                imgStore.set(slot, v);
            }
        }
        function persistImages() {
            const o = {};
            imgStore.forEach((v, k) => { o[k] = v; });
            return writeKey(IMG_KEY, o);
        }
        // Кладёт/убирает картинку слота. Бросает ошибку, если не хватает места.
        // Puts/removes the slot image. Throws an error if there is not enough space.
        function setSlotImage(slot, dataUrl) {
            if (!IMG_SLOT_RE.test(slot)) return false;
            if (dataUrl) {
                if (!IMG_RE.test(dataUrl) || dataUrl.length > IMG_MAX_CHARS) throw new Error('Картинка не подходит: слишком большая или неверный формат.');
                let total = dataUrl.length;
                imgStore.forEach((v, k) => { if (k !== slot) total += v.length; });
                if (total > IMG_TOTAL_MAX) throw new Error('Слишком много картинок в хранилище: уберите ненужные замены.');
                imgStore.set(slot, dataUrl);
            } else {
                imgStore.delete(slot);
            }
            persistImages();
            return true;
        }

        function load() {
            let parsed = null;
            try {
                const raw = typeof GM_getValue === 'function' ? GM_getValue(APP_KEY, null) : localStorage.getItem(APP_KEY);
                parsed = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
                settings = parsed ? sanitize(parsed) : clone(DEFAULTS);
            } catch (e) {
                settings = clone(DEFAULTS);
            }
            loadImages();
            // миграция: раньше PNG рамки хранился прямо в настройках
            // migration: the frame PNG used to be stored right in the settings
            try {
                const old = parsed && parsed.overlay && parsed.overlay.image;
                if (typeof old === 'string' && IMG_RE.test(old) && old.length <= IMG_MAX_CHARS && !imgStore.has('overlay')) {
                    imgStore.set('overlay', old);
                    if (!settings.overlay.imageName) settings.overlay.imageName = 'frame.png';
                    persistImages();
                }
            } catch (e) { /* ignore */ }
        }
        function save() {
            try {
                const raw = JSON.stringify(settings);
                if (typeof GM_setValue === 'function') GM_setValue(APP_KEY, raw);
                else localStorage.setItem(APP_KEY, raw);
                uiSaveDone('appearance', true);
            } catch (e) { uiSaveDone('appearance', false); }
        }
        const scheduleSaveA = () => { clearTimeout(saveT); uiSavePending('appearance'); saveT = setTimeout(save, 300); };

        // --------- CSS ----------
        const rgb = hex => {
            const c = normColor(hex);
            return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
        };
        const fitCss = fit => {
            const m = {
                cover: 'background-size:cover;background-repeat:no-repeat;background-position:center',
                contain: 'background-size:contain;background-repeat:no-repeat;background-position:center',
                stretch: 'background-size:100% 100%;background-repeat:no-repeat',
                repeat: 'background-size:auto;background-repeat:repeat',
                center: 'background-size:auto;background-repeat:no-repeat;background-position:center'
            };
            return (m[fit] || m.cover).split(';').map(x => x + '!important').join(';');
        };
        const selOf = k => (ELEMENTS[k] && ELEMENTS[k].selector) || '';

        function buildCss(s) {
            if (!s.enabled) return '';
            const P = s.panels, I = s.interface, B = s.buttons, T = s.text, X = s.touched;
            const out = [];

            // фон страницы: цвет или картинка/GIF (внешние стили игры перекрываем только в этих селекторах)
            // page background: a color or an image/GIF (the game's external styles are overridden only in these selectors)
            const BG = s.background;
            if (BG.mode === 'color') {
                out.push('html,body,#__next,.draw{background-color:' + BG.color + '!important;background-image:none!important}');
            } else if (BG.mode === 'image') {
                const img = slotImage('background');
                out.push('html,body,#__next,.draw{background-color:' + BG.color + '!important' +
                    (img ? ';background-image:url("' + img + '")!important;' + fitCss(BG.fit) + ';background-attachment:fixed!important' : '') + '}');
            }

            // замены элементов интерфейса: исходный элемент становится прозрачным, но остаётся на месте и кликабельным
            // UI element replacements: the original element becomes transparent but stays in place and clickable
            for (const sk of s.skins) {
                if (sk.hide && sk.key !== OVERLAY_KEY && ELEMENTS[sk.key] && slotImage('skin:' + sk.key)) {
                    out.push(ELEMENTS[sk.key].selector + '{opacity:0!important}');
                }
            }

            // панели Gartic
            // Gartic panels
            const targets = Object.keys(P.targets).filter(k => P.targets[k]).map(selOf).filter(Boolean);
            if (targets.length) {
                const d = [];
                const shadows = [];
                if (X.panels) {
                    const [r, g, b] = rgb(P.background);
                    d.push('background-color:rgba(' + r + ',' + g + ',' + b + ',' + P.opacity / 100 + ')!important');
                    if (P.border && P.borderWidth > 0) shadows.push('inset 0 0 0 ' + P.borderWidth + 'px ' + P.borderColor);
                }
                if (X.interface) {
                    d.push('border-radius:' + I.radius + 'px!important');
                    if (I.shadow) shadows.push('0 4px 20px rgba(0,0,0,.35)');
                    if (I.blur) d.push('backdrop-filter:blur(12px)', '-webkit-backdrop-filter:blur(12px)');
                    if (I.opacity < 100) d.push('opacity:' + I.opacity / 100);
                }
                if (X.panels || X.interface) d.push('box-shadow:' + (shadows.length ? shadows.join(',') : 'none') + '!important');
                if (d.length) out.push(targets.join(',') + '{' + d.join(';') + '}');

                if (X.text) {
                    const inner = ':where(span,p,label,div,h1,h2,h3,h4,h5,h6,strong,b,a,li)';
                    const withInner = targets.map(t => t + ',' + t + ' ' + inner).join(',');
                    const withAll = targets.map(t => t + ',' + t + ' *:not([class*="icon" i])').join(',');
                    out.push(withInner + '{color:' + T.color + '!important}');
                    out.push(withAll + '{font-family:' + T.font + '!important}');
                    out.push(targets.join(',') + '{font-size:' + T.size + 'px!important}');
                    if (T.bold) out.push(withInner + '{font-weight:700!important}');
                    if (T.shadow) out.push(withInner + '{text-shadow:0 1px 2px rgba(0,0,0,.6)}');
                }
            }

            // кнопки (ButtonStyler). Селекторы только из ELEMENTS (их уже использует Layout Editor) или выбранные пользователем.
            // buttons (ButtonStyler). Selectors only from ELEMENTS (the Layout Editor already uses them) or chosen by the user.
            // Кнопки с inline-фоном (цветные образцы) не трогаем. Рамка - inset box-shadow: размеры кнопки не меняются.
            // Buttons with an inline background (color swatches) are not touched. The frame is an inset box-shadow: button sizes do not change.
            if (X.buttons) {
                const nb = ':not([style*="background"])';
                const panels = [];
                const direct = [];
                if (B.target === 'all') ['tools', 'bottom', 'header'].forEach(k => panels.push(selOf(k)));
                else if (B.target === 'custom') { if (B.customSelector) { direct.push(B.customSelector); panels.push(B.customSelector); } }
                else if (B.target !== 'done') panels.push(selOf(B.target));
                if (B.target === 'all' || B.target === 'done') direct.push(selOf('done'));
                const dirList = direct.filter(Boolean), panList = panels.filter(Boolean);
                if (dirList.length || panList.length) {
                    const variants = suf => {
                        const r = [];
                        for (const d of dirList) for (const x of suf) r.push(d + x);
                        for (const p of panList) for (const base of ['button', '[role="button"]']) for (const x of suf) r.push(p + ' ' + base + nb + x);
                        return r.join(',');
                    };
                    const base = ['background-color:' + B.background + '!important', 'color:' + B.text + '!important',
                        'border-radius:' + B.radius + 'px!important', 'transition:background-color .15s ease,box-shadow .15s ease'];
                    const bs = [];
                    if (B.borderWidth > 0) bs.push('inset 0 0 0 ' + B.borderWidth + 'px ' + B.borderColor);
                    if (B.shadow) bs.push('0 2px 8px rgba(0,0,0,.45)');
                    if (bs.length) base.push('box-shadow:' + bs.join(',') + '!important');
                    if (B.opacity < 100) base.push('opacity:' + B.opacity / 100);
                    if (B.fontFamily) base.push('font-family:' + B.fontFamily + '!important');
                    if (B.fontSize > 0) base.push('font-size:' + B.fontSize + 'px!important');
                    if (B.fontWeight) base.push('font-weight:' + B.fontWeight + '!important');
                    out.push(variants(['']) + '{' + base.join(';') + '}');
                    out.push(variants([':hover']) + '{background-color:' + B.hover + '!important}');
                    out.push(variants([':active', '.active', '.selected', '[aria-pressed="true"]', '[aria-selected="true"]']) +
                        '{background-color:' + B.active + '!important}');
                }
            }

            return out.join('\n');
        }

        function injectCSS() {
            let el = document.getElementById('gp-appearance-style');
            if (!el) {
                el = document.createElement('style');
                el.id = 'gp-appearance-style';
                (document.head || document.documentElement).appendChild(el);
            }
            return el;
        }

        // --------- рамки-картинки: отдельные плавающие элементы, сквозь которые проходят клики и перо ----------
        // --------- image frames: separate floating elements that clicks and the pen go through ----------

        // Визуальные слои поверх страницы: «Рамка холста» (PNG) и картинки-замены элементов интерфейса.
        // Visual layers over the page: the "Canvas frame" (PNG) and images replacing UI elements.
        // Это отдельные элементы position:fixed, которые каждый кадр повторяют rect цели. Они не вмешиваются ни в canvas,
        // These are separate position:fixed elements that repeat the target's rect every frame. They interfere with neither the canvas
        // ни в события: у замен pointer-events:none всегда, у рамки - всегда, кроме режима редактирования (html.gpue-edit,
        // nor the events: replacements always have pointer-events:none; the frame has it too, except in editing mode (html.gpue-edit,
        // правило в CSS редактора) - там рамку можно выбрать, двигать и масштабировать как элемент «Раскладки»
        // a rule in the editor's CSS) - there the frame can be selected, moved and scaled like a "Layout" element
        // (transform накладывает сам Layout Editor по селектору #gpue-bg-overlay; здесь transform не трогаем).
        // (the transform is applied by the Layout Editor itself via the #gpue-bg-overlay selector; the transform is not touched here).
        const vis = { raf: 0, frame: { target: null, miss: 0, last: '' }, skins: new Map() };

        function findTarget(sel) {
            let list;
            try { list = document.querySelectorAll(sel); } catch (e) { return null; }
            for (const n of list) {
                const r = n.getBoundingClientRect();
                if (r.width > 1 && r.height > 1) return n;
            }
            return null;
        }

        function visualLoop() {
            vis.raf = 0;
            if (document.hidden) { vis.raf = requestAnimationFrame(visualLoop); return; }
            let any = false;
            const frameEl = document.getElementById(OVERLAY_ID);
            if (frameEl) {
                any = true;
                const f = vis.frame;
                if (!f.target || !f.target.isConnected) {
                    if (f.miss++ % 20 === 0) f.target = document.querySelector(CANVAS_FRAME_SEL);
                }
                const r = f.target && f.target.isConnected ? f.target.getBoundingClientRect() : null;
                const st = frameEl.style;
                if (!r || r.width < 2 || r.height < 2) {
                    if (f.last !== 'hide') { st.display = 'none'; f.last = 'hide'; }
                } else {
                    const key = [r.left, r.top, r.width, r.height].map(v => Math.round(v * 10)).join(',');
                    if (key !== f.last) {
                        st.display = 'block';
                        st.left = r.left + 'px';
                        st.top = r.top + 'px';
                        st.width = r.width + 'px';
                        st.height = r.height + 'px';
                        f.last = key;
                    }
                }
            }
            for (const it of vis.skins.values()) {
                any = true;
                if (!it.target || !it.target.isConnected) {
                    if (it.miss++ % 20 === 0) it.target = findTarget(it.sel);
                }
                const st = it.el.style;
                const r = it.target && it.target.isConnected ? it.target.getBoundingClientRect() : null;
                if (!r || r.width < 2 || r.height < 2) {
                    if (it.last !== 'hide') { st.display = 'none'; it.last = 'hide'; }
                    continue;
                }
                const w = it.sk.w > 0 ? it.sk.w : r.width;
                const hh = it.sk.h > 0 ? it.sk.h : r.height;
                const key = [r.left, r.top, r.width, r.height, w, hh].map(v => Math.round(v * 10)).join(',');
                if (key !== it.last) {
                    st.display = 'block';
                    st.left = (r.left + (r.width - w) / 2) + 'px';
                    st.top = (r.top + (r.height - hh) / 2) + 'px';
                    st.width = w + 'px';
                    st.height = hh + 'px';
                    it.last = key;
                }
            }
            if (any) vis.raf = requestAnimationFrame(visualLoop);
        }

        function syncVisuals() {
            // -- рамка холста ---
            // -- canvas frame ---
            const O = settings.overlay;
            const frameImg = slotImage('overlay');
            let el = document.getElementById(OVERLAY_ID);
            if (!settings.enabled || !O.enabled || !frameImg) {
                if (el) el.remove();
                vis.frame.last = '';
            } else {
                if (!el) {
                    el = document.createElement('div');
                    el.id = OVERLAY_ID;
                    el.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;margin:0;padding:0;z-index:900;display:none;' +
                        'background-repeat:no-repeat;background-position:center';
                    (document.body || document.documentElement).appendChild(el);
                    vis.frame.last = '';
                }
                el.style.backgroundImage = 'url("' + frameImg + '")';
                el.style.backgroundSize = O.fit === 'stretch' ? '100% 100%' : O.fit;
                el.style.opacity = String(O.opacity / 100);
            }
            // -- замены элементов интерфейса ---
            // -- UI element replacements ---
            const want = new Map();
            if (settings.enabled) {
                for (const sk of settings.skins) {
                    if (sk.key !== OVERLAY_KEY && ELEMENTS[sk.key] && slotImage('skin:' + sk.key)) want.set(sk.key, sk);
                }
            }
            for (const [k, it] of vis.skins) {
                if (!want.has(k)) { it.el.remove(); vis.skins.delete(k); }
            }
            for (const [k, sk] of want) {
                let it = vis.skins.get(k);
                if (!it) {
                    // при повторном запуске скрипта переиспользуем существующий элемент, а не плодим дубли
                    // on a repeated script run we reuse the existing element instead of spawning duplicates
                    let e2 = document.querySelector('.gpe-skin[data-key="' + k + '"]');
                    if (!e2) {
                        e2 = document.createElement('div');
                        e2.className = 'gpe-skin';
                        e2.dataset.key = k;
                        e2.style.cssText = 'position:fixed;pointer-events:none;margin:0;padding:0;z-index:901;display:none;' +
                            'background-repeat:no-repeat;background-position:center';
                        (document.body || document.documentElement).appendChild(e2);
                    }
                    it = { el: e2, target: null, miss: 0, last: '', sel: ELEMENTS[k].selector, sk };
                    vis.skins.set(k, it);
                }
                it.sk = sk;
                it.sel = ELEMENTS[k].selector;
                it.last = '';
                it.el.style.backgroundImage = 'url("' + slotImage('skin:' + k) + '")';
                it.el.style.backgroundSize = sk.fit === 'stretch' ? '100% 100%' : sk.fit;
            }
            if ((document.getElementById(OVERLAY_ID) || vis.skins.size) && !vis.raf) vis.raf = requestAnimationFrame(visualLoop);
        }

        // --------- прозрачность окон редактора (отдельно от остального внешнего вида) ----------
        // --------- editor window opacity (separate from the rest of the appearance) ----------
        function applyEditor() {
            const E = settings.editor;
            let el = document.getElementById('gp-appearance-editor');
            if (!el) {
                el = document.createElement('style');
                el.id = 'gp-appearance-editor';
                (document.head || document.documentElement).appendChild(el);
            }
            el.textContent = !E.transparent ? '' :
                '#gpue-panel,#gpue-wheel{opacity:' + E.opacity / 100 + ';transition:opacity .15s ease}' +
                (E.solidOnHover ? '#gpue-panel:hover,#gpue-wheel:hover{opacity:1}' : '');
        }

        // --------- свой CSS пользователя ----------
        // --------- the user's own CSS ----------
        let customNotes = [];

        // Внешние ссылки (@import, url(http…)) вырезаем: импортированный файл не должен «звонить» наружу.
        // External links (@import, url(http…)) are cut out: an imported file must not "phone home".
        function processCustomCss(text, important) {
            let css = String(text || '');
            const notes = [];
            let blocked = 0;
            css = css.replace(/@import\b[^;{}]*;?/gi, () => { blocked++; return ''; });
            css = css.replace(/url\(\s*(['"]?)\s*(?:https?:)?\/\/[^)]*\)/gi, () => { blocked++; return 'url("about:blank")'; });
            if (blocked) notes.push('Заблокировано внешних ссылок: ' + blocked + ' (используйте картинку из файла).');
            if (important) css = addImportant(css);
            return { css, notes };
        }

        // Добавляет !important к каждому объявлению. Свой разбор текста (строки, комментарии, скобки и url(data:…;…)
        // Adds !important to every declaration. Our own text parsing (strings, comments, brackets and url(data:…;…)
        // учитываются), чтобы не зависеть от того, как конкретный браузер сериализует CSS.
        // are taken into account), so we do not depend on how a particular browser serializes CSS.
        function addImportant(css) {
            const GROUP_AT = /^@(media|supports|layer|container|document|scope|starting-style)\b/i;
            const NOBANG_AT = /^@(-\w+-)?(keyframes|font-face|property|counter-style|page|font-feature-values|font-palette-values|view-transition)\b/i;
            const out = [];
            const stack = [];
            let declStart = 0;
            let paren = 0;
            const pending = () => out.slice(declStart).join('');
            const flushBang = () => {
                if (stack[stack.length - 1] !== 'decl') return;
                const t = pending();
                if (t.trim() && t.indexOf(':') >= 0 && !/!\s*important\s*$/i.test(t.trimEnd())) out.push(' !important');
            };
            let i = 0;
            const n = css.length;
            while (i < n) {
                const ch = css[i];
                if (ch === '/' && css[i + 1] === '*') {
                    const e = css.indexOf('*/', i + 2);
                    const end = e < 0 ? n : e + 2;
                    out.push(css.slice(i, end));
                    i = end;
                    continue;
                }
                if (ch === '"' || ch === "'") {
                    let j = i + 1;
                    while (j < n && css[j] !== ch) { if (css[j] === '\\') j++; j++; }
                    out.push(css.slice(i, Math.min(n, j + 1)));
                    i = j + 1;
                    continue;
                }
                if (ch === '(') paren++;
                else if (ch === ')') paren = Math.max(0, paren - 1);
                if (paren > 0) { out.push(ch); i++; continue; }
                if (ch === '{') {
                    const top = stack[stack.length - 1];
                    const prelude = pending().trim();
                    let kind;
                    if (top === 'decl') kind = 'decl';
                    else if (top === 'nobang') kind = 'nobang';
                    else if (NOBANG_AT.test(prelude)) kind = 'nobang';
                    else if (GROUP_AT.test(prelude)) kind = 'group';
                    else if (prelude[0] === '@') kind = 'nobang';
                    else kind = 'decl';
                    stack.push(kind);
                    out.push(ch);
                    declStart = out.length;
                } else if (ch === ';') {
                    flushBang();
                    out.push(ch);
                    declStart = out.length;
                } else if (ch === '}') {
                    flushBang();
                    stack.pop();
                    out.push(ch);
                    declStart = out.length;
                } else {
                    out.push(ch);
                }
                i++;
            }
            return out.join('');
        }

        function applyCustom() {
            const C = settings.custom;
            let el = document.getElementById('gp-appearance-custom');
            if (!el) {
                el = document.createElement('style');
                el.id = 'gp-appearance-custom';
                (document.head || document.documentElement).appendChild(el);
            }
            customNotes = [];
            if (!settings.enabled) {
                el.textContent = '';
                if (C.enabled && C.css.trim()) customNotes.push('Свой CSS не применяется: выключен переключатель «Включить пользовательский внешний вид».');
                return;
            }
            if (!C.enabled || !C.css.trim()) { el.textContent = ''; return; }
            const r = processCustomCss(C.css, C.important);
            el.textContent = r.css;
            customNotes = r.notes;
        }

        const listeners = [];

        function apply() {
            injectCSS().textContent = buildCss(settings);
            applyEditor();
            applyCustom();
            syncVisuals();
            scheduleSaveA();
            listeners.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });
        }

        // --------- чтение картинки из локального файла ----------
        // --------- reading an image from a local file ----------
        // Маленькие файлы сохраняем как есть; большие статичные уменьшаем (webp с прозрачностью). GIF не пережимаем:
        // Small files are stored as is; large static ones are shrunk (webp with transparency). GIFs are not recompressed:
        // иначе пропала бы анимация, поэтому слишком большой GIF отклоняется.
        // otherwise the animation would be lost, so an overly large GIF is rejected.
        function readImageFile(file, maxSide) {
            return new Promise((resolve, reject) => {
                if (!file || !/^image\//i.test(file.type || '')) { reject(new Error('Это не изображение.')); return; }
                const isGif = /^image\/gif$/i.test(file.type) || /\.gif$/i.test(file.name || '');
                const tooBig = () => new Error(isGif
                    ? 'GIF слишком большой (больше ~3,5 МБ). Выберите файл поменьше.'
                    : 'Файл слишком большой даже после сжатия. Выберите картинку поменьше.');
                const finish = url => {
                    if (url.length <= IMG_MAX_CHARS && IMG_RE.test(url)) resolve(url);
                    else reject(tooBig());
                };
                const shrink = () => {
                    const objUrl = URL.createObjectURL(file);
                    const img = new Image();
                    img.onload = () => {
                        try {
                            const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
                            const c = document.createElement('canvas');
                            c.width = Math.max(1, Math.round(img.naturalWidth * k));
                            c.height = Math.max(1, Math.round(img.naturalHeight * k));
                            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                            let url = c.toDataURL('image/webp', 0.9);
                            if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/png');
                            finish(url);
                        } catch (e) { reject(new Error('Не удалось сжать картинку.')); }
                        URL.revokeObjectURL(objUrl);
                    };
                    img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('Не удалось открыть картинку.')); };
                    img.src = objUrl;
                };
                if (isGif && file.size > 3600000) { reject(tooBig()); return; }
                if (!isGif && file.size > 1500000) { shrink(); return; }
                const reader = new FileReader();
                reader.onload = () => {
                    const url = String(reader.result);
                    if (IMG_RE.test(url)) finish(url);
                    else if (isGif) reject(new Error('Не удалось прочитать GIF.'));
                    else shrink();
                };
                reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
                reader.readAsDataURL(file);
            });
        }

        // --------- хранение больших данных (шрифты, пользовательские темы): отдельные ключи, тот же механизм GM_* ----------
        // --------- storing large data (fonts, user themes): separate keys, the same GM_* mechanism ----------
        function readKey(key) {
            try {
                const raw = typeof GM_getValue === 'function' ? GM_getValue(key, null) : localStorage.getItem(key);
                if (!raw) return null;
                return typeof raw === 'string' ? JSON.parse(raw) : raw;
            } catch (e) { return null; }
        }
        function writeKey(key, val) {
            try {
                const raw = JSON.stringify(val);
                if (typeof GM_setValue === 'function') GM_setValue(key, raw); else localStorage.setItem(key, raw);
                return true;
            } catch (e) { return false; }
        }

        // --------- FontManager: пользовательские шрифты ----------
        // --------- FontManager: custom fonts ----------
        // Файл шрифта НЕ отправляется на сервер: он читается локально и регистрируется через FontFace из ArrayBuffer
        // The font file is NOT sent to the server: it is read locally and registered via FontFace from an ArrayBuffer
        // (так политика CSP страницы не мешает). Сам файл сохраняется в base64 в хранилище userscript-менеджера
        // (that way the page's CSP policy does not interfere). The file itself is stored in base64 in the userscript manager's storage
        // (GM_setValue) - это локальное хранилище профиля браузера. Если GM_setValue недоступен, а localStorage
        // (GM_setValue) - that is the browser profile's local storage. If GM_setValue is unavailable and localStorage
        // переполнен, шрифт работает до перезагрузки страницы (fontLib.persisted = false), и пользователь об этом предупреждается.
        // is full, the font works until the page is reloaded (fontLib.persisted = false), and the user is warned about it.
        const FONT_KEY = 'gpUiAppearance.fonts.v1';
        const FONT_MAX_FILE = 2 * 1024 * 1024;
        const FONT_MAX_TOTAL = 8 * 1024 * 1024;
        const FONT_MAX_COUNT = 12;
        const fontLib = { items: [], faces: new Map(), persisted: true };
        const fontStack = it => "'" + it.family + "', sans-serif";
        const cleanFontName = n => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40) || 'Шрифт';

        function bytesToB64(bytes) {
            let bin = '';
            for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            return btoa(bin);
        }
        function b64ToBytes(b64) {
            const bin = atob(b64);
            const out = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
            return out;
        }

        async function registerFont(it) {
            if (fontLib.faces.has(it.id)) return true;
            if (typeof FontFace !== 'function' || !document.fonts) return false;
            // защита от повторной регистрации (повторный запуск скрипта в той же вкладке)
            // protection against double registration (a repeated script run in the same tab)
            let existing = null;
            document.fonts.forEach(f => { if (String(f.family).replace(/["']/g, '') === it.family) existing = f; });
            if (existing) { fontLib.faces.set(it.id, existing); return true; }
            // сначала регистрируем (проверка и add в одном синхронном шаге - два экземпляра скрипта не создадут дубль), потом грузим
            // first we register (the check and add happen in one synchronous step - two script copies will not create a duplicate), then we load
            const face = new FontFace(it.family, b64ToBytes(it.data).buffer, { display: 'swap' });
            document.fonts.add(face);
            fontLib.faces.set(it.id, face);
            try { await face.load(); } catch (e) { document.fonts.delete(face); fontLib.faces.delete(it.id); throw e; }
            return true;
        }

        function persistFonts() {
            fontLib.persisted = writeKey(FONT_KEY, fontLib.items.map(f => ({ id: f.id, name: f.name, data: f.data, size: f.size })));
            return fontLib.persisted;
        }

        function loadFonts() {
            fontLib.items = [];
            const arr = readKey(FONT_KEY);
            if (!Array.isArray(arr)) return;
            for (const it of arr.slice(0, FONT_MAX_COUNT)) {
                if (!it || typeof it !== 'object') continue;
                if (typeof it.id !== 'string' || !/^[a-z0-9]{4,24}$/.test(it.id)) continue;
                if (typeof it.data !== 'string' || it.data.length > FONT_MAX_FILE * 1.4 || !/^[A-Za-z0-9+/=]+$/.test(it.data)) continue;
                fontLib.items.push({ id: it.id, name: cleanFontName(it.name), family: 'GPEFont-' + it.id, data: it.data, size: Number(it.size) || 0 });
            }
            fontLib.items.forEach(it => { registerFont(it).catch(() => {}); });
        }

        async function addFontFile(file) {
            if (!file || !/\.(ttf|otf|woff2?)$/i.test(file.name || '')) throw new Error('Поддерживаются файлы .ttf, .otf, .woff и .woff2.');
            if (typeof FontFace !== 'function') throw new Error('Этот браузер не поддерживает загрузку шрифтов (FontFace).');
            if (file.size > FONT_MAX_FILE) throw new Error('Файл шрифта больше 2 МБ.');
            if (fontLib.items.length >= FONT_MAX_COUNT) throw new Error('Можно загрузить не больше ' + FONT_MAX_COUNT + ' шрифтов: удалите ненужные.');
            if (fontLib.items.reduce((a, f) => a + f.size, 0) + file.size > FONT_MAX_TOTAL) throw new Error('Общий размер загруженных шрифтов превысит 8 МБ: удалите ненужные.');
            const buf = await file.arrayBuffer();
            const id = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
            const family = 'GPEFont-' + id;
            const face = new FontFace(family, buf.slice(0), { display: 'swap' });
            try { await face.load(); } catch (e) { throw new Error('Не удалось прочитать шрифт: файл повреждён или не является шрифтом.'); }
            document.fonts.add(face);
            const it = { id, name: cleanFontName((file.name || '').replace(/\.[^.]+$/, '')), family, data: bytesToB64(new Uint8Array(buf)), size: file.size };
            fontLib.items.push(it);
            fontLib.faces.set(id, face);
            persistFonts();
            return it;
        }

        function removeFont(id) {
            const i = fontLib.items.findIndex(f => f.id === id);
            if (i < 0) return false;
            const it = fontLib.items[i];
            const face = fontLib.faces.get(id);
            if (face && document.fonts) document.fonts.delete(face);
            fontLib.faces.delete(id);
            fontLib.items.splice(i, 1);
            persistFonts();
            // настройки, которые ссылались на удалённый шрифт, возвращаем к значениям по умолчанию
            // settings that referenced the removed font are returned to default values
            if (settings.text.font.includes(it.family)) settings.text.font = DEFAULTS.text.font;
            if (settings.buttons.fontFamily.includes(it.family)) settings.buttons.fontFamily = '';
            apply();
            return true;
        }

        // --------- ThemeManager: сетапы ----------
        // --------- ThemeManager: setups ----------
        // Сетап - это «манифест»: вид интерфейса + ИМЕНА использованных картинок + их размеры и положения. Самих картинок
        // A setup is a "manifest": the look + the NAMES of the images used + their sizes and positions. The images themselves
        // в нём нет. При загрузке картинки берутся из папки, которую выбрал пользователь, по совпадению имён файлов
        // are not in it. When loading, images are taken from the folder the user selected, matched by file names
        // (или из уже загруженных в этом браузере). Так сетап лёгкий и его удобно передавать вместе с папкой картинок.
        // (or from those already loaded in this browser). That keeps the setup light and easy to share together with the image folder.
        const THEME_KEY = 'gpUiAppearance.themes.v1';
        const THEME_MAX = 30;
        const THEME_GROUPS = ['interface', 'panels', 'buttons', 'text'];
        const THEME_SKIP = { panels: ['targets'], buttons: ['target', 'customSelector'] };
        // Что именно перезаписывает встроенная тема (остальные настройки группы остаются как у пользователя)
        // What exactly the built-in theme rewrites (the other settings of the group stay as the user set them)
        const THEME_GOVERNED = {
            panels: ['background', 'opacity', 'border', 'borderColor', 'borderWidth'],
            buttons: ['background', 'hover', 'active', 'text', 'radius', 'borderColor', 'borderWidth', 'shadow', 'opacity'],
            text: ['color']
        };
        let userThemes = [];
        // Папка с картинками: браузер не даёт странице открыть путь вручную, поэтому папку выбирают в системном окне.
        // Image folder: the browser does not let the page open a path manually, so the folder is chosen in a system dialog.
        // Содержимое хранится только в памяти вкладки (после перезагрузки папку нужно выбрать снова).
        // The contents are kept only in the tab's memory (after a reload the folder must be chosen again).
        const folder = { name: '', files: new Map() };
        const newThemeId = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

        function themeSnapshot(src) {
            const out = { touched: {} };
            for (const g of THEME_GROUPS) {
                out.touched[g] = !!src.touched[g];
                out[g] = {};
                for (const k of Object.keys(DEFAULTS[g])) {
                    if ((THEME_SKIP[g] || []).includes(k)) continue;
                    out[g][k] = clone(src[g][k]);
                }
            }
            return out;
        }
        function cleanLayouts(list) {
            const out = [];
            if (!Array.isArray(list)) return out;
            for (const l of list.slice(0, SKIN_MAX_COUNT + 5)) {
                if (!l || typeof l !== 'object' || !validElKey(l.key)) continue;
                out.push(Object.assign({ key: l.key }, sanitizeElState(l)));
            }
            return out;
        }
        function cleanCustoms(list) {
            const out = [];
            if (!Array.isArray(list)) return out;
            for (const c of list.slice(0, SKIN_MAX_COUNT)) {
                if (!c || typeof c !== 'object' || typeof c.key !== 'string' || !/^custom_[a-z0-9]{1,30}$/.test(c.key)) continue;
                const selector = cleanSelector(c.selector);
                if (selector) out.push({ key: c.key, name: cleanThemeName(c.name) || c.key, selector });
            }
            return out;
        }
        function normalizeSetup(it) {
            if (!it || typeof it !== 'object') return null;
            const name = cleanThemeName(it.name);
            if (!name || !it.data || typeof it.data !== 'object') return null;
            const tmp = sanitize({ settings: { overlay: it.frame, background: it.bg, skins: it.skins } });
            const layouts = cleanLayouts(it.layouts);
            if (!layouts.length && it.layout && typeof it.layout === 'object') layouts.push(Object.assign({ key: OVERLAY_KEY }, sanitizeElState(it.layout)));
            return {
                id: typeof it.id === 'string' && /^[a-z0-9]{3,24}$/.test(it.id) ? it.id : newThemeId(),
                name,
                data: themeSnapshot(sanitize(it.data)),
                frame: tmp.overlay, bg: tmp.background, skins: tmp.skins,
                customs: cleanCustoms(it.customs),
                layouts
            };
        }
        function loadThemes() {
            userThemes = [];
            const arr = readKey(THEME_KEY);
            if (!Array.isArray(arr)) return;
            for (const raw of arr.slice(0, THEME_MAX)) {
                const it = normalizeSetup(raw);
                if (it && !userThemes.some(t => t.id === it.id)) userThemes.push(it);
            }
        }
        const persistThemes = () => writeKey(THEME_KEY, userThemes);
        const findUserTheme = name => userThemes.find(t => t.name.toLowerCase() === cleanThemeName(name).toLowerCase()) || null;

        // Собирает сетап из текущего состояния: вид, имена картинок, размеры замен, положение рамки и замен
        // Collects a setup from the current state: the look, image names, replacement sizes, frame and replacement positions
        function makeSetup(name, id) {
            const skins = settings.skins.filter(sk => ELEMENTS[sk.key] && slotImage('skin:' + sk.key));
            const keys = [OVERLAY_KEY].concat(skins.map(sk => sk.key));
            const layouts = [];
            for (const k of keys) {
                if (layouts.some(l => l.key === k)) continue;
                layouts.push(Object.assign({ key: k }, sanitizeElState(getEl(k))));
            }
            const customs = skins.filter(sk => ELEMENTS[sk.key].custom)
                .map(sk => ({ key: sk.key, name: ELEMENTS[sk.key].name, selector: ELEMENTS[sk.key].selector }));
            return {
                id, name,
                data: themeSnapshot(settings),
                frame: clone(settings.overlay), bg: clone(settings.background),
                skins: clone(skins), customs, layouts
            };
        }
        function saveUserTheme(name) {
            const clean = cleanThemeName(name);
            if (!clean) return null;
            const old = findUserTheme(clean);
            if (!old && userThemes.length >= THEME_MAX) return null;
            const next = makeSetup(clean, old ? old.id : newThemeId());
            if (old) userThemes[userThemes.indexOf(old)] = next; else userThemes.push(next);
            persistThemes();
            settings.theme = 'user:' + next.id;
            apply();
            return next;
        }
        function deleteUserTheme(id) {
            const i = userThemes.findIndex(t => t.id === id);
            if (i < 0) return false;
            userThemes.splice(i, 1);
            persistThemes();
            if (settings.theme === 'user:' + id) settings.theme = 'custom';
            apply();
            return true;
        }

        // Элемент интерфейса, добавленный в сетапе: тот же селектор уже есть - берём его ключ, иначе создаём как при клике в режиме редактирования
        // A UI element added in the setup: the same selector already exists - we take its key, otherwise we create it as on a click in editing mode
        function ensureCustom(c) {
            for (const k of Object.keys(ELEMENTS)) if (ELEMENTS[k].selector === c.selector) return k;
            let key = c.key;
            if (ELEMENTS[key]) key = 'custom_' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
            ELEMENTS[key] = { name: c.name, selector: c.selector, custom: true };
            state.custom[key] = { name: c.name, selector: c.selector };
            try { rebuildSelect(); } catch (e) { /* панель ещё не построена */ }
            scheduleSave();
            return key;
        }

        // Папка с картинками (список файлов из <input webkitdirectory>); возвращает число найденных картинок
        // Image folder (the list of files from <input webkitdirectory>); returns the number of images found
        function setFolder(fileList) {
            folder.files = new Map();
            folder.name = '';
            for (const f of Array.from(fileList || [])) {
                if (!/\.(png|gif|jpe?g|webp)$/i.test(f.name || '') && !/^image\//i.test(f.type || '')) continue;
                const low = f.name.toLowerCase();
                if (!folder.files.has(low)) folder.files.set(low, f);
                if (!folder.name && f.webkitRelativePath) folder.name = String(f.webkitRelativePath).split('/')[0];
            }
            return folder.files.size;
        }
        // Слоты, у которых есть имя файла, но нет картинки (например, после импорта), заполняем из папки по имени
        // Slots that have a file name but no image (for example, after an import) are filled from the folder by name
        async function fillMissingFromFolder() {
            const slots = [['overlay', settings.overlay.imageName], ['background', settings.background.imageName]]
                .concat(settings.skins.map(sk => ['skin:' + sk.key, sk.imageName]));
            let n = 0;
            for (const [slot, name] of slots) {
                if (!name || slotImage(slot)) continue;
                const f = folder.files.get(name.toLowerCase());
                if (!f) continue;
                try { setSlotImage(slot, await readImageFile(f, 2048)); n++; } catch (e) { /* пропускаем */ }
            }
            if (n) apply();
            return n;
        }

        // Загрузить сетап: применяет вид, размеры и положения, а картинки подставляет по именам из папки
        // Load a setup: applies the look, sizes and positions, and inserts images by name from the folder
        async function loadSetup(id) {
            const it = userThemes.find(t => t.id === id);
            if (!it) return null;
            // 1. уже загруженные картинки по именам - собираем ДО любых изменений
            // 1. images already loaded, by name - collected BEFORE any changes
            const cache = new Map();
            const remember = (name, slot) => { const img = slotImage(slot); if (name && img) cache.set(name.toLowerCase(), img); };
            remember(settings.overlay.imageName, 'overlay');
            remember(settings.background.imageName, 'background');
            for (const sk of settings.skins) remember(sk.imageName, 'skin:' + sk.key);
            // 2. элементы интерфейса: свои (custom_*) создаём, ключи сопоставляем
            // 2. UI elements: custom ones (custom_*) are created, keys are matched
            const keyMap = new Map();
            for (const c of it.customs) keyMap.set(c.key, ensureCustom(c));
            const mapKey = k => keyMap.has(k) ? keyMap.get(k) : (ELEMENTS[k] ? k : null);
            const skinsIn = it.skins.map(sk => { const k = mapKey(sk.key); return k ? Object.assign({}, sk, { key: k }) : null; })
                .filter(Boolean).slice(0, SKIN_MAX_COUNT);
            // 3. какие картинки нужны и где их взять
            // 3. which images are needed and where to take them from
            const nameOf = new Map();
            [it.frame.imageName, it.bg.imageName].concat(skinsIn.map(sk => sk.imageName)).forEach(n => { if (n) nameOf.set(n.toLowerCase(), n); });
            const found = new Map();
            const missing = [];
            let fromFolder = 0;
            for (const [low, disp] of nameOf) {
                const f = folder.files.get(low);
                if (f) {
                    try { found.set(low, await readImageFile(f, 2048)); fromFolder++; } catch (e) { missing.push(disp + ' (' + (e && e.message ? e.message : 'ошибка') + ')'); }
                } else if (cache.has(low)) found.set(low, cache.get(low));
                else missing.push(disp);
            }
            // 4. применяем: вид
            // 4. apply: the look
            const d = sanitize(it.data);
            const snap = themeSnapshot(d);
            for (const g of THEME_GROUPS) {
                for (const k of Object.keys(snap[g])) settings[g][k] = d[g][k];
                settings.touched[g] = !!d.touched[g];
            }
            // картинки: старые слоты очищаем, новые ставим по именам
            // images: old slots are cleared, new ones are set by name
            imgStore.delete('overlay');
            imgStore.delete('background');
            for (const sk of settings.skins) imgStore.delete('skin:' + sk.key);
            settings.overlay = Object.assign(clone(DEFAULTS.overlay), it.frame);
            settings.background = Object.assign(clone(DEFAULTS.background), it.bg);
            settings.skins = skinsIn;
            const total = () => { let t = 0; imgStore.forEach(v => { t += v.length; }); return t; };
            const put = (slot, name) => {
                const img = name ? found.get(name.toLowerCase()) : '';
                if (!img) return;
                if (total() + img.length > IMG_TOTAL_MAX) { missing.push(name + ' (нет места в хранилище)'); return; }
                imgStore.set(slot, img);
            };
            put('overlay', settings.overlay.imageName);
            put('background', settings.background.imageName);
            for (const sk of settings.skins) put('skin:' + sk.key, sk.imageName);
            persistImages();
            // 5. размеры и положения элементов (рамка, замены)
            // 5. element sizes and positions (frame, replacements)
            for (const L of it.layouts) {
                const k = mapKey(L.key);
                if (k) state.elements[k] = sanitizeElState(L);
            }
            applyLayout();
            scheduleSave();
            try { refreshPanel(); } catch (e) { /* панель ещё не построена */ }
            settings.theme = 'user:' + id;
            apply();
            return { loaded: found.size, fromFolder, missing };
        }

        function exportSetupFile(id) {
            const it = userThemes.find(t => t.id === id);
            if (!it) return null;
            const out = Object.assign({}, it);
            delete out.id;
            const images = [it.frame.imageName, it.bg.imageName].concat(it.skins.map(sk => sk.imageName)).filter(Boolean);
            return JSON.stringify({ app: 'gartic-phone-ui-setup', version: 2, setup: out, images: Array.from(new Set(images)) }, null, 2);
        }
        function importSetupFile(text) {
            let parsed;
            try { parsed = JSON.parse(text); } catch (e) { return null; }
            if (!parsed || typeof parsed !== 'object') return null;
            let list = [];
            if (parsed.setup && typeof parsed.setup === 'object') list = [parsed.setup];
            else if (Array.isArray(parsed.themes)) list = parsed.themes; // файлы прежней версии | files of the previous version
            else return null;
            let added = 0, lastId = '';
            for (const raw of list.slice(0, THEME_MAX)) {
                if (userThemes.length >= THEME_MAX) break;
                const it = normalizeSetup(Object.assign({}, raw, { id: '' }));
                if (!it) continue;
                let nm = it.name, n = 2;
                while (findUserTheme(nm) && n < 60) nm = cleanThemeName(it.name.slice(0, 34) + ' (' + (n++) + ')');
                if (findUserTheme(nm)) continue;
                it.name = nm;
                while (userThemes.some(t => t.id === it.id)) it.id = newThemeId();
                userThemes.push(it);
                added++;
                lastId = it.id;
            }
            if (!added) return null;
            persistThemes();
            return { added, id: lastId };
        }

        // «Default»: убрать оформление и вернуть вид игры (картинки, фон, свой CSS и шрифты не трогаем)
        // "Default": remove the styling and return the game's look (images, background, custom CSS and fonts are untouched)
        function resetLook() {
            for (const g of THEME_GROUPS) { settings[g] = clone(DEFAULTS[g]); settings.touched[g] = false; }
            settings.theme = 'default';
            apply();
        }
        function applyThemeBase(t) {
            for (const g of Object.keys(THEME_GOVERNED)) {
                for (const k of THEME_GOVERNED[g]) settings[g][k] = clone(DEFAULTS[g][k]);
                const src = t[g];
                if (src) for (const k of Object.keys(src)) if (has(DEFAULTS[g], k)) settings[g][k] = coerce(g + '.' + k, src[k], DEFAULTS[g][k]);
                settings.touched[g] = true;
            }
            if (t.interface) {
                for (const k of Object.keys(t.interface)) if (has(DEFAULTS.interface, k)) settings.interface[k] = coerce('interface.' + k, t.interface[k], DEFAULTS.interface[k]);
                settings.touched.interface = true;
            }
            settings.interface.blur = !!t.blur;
            if (t.blur || settings.touched.interface) settings.touched.interface = true;
        }
        // Положение/размер рамки хранится в Layout Editor (state.elements): им управляют и «Раскладка», и режим редактирования
        // The frame's position/size is stored in the Layout Editor (state.elements): both "Layout" and the editing mode control it
        function setOverlayLayout(l) {
            state.elements[OVERLAY_KEY] = sanitizeElState(l);
            applyLayout();
            scheduleSave();
            try { refreshPanel(); } catch (e) { /* панель ещё не построена */ }
        }

        // --------- замены элементов интерфейса, рамка, фон: установка картинок ----------
        // --------- UI element replacements, frame, background: setting images ----------
        function ensureSkin(key) {
            let sk = settings.skins.find(x => x.key === key);
            if (!sk) {
                if (settings.skins.length >= SKIN_MAX_COUNT) throw new Error('Достигнут лимит замен (' + SKIN_MAX_COUNT + ').');
                sk = cleanSkin({ key });
                if (!sk || !has(ELEMENTS, key) || key === OVERLAY_KEY) throw new Error('Для этого элемента замена недоступна.');
                settings.skins.push(sk);
            }
            return sk;
        }
        // slot: 'overlay' | 'background' | 'skin:<ключ элемента>'. Бросает ошибку, если картинку сохранить нельзя.
        // slot: 'overlay' | 'background' | 'skin:<element key>'. Throws an error if the image cannot be saved.
        function putImage(slot, dataUrl, name) {
            let created = null;
            if (slot.startsWith('skin:')) {
                const key = slot.slice(5);
                const had = settings.skins.some(x => x.key === key);
                const sk = ensureSkin(key);
                if (!had) created = sk;
            }
            try { setSlotImage(slot, dataUrl); } catch (e) {
                if (created) settings.skins.splice(settings.skins.indexOf(created), 1);
                throw e;
            }
            const nm = cleanImageName(name);
            if (slot === 'overlay') settings.overlay.imageName = nm;
            else if (slot === 'background') settings.background.imageName = nm;
            else ensureSkin(slot.slice(5)).imageName = nm;
            apply();
        }
        function dropImage(slot) {
            if (slot.startsWith('skin:')) { removeSkin(slot.slice(5)); return; }
            setSlotImage(slot, '');
            if (slot === 'overlay') settings.overlay.imageName = '';
            if (slot === 'background') settings.background.imageName = '';
            apply();
        }
        function removeSkin(key) {
            settings.skins = settings.skins.filter(sk => sk.key !== key);
            setSlotImage('skin:' + key, '');
            apply();
        }
        function setSkinProp(key, patch) {
            const sk = ensureSkin(key);
            Object.assign(sk, cleanSkin(Object.assign({}, sk, patch)));
            apply();
        }

        // --------- API ----------
        function walk(path) {
            const parts = String(path).split('.');
            let tpl = DEFAULTS, cur = settings;
            for (let i = 0; i < parts.length - 1; i++) {
                if (!has(tpl, parts[i]) || typeof tpl[parts[i]] !== 'object') return null;
                tpl = tpl[parts[i]];
                cur = cur[parts[i]];
            }
            const key = parts[parts.length - 1];
            if (!has(tpl, key) || typeof tpl[key] === 'object') return null;
            return { cur, tpl, key, group: parts[0] };
        }
        function get(path) {
            const w = walk(path);
            return w ? w.cur[w.key] : undefined;
        }
        function set(path, value) {
            const w = walk(path);
            if (!w) return false;
            w.cur[w.key] = coerce(path, value, w.tpl[w.key]);
            if (GROUPS.includes(w.group)) settings.touched[w.group] = true;
            if (/^(panels\.(background|opacity|borderColor)|buttons\.(background|hover|active|text|borderColor)|text\.color)$/.test(path)) {
                settings.theme = 'custom';
            }
            apply();
            return true;
        }
        function setTarget(name, on) {
            if (!has(settings.panels.targets, name)) return false;
            settings.panels.targets[name] = !!on;
            settings.touched.panels = true;
            apply();
            return true;
        }
        function setTheme(name) {
            if (name === 'custom') { settings.theme = 'custom'; apply(); return true; }
            if (name === 'default') { resetLook(); return true; }
            const t = THEMES[name];
            if (!t) return false;
            applyThemeBase(t);
            settings.theme = name;
            apply();
            return true;
        }
        function setEnabled(on) { settings.enabled = !!on; apply(); }
        function reset() {
            settings = clone(DEFAULTS);
            imgStore.clear();
            persistImages();
            setOverlayLayout(DEFAULT_STATE);
            apply();
        }

        function toggleEditorTransparent() {
            set('editor.transparent', !get('editor.transparent'));
            syncAll();
        }
        function onChange(fn) { listeners.push(fn); }

        // Аварийный сброс, если свой CSS спрятал редактор: Ctrl+Alt+Shift+0
        // Emergency reset if your own CSS hid the editor: Ctrl+Alt+Shift+0
        function rescue() {
            settings.custom.enabled = false;
            settings.editor.transparent = false;
            apply();
            syncAll();
        }

        // Отчёт для отладки: что нашлось на странице и что доступно. Только чтение, ваших картинок и настроек в нём нет.
        // A report for debugging: what was found on the page and what is available. Read-only; your images and settings are not in it.
        function diagnostics() {
            const L = [];
            const yn = v => (v ? 'да' : 'нет');
            L.push('Gartic Phone UI Layout Editor ' + (typeof GM_info !== 'undefined' && GM_info.script ? GM_info.script.version : '2.19.0'));
            L.push('Браузер: ' + (navigator.userAgent || '?').slice(0, 110));
            L.push('GM: getValue=' + typeof GM_getValue + ', setValue=' + typeof GM_setValue + ', xhr=' + typeof GM_xmlhttpRequest + ', unsafeWindow=' + typeof unsafeWindow);
            let imgChars = 0;
            imgStore.forEach(v => { imgChars += v.length; });
            let fontBytes = 0;
            fontLib.items.forEach(f => { fontBytes += f.size; });
            L.push('Хранилище: настройки ' + JSON.stringify(settings).length + ' симв., картинок ' + imgStore.size + ' (' + imgChars + ' симв.), шрифтов ' + fontLib.items.length + ' (' + fontBytes + ' Б), сетапов ' + userThemes.length);
            L.push('Поддержка: FontFace=' + yn(typeof FontFace === 'function') + ', PointerEvent=' + yn(typeof PointerEvent === 'function') +
                ', ResizeObserver=' + yn(typeof ResizeObserver === 'function') + ', EyeDropper=' + yn(typeof window.EyeDropper === 'function') + ', touch точек=' + (navigator.maxTouchPoints || 0));
            L.push('');
            L.push('Элементы раскладки (селектор -> найдено / видимых / размер первого):');
            for (const k of Object.keys(ELEMENTS)) {
                const sel = ELEMENTS[k].selector;
                let list = [];
                try { list = Array.from(document.querySelectorAll(sel)); } catch (e) { L.push('  ' + k + ': неверный селектор ' + sel); continue; }
                const vis = list.filter(n => { const r = n.getBoundingClientRect(); return r.width > 1 && r.height > 1; });
                const r0 = vis[0] ? vis[0].getBoundingClientRect() : null;
                L.push('  ' + k + '  ' + sel + ' -> ' + list.length + ' / ' + vis.length + (r0 ? ' / ' + Math.round(r0.width) + '×' + Math.round(r0.height) : ''));
            }
            L.push('');
            const dc = document.querySelector(CANVAS_FRAME_SEL);
            if (dc) {
                const r = dc.getBoundingClientRect();
                L.push('Canvas рисования (' + CANVAS_FRAME_SEL + '): ' + dc.width + '×' + dc.height + ' px, на экране ' + Math.round(r.width) + '×' + Math.round(r.height) + (dc.width ? ' (масштаб ' + (Math.round(r.width / dc.width * 100) / 100) + ')' : ''));
            } else {
                L.push('Canvas рисования (' + CANVAS_FRAME_SEL + '): не найден (откройте экран рисования)');
            }
            const cc = getCursorCanvas();
            let readable = 'нет canvas';
            if (cc) { try { readable = yn(!!cc.getContext('2d')); } catch (e) { readable = 'ошибка'; } }
            L.push('Курсорный canvas: ' + (cc ? cc.width + '×' + cc.height + ', чтение 2D: ' + readable : 'не найден'));
            L.push('Исправление координат (только чтение): ' + (typeof coordFixOn === 'boolean' ? 'включено=' + yn(coordFixOn) : 'недоступно'));
            let b = null;
            try { b = BrushSettings.getDiag(); } catch (e) { /* модуль кисти недоступен */ }
            if (b) {
                L.push('Кисть: курсор=' + b.mode + ', толщина=' + b.thickness + '%, нажим=' + b.pressure + '%, перехват рисования=' + yn(b.hookOn) +
                    ', вызовов на холсте=' + b.seen + ', изменено=' + b.scaled + (b.err ? ', ошибка: ' + b.err : '') + ', последний указатель=' + b.pType);
                // сегментный нажим (включается сам, когда путь пригоден и толщина различается)
                // segment pressure (turns on by itself when the path is suitable and the thickness varies)
                L.push('Нажим по сегментам: штрихов=' + b.segStrokes + ', откатов к единому множителю=' + b.segFallback +
                    ', попаданий кэша профиля=' + b.cacheHit + ', из них по форме=' + b.normHit + ', воспроизведено вне холста (альбом/книга)=' + b.replayStrokes +
                    ' (в кэше ' + b.cacheSize + '), последний: canvas=' + b.lastKind +
                    ', lineWidth=' + b.lastLineWidth + ', множитель базы=' + b.lastBaseFactor + ', нажим=' + Math.round(b.lastPressure * 100) +
                    '%, толщина сегментов ' + (b.minSegW ? b.minSegW.toFixed(1) + '..' + b.maxSegW.toFixed(1) : '—'));
            }
            L.push('Вид: включён=' + yn(settings.enabled) + ', тема=' + settings.theme + ', рамка=' + yn(!!slotImage('overlay')) + ', фон=' + settings.background.mode + ', замен элементов=' + settings.skins.length);
            // состояние новых модулей и итоги исследования игры (только чтение)
            // the state of the new modules and the findings of the game research (read-only)
            try {
                const p = PressureSettings.getDiag();
                L.push('Нажим: чувствительность=' + p.sens + '%, кривая=' + p.curve + ', ширина ' + p.min + '..' + p.max + '%, сглаживание=' + p.smooth + '%, прозрачность=' + p.alpha + '%, касание=' + yn(p.touch) + ', слушает=' + yn(p.listening) + ', последний ввод=' + p.type + ' ' + Math.round(p.val * 100) + '%');
            } catch (e) { /* модуль недоступен */ }
            try {
                const bk = PressureBake.getDiag();
                L.push('Запекание нажима: включено=' + yn(bk.on) + ', снимок=' + yn(bk.snap) + ', съёмов=' + bk.captures + ', возвратов=' + bk.restores);
            } catch (e) { /* модуль недоступен */ }
            try {
                const pub = PressurePublish.getDiag();
                L.push('Нажим в сети: перехват=' + (pub.installed ? 'да' : 'НЕТ' + (pub.installErr ? ' (' + pub.installErr + ')' : '')) +
                    ', включено=' + yn(pub.on) + ', сообщений=' + pub.msgs + ', штрихов=' + pub.stroke +
                    ', заменено=' + pub.replaced + ' (сообщений отправлено ' + pub.sent + ', равномерных ' + pub.uniform + ')' +
                    ', кусков=' + pub.chunk + ', точек=' + pub.dot + ', держим=' + (pub.held || 0) + ', без профиля=' + pub.nomatch + ', чужой формат=' + pub.shape +
                    ' | d1=' + pub.d1 + ' d2=' + pub.d2 + ' d3=' + pub.d3);
            } catch (e) { /* модуль недоступен */ }
            try {
                const c = CanvasPan.getDiag();
                L.push('Перемещение холста: включено=' + yn(c.enabled) + ', кнопка=' + c.button + ', цель=' + c.target + ', сдвиг=' + c.x + ',' + c.y + ', увеличение=' + (c.zoom ? c.zoom.toFixed(2) : 'нет холста'));
            } catch (e) { /* модуль недоступен */ }
            try { L.push(''); GameProbe.report().forEach(x => L.push(x)); } catch (e) { L.push('Исследование игры недоступно: ' + (e && e.message ? e.message : e)); }
            return L.join('\n');
        }

        function init() {
            load();
            loadThemes();
            loadFonts();
            if (settings.theme.startsWith('user:') && !userThemes.some(t => 'user:' + t.id === settings.theme)) settings.theme = 'custom';
            apply();
            // защита от дублей при повторном запуске скрипта: обработчик клавиш вешаем один раз на страницу
            // protection against duplicates on a repeated script run: the key handler is attached once per page
            const root = document.documentElement;
            if (root.getAttribute('data-gpe-appearance') === '1') return;
            root.setAttribute('data-gpe-appearance', '1');
            window.addEventListener('keydown', e => {
                if (e.ctrlKey && e.altKey && e.shiftKey && e.code === 'Digit0') { e.preventDefault(); rescue(); }
            }, true);
        }

        // --------- выбор элемента на странице и CSS-селектор для него ----------
        // --------- element selection on the page and a CSS selector for it ----------
        function cssPath(el) {
            const esc = t => (window.CSS && CSS.escape) ? CSS.escape(t) : String(t).replace(/[^\w-]/g, '\\$&');
            const parts = [];
            let cur = el;
            while (cur && cur.nodeType === 1 && cur !== document.documentElement && parts.length < 6) {
                if (cur.id && !/\d{4,}/.test(cur.id)) { parts.unshift('#' + esc(cur.id)); break; }
                let part = cur.tagName.toLowerCase();
                const cls = Array.from(cur.classList).filter(c => !/\d{3,}/.test(c)).slice(0, 2);
                if (cls.length) part += cls.map(c => '.' + esc(c)).join('');
                const sib = cur.parentElement ? Array.from(cur.parentElement.children).filter(n => n.tagName === cur.tagName) : [];
                if (sib.length > 1 && !cls.length) part += ':nth-of-type(' + (sib.indexOf(cur) + 1) + ')';
                parts.unshift(part);
                const sel = parts.join(' > ');
                try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (e) { /* ignore */ }
                cur = cur.parentElement;
            }
            return parts.join(' > ');
        }

        function pickElement(done) {
            const ov = h('div', { id: 'gpue-pickov', style: 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;cursor:crosshair' });
            const box = h('div', { style: 'position:fixed;pointer-events:none;border:2px solid #4aa8ff;background:rgba(74,168,255,.18);box-sizing:border-box;display:none' });
            const tip = h('div', { style: 'position:fixed;pointer-events:none;padding:3px 8px;font:12px monospace;color:#fff;background:#111;border:1px solid #4aa8ff;border-radius:6px;max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:none' });
            ov.appendChild(box);
            ov.appendChild(tip);
            document.body.appendChild(ov);
            let raf = 0, last = null;
            const onKey = e => {
                if (e.key !== 'Escape') return;
                e.stopImmediatePropagation();
                finish(null);
            };
            const finish = sel => {
                cancelAnimationFrame(raf);
                ov.remove();
                window.removeEventListener('keydown', onKey, true);
                if (sel) done(sel);
            };
            const under = (x, y) => {
                ov.style.pointerEvents = 'none';
                const el = document.elementFromPoint(x, y);
                ov.style.pointerEvents = 'auto';
                return el && el !== document.documentElement ? el : null;
            };
            window.addEventListener('keydown', onKey, true);
            ov.addEventListener('pointermove', e => {
                const x = e.clientX, y = e.clientY;
                cancelAnimationFrame(raf);
                raf = requestAnimationFrame(() => {
                    const el = under(x, y);
                    last = el;
                    if (!el) { box.style.display = tip.style.display = 'none'; return; }
                    const r = el.getBoundingClientRect();
                    box.style.cssText += ';display:block;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px';
                    tip.textContent = cssPath(el);
                    tip.style.display = 'block';
                    tip.style.left = Math.min(x + 14, window.innerWidth - 40) + 'px';
                    tip.style.top = Math.min(y + 14, window.innerHeight - 30) + 'px';
                });
            });
            ov.addEventListener('click', e => {
                e.preventDefault();
                const el = under(e.clientX, e.clientY) || last;
                finish(el ? cssPath(el) : null);
            });
        }

        function downloadFile(name, text, mime) {
            const url = URL.createObjectURL(new Blob([text], { type: mime }));
            const a = h('a', { href: url, download: name, style: 'display:none' });
            (document.getElementById('gpue-panel') || document.body).appendChild(a); // внутри панели - режим редактирования не перехватит click | inside the panel - the editing mode will not capture the click
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        }

        // --------- UI ----------
        function buildPage() {
            const syncs = [];

            const range = (path, label, unit, zeroLabel, also) => {
                const [min, max] = RANGES[path];
                const input = h('input', { type: 'range', min: String(min), max: String(max), step: '1' });
                const val = h('span', { class: 'gpa-val' });
                const show = v => { val.textContent = zeroLabel && Number(v) === 0 ? zeroLabel : v + unit; };
                const sync = () => { input.value = String(get(path)); show(get(path)); };
                input.addEventListener('input', () => {
                    set(path, Number(input.value));
                    if (also) also.forEach(p => set(p, Number(input.value)));
                    show(input.value);
                    syncTheme();
                });
                syncs.push(sync);
                return h('div', { class: 'gpa-row' }, [h('span', { text: label }), input, val]);
            };
            const color = (path, label) => {
                const input = h('input', { type: 'color' });
                syncs.push(() => { input.value = get(path); });
                input.addEventListener('input', () => { set(path, input.value); syncTheme(); });
                return h('div', { class: 'gpa-row' }, [h('span', { text: label }), input]);
            };
            const check = (path, label) => {
                const input = h('input', { type: 'checkbox' });
                syncs.push(() => { input.checked = !!get(path); });
                input.addEventListener('change', () => set(path, input.checked));
                return h('label', { class: 'gpue-chk' }, [input, label]);
            };
            const select = (path, label, options) => {
                const sel = h('select', {}, options.map(o => h('option', { value: o[0], text: o[1] })));
                syncs.push(() => { sel.value = get(path); });
                sel.addEventListener('change', () => set(path, sel.value));
                return h('div', { class: 'gpa-row' }, [h('span', { text: label }), sel]);
            };
            // o: { slot: слот картинки, name: имя файла, accept, validate(file): текст ошибки или '', maxSide, set(data, name), clear }
            // o: { slot: the image slot, name: the file name, accept, validate(file): error text or '', maxSide, set(data, name), clear }
            const imageRow = (label, o) => {
                const prev = h('img', { class: 'gpa-prev', alt: '' });
                const nameEl = h('span', { class: 'gpa-none', text: 'не выбрано' });
                const pick = h('button', { class: 'gpue-b', text: '📁 Файл', title: 'Выбрать картинку на компьютере' });
                const clr = h('button', { class: 'gpue-b', text: '✕', title: 'Убрать картинку' });
                const file = h('input', { type: 'file', accept: o.accept, style: 'display:none' });
                const sync = () => {
                    const slot = o.slot();
                    const img = slot ? slotImage(slot) : '';
                    const nm = o.name() || '';
                    prev.style.display = img ? 'block' : 'none';
                    if (img) prev.src = img; else prev.removeAttribute('src');
                    nameEl.textContent = img ? (nm || 'картинка') : (nm ? nm + ' (файла нет - выберите папку в «Сетапе»)' : 'не выбрано');
                    nameEl.title = nm;
                };
                syncs.push(sync);
                pick.addEventListener('click', () => file.click());
                file.addEventListener('change', async () => {
                    const f = file.files && file.files[0];
                    file.value = '';
                    if (!f) return;
                    const bad = o.validate ? o.validate(f) : '';
                    if (bad) { uiToast(bad, 'error'); return; }
                    try {
                        o.set(await readImageFile(f, o.maxSide || 2048), f.name);
                        syncAll();
                        uiToast('Картинка «' + f.name + '» загружена', 'ok', 1800);
                    } catch (e) {
                        uiToast(e && e.message ? e.message : 'Не удалось загрузить картинку.', 'error');
                    }
                });
                clr.addEventListener('click', () => { try { o.clear(); } catch (e) { uiToast(e.message, 'error'); } syncAll(); });
                const el = h('div', { class: 'gpa-img' }, [h('span', { text: label }), h('div', { class: 'gpa-imgbox' }, [prev, nameEl, pick, clr, file])]);
                el.gpaSync = sync;
                return el;
            };
            const section = (title, rows, open) => {
                const d = h('details', { class: 'gpa-sec' }, [h('summary', { text: title }), h('div', { class: 'gpa-body' }, rows)]);
                d.open = !!open;
                return d;
            };

            // Тема (стиль интерфейса): Default / встроенные / Custom. Свои сохранённые наборы - в блоке «Сетап».
            // A theme (interface style): Default / built-in / Custom. Your saved sets are in the "Setup" block.
            const themeSel = h('select', {});
            const isUser = () => String(settings.theme).startsWith('user:');
            const rebuildThemes = () => {
                themeSel.textContent = '';
                themeSel.appendChild(h('option', { value: 'default', text: 'Default (как в игре)' }));
                for (const k of Object.keys(THEMES)) themeSel.appendChild(h('option', { value: k, text: THEMES[k].name }));
                themeSel.appendChild(h('option', { value: 'custom', text: 'Custom' }));
                themeSel.value = isUser() ? 'custom' : settings.theme;
            };
            syncTheme = () => { themeSel.value = isUser() ? 'custom' : settings.theme; };
            themeSel.addEventListener('change', () => { setTheme(themeSel.value); syncAll(); });
            syncs.push(rebuildThemes);

            const enabled = h('input', { type: 'checkbox' });
            syncs.push(() => { enabled.checked = !!settings.enabled; });
            enabled.addEventListener('change', () => setEnabled(enabled.checked));

            // цели панелей
            // panel targets
            const targets = h('div', { class: 'gpa-targets' }, Object.keys(TARGET_LABELS).map(k => {
                const cb = h('input', { type: 'checkbox' });
                syncs.push(() => { cb.checked = !!settings.panels.targets[k]; });
                cb.addEventListener('change', () => setTarget(k, cb.checked));
                return h('label', { class: 'gpue-chk' }, [cb, TARGET_LABELS[k]]);
            }));

            // шрифты: системные + загруженные пользователем (★)
            // fonts: system ones + those uploaded by the user (★)
            const fontSelect = (path, label, o) => {
                const sel = h('select', {});
                const inp = o.other ? h('input', { type: 'text', placeholder: 'Например: Impact, sans-serif', spellcheck: 'false' }) : null;
                const rebuild = () => {
                    sel.textContent = '';
                    if (o.def) sel.appendChild(h('option', { value: '', text: 'Как в игре' }));
                    for (const f of FONTS) sel.appendChild(h('option', { value: f[1], text: f[0] }));
                    if (fontLib.items.length) {
                        const og = h('optgroup', { label: 'Загруженные' });
                        for (const it of fontLib.items) og.appendChild(h('option', { value: fontStack(it), text: '★ ' + it.name }));
                        sel.appendChild(og);
                    }
                    if (o.other) sel.appendChild(h('option', { value: '__custom', text: 'Другой…' }));
                };
                const sync = () => {
                    rebuild();
                    const cur = get(path);
                    const known = Array.from(sel.options).some(op => op.value === cur && op.value !== '__custom');
                    if (known) sel.value = cur; else if (o.other) sel.value = '__custom';
                    if (inp) { inp.style.display = known ? 'none' : 'block'; if (!known) inp.value = cur; }
                };
                syncs.push(sync);
                sel.addEventListener('change', () => {
                    if (sel.value === '__custom') { inp.style.display = 'block'; inp.focus(); return; }
                    set(path, sel.value);
                    sync();
                });
                if (inp) {
                    inp.addEventListener('change', () => {
                        const ok = cleanFont(inp.value, null);
                        if (ok === null) uiToast('Недопустимое название шрифта. Используйте буквы, цифры, пробелы, запятые и кавычки.', 'error');
                        else set(path, ok);
                        sync();
                    });
                }
                return h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
                    [h('div', { class: 'gpa-row' }, [h('span', { text: label }), sel]), inp].filter(Boolean));
            };

            const fontFile = h('input', { type: 'file', accept: '.ttf,.otf,.woff,.woff2', style: 'display:none' });
            const fontBtn = h('button', { class: 'gpue-b', text: '📁 Загрузить шрифт', title: '.ttf, .otf, .woff, .woff2 - файл остаётся на вашем компьютере' });
            const fontList = h('div', { class: 'gpa-fonts' });
            const fontNote = h('div', { class: 'gpue-hint', text: 'Шрифт читается локально и на сервер не отправляется. Файл хранится в хранилище Tampermonkey этого браузера.' });
            const renderFonts = () => {
                fontList.textContent = '';
                for (const it of fontLib.items) {
                    const del = h('button', { text: '✕', title: 'Удалить шрифт' });
                    del.addEventListener('click', async () => {
                        if (!(await uiDialog({ title: 'Удалить шрифт?', text: 'Шрифт «' + it.name + '» будет удалён из браузера.', okText: 'Удалить', danger: true }))) return;
                        removeFont(it.id);
                        syncAll();
                        uiToast('Шрифт «' + it.name + '» удалён', 'ok', 1800);
                    });
                    fontList.appendChild(h('div', { class: 'gpa-font-row' }, [h('span', { text: it.name, title: it.name }), del]));
                }
            };
            syncs.push(renderFonts);
            fontBtn.addEventListener('click', () => fontFile.click());
            fontFile.addEventListener('change', async () => {
                const f = fontFile.files && fontFile.files[0];
                fontFile.value = '';
                if (!f) return;
                try {
                    const it = await addFontFile(f);
                    set('text.font', fontStack(it));
                    syncAll();
                    fontNote.textContent = fontLib.persisted
                        ? 'Шрифт «' + it.name + '» загружен и сохранён в браузере.'
                        : 'Шрифт «' + it.name + '» работает, но браузер не дал сохранить файл: после перезагрузки страницы его нужно загрузить снова.';
                    uiToast(fontNote.textContent, fontLib.persisted ? 'ok' : 'warn');
                } catch (e) {
                    uiToast(e && e.message ? e.message : 'Не удалось загрузить шрифт.', 'error');
                }
            });

            // кнопки: к чему применять
            // buttons: what to apply to
            const BTN_OPTS = [
                ['all', 'Все кнопки'], ['tools', 'Кнопки инструментов'], ['colors', 'Панель цветов'],
                ['bottom', 'Нижняя панель'], ['header', 'Верхняя панель'], ['done', 'Кнопка «Готово»'], ['custom', 'Выбранный элемент…']
            ];
            const selInp = h('input', { type: 'text', placeholder: 'CSS-селектор выбранного элемента', spellcheck: 'false' });
            const selPick = h('button', { class: 'gpue-b', text: '🎯', title: 'Выбрать элемент кликом на странице', style: 'padding:4px 10px;flex:none' });
            syncs.push(() => { if (document.activeElement !== selInp) selInp.value = get('buttons.customSelector'); });
            const commitSel = v => {
                const ok = cleanSelector(v);
                if (!ok) { uiToast('Не удалось получить простой селектор для этого элемента. Выберите другой элемент или введите селектор вручную (без запятых).', 'error'); return; }
                set('buttons.customSelector', ok);
                set('buttons.target', 'custom');
                syncAll();
            };
            selInp.addEventListener('change', () => {
                if (selInp.value.trim()) commitSel(selInp.value);
                else { set('buttons.customSelector', ''); syncAll(); }
            });
            selPick.addEventListener('click', () => pickElement(commitSel));
            const btnCustomRow = h('div', { class: 'gpue-btnrow' }, [selInp, selPick]);
            const btnHint = h('div', {
                class: 'gpue-hint',
                text: 'Стиль меняет только внешний вид: размеры кнопок, рамки (через тень) и обработчики не затрагиваются. Кнопки с цветным inline-фоном (образцы цветов) пропускаются.'
            });


            // ---- Окно редактора -----
            // ---- Editor window -----
            const editorSection = section('Окно редактора', [
                check('editor.transparent', 'Прозрачное окно редактора'),
                range('editor.opacity', 'Прозрачность', '%'),
                check('editor.solidOnHover', 'Непрозрачное при наведении'),
                h('div', { class: 'gpue-hint', text: 'Касается только окон ⚙ UI и 🎨 круга и не зависит от остального внешнего вида. Быстрый переключатель - кнопка ◐ в заголовке окна.' })
            ], false);

            // ---- Свой CSS -----
            // ---- Custom CSS -----
            const cssArea = h('textarea', { class: 'gpa-code', spellcheck: 'false', wrap: 'off', placeholder: '/* Ваш CSS, например: */\n.draw > .tools { border-radius: 16px; }' });
            const cssNote = h('div', { class: 'gpue-hint' });
            const cssFile = h('input', { type: 'file', accept: '.css,.txt,text/css,text/plain', style: 'display:none' });
            const bPick = h('button', { class: 'gpue-b', text: '🎯 Выбрать элемент', title: 'Кликните по любому элементу на странице: его селектор попадёт в CSS' });
            const bImp = h('button', { class: 'gpue-b', text: '⬆ .css', title: 'Загрузить CSS из файла (заменит текст)' });
            const bExp = h('button', { class: 'gpue-b', text: '⬇ .css', title: 'Сохранить CSS в файл' });
            const bClr = h('button', { class: 'gpue-b gpue-danger', text: '🧹', title: 'Очистить CSS' });
            const EXAMPLES = [
                ['Скруглить кнопки', '.draw > .tools button { border-radius: 14px; }'],
                ['Тень у панелей', '.draw > .tools, .draw > .colors { box-shadow: 0 6px 20px rgba(0,0,0,.45); }'],
                ['Шрифт панелей', '.draw > .tools, .draw > .colors, .draw .bottom { font-family: "Comic Sans MS", cursive; }'],
                ['Спрятать элемент', '/* уберите комментарий, чтобы скрыть: */\n/* .draw .time { display: none; } */'],
                ['Рамка холста (не меняет размеры)', '.draw .drawingContainer { outline: 3px dashed #ffd400; }'],
                ['Окно редактора: фон', '#gpue-panel { background: #101018; }']
            ];
            const exSel = h('select', {}, [
                h('option', { value: '', text: '📋 Вставить пример…' }),
                ...EXAMPLES.map((e, i) => h('option', { value: String(i), text: e[0] }))
            ]);
            const refreshNote = () => { cssNote.textContent = customNotes.join(' '); };
            onChange(refreshNote);
            syncs.push(() => {
                if (document.activeElement !== cssArea) cssArea.value = get('custom.css');
                refreshNote();
            });
            let cssT = 0;
            const commit = () => {
                clearTimeout(cssT);
                cssT = setTimeout(() => {
                    set('custom.css', cssArea.value);
                    if (cssArea.value.trim() && !get('custom.enabled')) { set('custom.enabled', true); syncAll(); }
                }, 350);
            };
            cssArea.addEventListener('input', commit);
            cssArea.addEventListener('keydown', e => {
                if (e.key !== 'Tab' || e.shiftKey) return;
                e.preventDefault();
                cssArea.setRangeText('  ', cssArea.selectionStart, cssArea.selectionEnd, 'end');
                commit();
            });
            const insert = (text, caretAfter) => {
                const a = cssArea;
                const v = a.value;
                const start = a.selectionStart == null ? v.length : a.selectionStart;
                const pre = v && !v.slice(0, start).endsWith('\n') ? '\n' : '';
                a.setRangeText(pre + text, start, a.selectionEnd == null ? start : a.selectionEnd, 'end');
                if (caretAfter != null) {
                    const pos = start + pre.length + caretAfter;
                    a.setSelectionRange(pos, pos);
                }
                a.focus();
                commit();
            };
            bPick.addEventListener('click', () => pickElement(sel => {
                const rule = sel + ' {\n  \n}\n';
                insert(rule, rule.indexOf('{\n  ') + 4);
            }));
            exSel.addEventListener('change', () => {
                const ex = EXAMPLES[Number(exSel.value)];
                exSel.value = '';
                if (ex) insert(ex[1] + '\n');
            });
            bClr.addEventListener('click', async () => {
                if (!cssArea.value.trim()) return;
                if (!(await uiDialog({ title: 'Очистить свой CSS?', text: 'Весь текст пользовательского CSS будет удалён.', okText: 'Очистить', danger: true }))) return;
                cssArea.value = '';
                clearTimeout(cssT);
                set('custom.css', '');
            });
            bExp.addEventListener('click', () => downloadFile('gartic-custom.css', cssArea.value + '\n', 'text/css'));
            bImp.addEventListener('click', () => cssFile.click());
            cssFile.addEventListener('change', () => {
                const f = cssFile.files && cssFile.files[0];
                cssFile.value = '';
                if (!f) return;
                const rd = new FileReader();
                rd.onload = async () => {
                    if (cssArea.value.trim() && !(await uiDialog({ title: 'Заменить CSS?', text: 'Текущий CSS будет заменён содержимым файла «' + (f.name || 'файл') + '».', okText: 'Заменить', danger: true }))) return;
                    cssArea.value = String(rd.result).slice(0, 100000);
                    clearTimeout(cssT);
                    set('custom.css', cssArea.value);
                    if (cssArea.value.trim() && !get('custom.enabled')) { set('custom.enabled', true); syncAll(); }
                };
                rd.readAsText(f);
            });
            const customSection = section('Пользовательский CSS', [
                check('custom.enabled', 'Включить свой CSS'),
                check('custom.important', 'Добавлять !important (заменять стили игры)'),
                cssArea,
                h('div', { class: 'gpue-btnrow' }, [bPick, exSel]),
                h('div', { class: 'gpue-btnrow' }, [bImp, bExp, bClr, cssFile]),
                cssNote,
                h('div', {
                    class: 'gpue-hint',
                    text: 'Работает для любых элементов страницы, в том числе окон редактора (#gpue-panel). Не задавайте холсту размеры, padding, border и transform: рисование сместится. Внешние ссылки блокируются, картинки берите из файла (data:). Если CSS спрятал редактор: Ctrl+Alt+Shift+0.'
                })
            ], false);
            const enabledRow = h('label', { class: 'gpue-chk' }, [enabled, 'Включить пользовательский внешний вид']);
            // ---- блок «Рамка холста»: PNG поверх холста -----
            // ---- the "Canvas frame" block: a PNG over the canvas -----
            const pngOnly = f => (f.type === 'image/png' || /\.png$/i.test(f.name || '')) ? '' : 'Нужен файл в формате PNG.';
            const bPlace = h('button', { class: 'gpue-b', text: '✥ Положение и размер', title: 'Открыть вкладку «Раскладка» с рамкой и включить режим редактирования' });
            const bPlaceReset = h('button', { class: 'gpue-b', text: '↺ На весь холст', title: 'Вернуть рамке положение и размер холста' });
            bPlace.addEventListener('click', () => {
                if (!slotImage('overlay')) { uiToast('Сначала загрузите PNG.', 'warn'); return; }
                selectKey(OVERLAY_KEY);
                setTab('layout');
                if (!editMode) setEditMode(true);
            });
            bPlaceReset.addEventListener('click', () => setOverlayLayout(DEFAULT_STATE));
            const frameSection = section('Рамка холста', [
                imageRow('PNG поверх холста', {
                    slot: () => 'overlay', name: () => settings.overlay.imageName, accept: '.png,image/png', validate: pngOnly, maxSide: 2048,
                    set: (d, n) => { putImage('overlay', d, n); set('overlay.enabled', true); },
                    clear: () => dropImage('overlay')
                }),
                check('overlay.enabled', 'Показывать'),
                range('overlay.opacity', 'Прозрачность', '%'),
                select('overlay.fit', 'Как вписать', OV_FITS.map(f => [f, OV_FIT_LABELS[f]])),
                h('div', { class: 'gpue-btnrow' }, [bPlace, bPlaceReset]),
                h('div', {
                    class: 'gpue-hint',
                    text: 'Картинка лежит поверх холста, а мышь и перо проходят сквозь неё: рисовать можно как обычно. Реагирует она только в режиме редактирования - там её можно двигать и менять размер, как остальные элементы вкладки «Раскладка» (она есть в списке элементов).'
                })
            ], true);

            // ---- блок «Фон»: цвет или картинка/GIF за интерфейсом -----
            // ---- the "Background" block: a color or an image/GIF behind the interface -----
            const bgSection = section('Фон', [
                select('background.mode', 'Тип', [['none', 'Не менять'], ['color', 'Цвет'], ['image', 'Картинка или GIF']]),
                color('background.color', 'Цвет'),
                imageRow('Картинка / GIF', {
                    slot: () => 'background', name: () => settings.background.imageName, accept: '.png,.jpg,.jpeg,.gif,.webp,image/*', maxSide: 1920,
                    set: (d, n) => { putImage('background', d, n); set('background.mode', 'image'); },
                    clear: () => { dropImage('background'); if (get('background.mode') === 'image') set('background.mode', 'none'); }
                }),
                select('background.fit', 'Как показать', BG_FITS.map(f => [f, BG_FIT_LABELS[f]])),
                h('div', {
                    class: 'gpue-hint',
                    text: 'Меняет фон страницы игры. GIF должен быть не больше ~3,5 МБ. Если фон не виден, его перекрывают собственные слои игры.'
                })
            ], true);

            // ---- блок «Интерфейс»: замена элемента картинкой + стиль -----
            // ---- the "Interface" block: replacing an element with an image + style -----
            let skinKey = null; // элемент, выбранный в режиме редактирования (общий выбор с «Раскладкой») | element selected in the editing mode (shared selection with "Layout")
            const skinSel = h('select', {});
            const skinInfo = h('div', { class: 'gpue-hint' });
            const bEditMode = h('button', { class: 'gpue-b', text: '🖱 Режим редактирования' });
            const skinList = h('div', { class: 'gpa-fonts' });
            const skinCtl = [];
            const curSkin = () => (skinKey ? settings.skins.find(x => x.key === skinKey) : null);
            const skinRange = (label, prop) => {
                const input = h('input', { type: 'range', min: '0', max: String(SKIN_MAX_SIZE), step: '1' });
                const val = h('span', { class: 'gpa-val' });
                const show = v => { val.textContent = Number(v) === 0 ? 'авто' : v + 'px'; };
                skinCtl.push(() => {
                    const sk = curSkin();
                    input.value = String(sk ? sk[prop] : 0);
                    input.disabled = !skinKey;
                    show(input.value);
                });
                input.addEventListener('input', () => {
                    if (!skinKey) return;
                    try { setSkinProp(skinKey, { [prop]: Number(input.value) }); } catch (e) { uiToast(e.message, 'error'); }
                    show(input.value);
                });
                return h('div', { class: 'gpa-row' }, [h('span', { text: label }), input, val]);
            };
            const skinFit = h('select', {}, OV_FITS.map(f => h('option', { value: f, text: OV_FIT_LABELS[f] })));
            const skinHide = h('input', { type: 'checkbox' });
            skinCtl.push(() => {
                const sk = curSkin();
                skinFit.value = sk ? sk.fit : 'stretch';
                skinFit.disabled = !skinKey;
                skinHide.checked = sk ? sk.hide : true;
                skinHide.disabled = !skinKey;
            });
            skinFit.addEventListener('change', () => { if (skinKey) { try { setSkinProp(skinKey, { fit: skinFit.value }); } catch (e) { uiToast(e.message, 'error'); } } });
            skinHide.addEventListener('change', () => { if (skinKey) { try { setSkinProp(skinKey, { hide: skinHide.checked }); } catch (e) { uiToast(e.message, 'error'); } } });
            skinSel.addEventListener('change', () => { selectKey(skinSel.value); });
            bEditMode.addEventListener('click', () => { setEditMode(!editMode); refreshSkin(); });
            const refreshSkin = () => {
                const cur = state.selected;
                skinKey = cur && cur !== OVERLAY_KEY && ELEMENTS[cur] ? cur : null;
                skinSel.textContent = '';
                for (const k of Object.keys(ELEMENTS)) {
                    if (k !== OVERLAY_KEY) skinSel.appendChild(h('option', { value: k, text: ELEMENTS[k].name }));
                }
                if (skinKey) skinSel.value = skinKey;
                skinInfo.textContent = skinKey
                    ? 'Выбран элемент: ' + ELEMENTS[skinKey].name + '. Выберите картинку и при желании задайте размер.'
                    : (cur === OVERLAY_KEY
                        ? 'Выбрана рамка холста: её картинка настраивается в блоке «Рамка холста».'
                        : 'Элемент не выбран: включите режим редактирования и кликните по элементу интерфейса.');
                bEditMode.textContent = editMode ? '🖱 Выйти из режима редактирования' : '🖱 Режим редактирования (клик по элементу)';
                skinCtl.forEach(fn => fn());
                skinList.textContent = '';
                for (const sk of settings.skins) {
                    if (!ELEMENTS[sk.key] || !slotImage('skin:' + sk.key)) continue;
                    const go = h('button', { text: '↦', title: 'Выбрать этот элемент', style: 'border-color:#6b6b9a' });
                    go.addEventListener('click', () => selectKey(sk.key));
                    const del = h('button', { text: '✕', title: 'Убрать замену' });
                    del.addEventListener('click', () => { removeSkin(sk.key); syncAll(); });
                    const label = ELEMENTS[sk.key].name + ' - ' + (sk.imageName || 'картинка');
                    skinList.appendChild(h('div', { class: 'gpa-font-row' }, [h('span', { text: label, title: label }), go, del]));
                }
            };
            syncs.push(refreshSkin);
            const skinImg = imageRow('Изображение вместо элемента', {
                slot: () => (skinKey ? 'skin:' + skinKey : ''),
                name: () => (curSkin() ? curSkin().imageName : ''),
                accept: '.png,.jpg,.jpeg,.gif,.webp,image/*', maxSide: 1024,
                set: (d, n) => {
                    if (!skinKey) throw new Error('Сначала выберите элемент: режим редактирования и клик по нему.');
                    putImage('skin:' + skinKey, d, n);
                },
                clear: () => { if (skinKey) removeSkin(skinKey); }
            });
            // выбор элемента в редакторе сразу отражается в этом блоке
            // element selection in the editor is immediately reflected in this block
            appearanceOnSelect = () => { refreshSkin(); skinImg.gpaSync(); };

            // те же элементы управления, сгруппированные по смыслу. Редкие параметры помечены markAdv
            // the same controls, grouped by meaning. Rare parameters are marked with markAdv
            // и видны только в расширенном режиме; обработчики и пути настроек не менялись.
            // and are visible only in advanced mode; handlers and settings paths were not changed.
            const advanced = markAdv(section('Дополнительные параметры стиля', [
                section('Панели', [
                    h('div', { text: 'Применять к:' }), targets,
                    range('interface.opacity', 'Прозрачность панелей игры', '%'),
                    check('interface.blur', 'Размытие фона панелей'),
                    check('panels.border', 'Рамка'),
                    color('panels.borderColor', 'Цвет рамки'),
                    range('panels.borderWidth', 'Толщина рамки', 'px')
                ]),
                section('Кнопки', [
                    select('buttons.target', 'Применить к', BTN_OPTS),
                    btnCustomRow,
                    range('buttons.radius', 'Скругление кнопок', 'px'),
                    color('buttons.borderColor', 'Цвет рамки'),
                    range('buttons.borderWidth', 'Толщина рамки', 'px'),
                    check('buttons.shadow', 'Тень'),
                    range('buttons.opacity', 'Прозрачность', '%'),
                    fontSelect('buttons.fontFamily', 'Шрифт', { def: true }),
                    range('buttons.fontSize', 'Размер шрифта', 'px', 'авто'),
                    select('buttons.fontWeight', 'Толщина шрифта', [['', 'Как в игре'], ['normal', 'Обычная'], ['500', 'Средняя'], ['600', 'Полужирная'], ['bold', 'Жирная']]),
                    btnHint
                ]),
                section('Текст', [
                    color('text.color', 'Цвет текста'),
                    check('text.bold', 'Жирный'),
                    check('text.shadow', 'Тень текста')
                ])
            ], false));
            markAdv(editorSection);
            markAdv(customSection);
            const styleSection = section('Тема и цвета', [
                h('div', { class: 'gpa-row' }, [h('span', { text: 'Тема' }), themeSel]),
                color('panels.background', 'Цвет панелей'),
                range('panels.opacity', 'Прозрачность панелей', '%'),
                color('buttons.background', 'Цвет кнопок'),
                color('buttons.text', 'Цвет текста кнопок'),
                color('buttons.hover', 'Кнопка при наведении'),
                color('buttons.active', 'Кнопка при нажатии'),
                range('interface.radius', 'Скругление', 'px', null, ['buttons.radius']),
                check('interface.shadow', 'Тени панелей'),
                advanced
            ], false);
            const fontsSection = section('Шрифты и текст', [
                fontSelect('text.font', 'Шрифт', { other: true }),
                range('text.size', 'Размер текста', 'px'),
                h('div', { class: 'gpue-btnrow' }, [fontBtn, fontFile]),
                fontList,
                fontNote
            ], false);
            const interfaceSection = section('Интерфейс: картинки вместо элементов', [
                skinInfo,
                h('div', { class: 'gpa-row' }, [h('span', { text: 'Элемент' }), skinSel]),
                bEditMode,
                skinImg,
                skinRange('Ширина', 'w'),
                skinRange('Высота', 'h'),
                h('div', { class: 'gpa-row' }, [h('span', { text: 'Как вписать' }), skinFit]),
                h('label', { class: 'gpue-chk' }, [skinHide, 'Скрыть оригинал (останется на месте и кликабельным)']),
                skinList,
                h('div', {
                    class: 'gpue-hint',
                    text: 'Картинка (PNG, GIF и др.) накладывается поверх элемента и не перехватывает клики: сам элемент работает как раньше. Ширина и высота «авто» - размер элемента.'
                })
            ], false);

            // ---- блок «Сетап»: папка с картинками, сохранить / загрузить -----
            // ---- the "Setup" block: an image folder, save / load -----
            const folderInp = h('input', { type: 'file', style: 'display:none' });
            folderInp.setAttribute('webkitdirectory', '');
            folderInp.setAttribute('directory', '');
            folderInp.multiple = true;
            const bFolder = h('button', { class: 'gpue-b', text: '📂 Выбрать папку с картинками' });
            const folderInfo = h('div', { class: 'gpue-hint' });
            const stat = h('div', { class: 'gpue-hint' });
            const say = t => { stat.textContent = t; };
            const setupSel = h('select', {});
            const bLoad = h('button', { class: 'gpue-b', text: '📥 Загрузить', title: 'Применить выбранный сетап; картинки встанут по именам из папки' });
            const bSave = h('button', { class: 'gpue-b', text: '💾 Сохранить', title: 'Сохранить вид, имена картинок, размеры и положения' });
            const bDel = h('button', { class: 'gpue-b gpue-danger', text: '🗑 Удалить' });
            const bSetupExp = h('button', { class: 'gpue-b', text: '⬇ Экспорт', title: 'Сохранить выбранный сетап в файл (без картинок)' });
            const bSetupImp = h('button', { class: 'gpue-b', text: '⬆ Импорт', title: 'Добавить сетап из файла' });
            const impFile = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
            const bRst = h('button', { class: 'gpue-b gpue-danger', text: '↺ Сбросить всё', title: 'Сбросить внешний вид, рамку, фон, замены и свой CSS' });
            const curSetupId = () => (setupSel.value.startsWith('user:') ? setupSel.value.slice(5) : '');
            const rebuildSetups = () => {
                const prev = setupSel.value;
                setupSel.textContent = '';
                setupSel.appendChild(h('option', { value: '', text: userThemes.length ? '— выберите сетап —' : '— сетапов пока нет —' }));
                for (const t of userThemes) setupSel.appendChild(h('option', { value: 'user:' + t.id, text: t.name }));
                setupSel.value = Array.from(setupSel.options).some(o => o.value === prev) ? prev : (isUser() ? settings.theme : '');
            };
            syncs.push(rebuildSetups);
            syncs.push(() => {
                folderInfo.textContent = folder.files.size
                    ? 'Папка: «' + (folder.name || '...') + '», картинок: ' + folder.files.size
                    : 'Папка не выбрана. Браузер не даёт вписать путь вручную: нажмите кнопку и выберите папку в окне.';
            });
            bFolder.addEventListener('click', () => folderInp.click());
            folderInp.addEventListener('change', async () => {
                const n = setFolder(folderInp.files);
                folderInp.value = '';
                let filled = 0;
                try { filled = await fillMissingFromFolder(); } catch (e) { /* ignore */ }
                syncAll();
                say(n ? 'Найдено картинок: ' + n + (filled ? '. Подставлено недостающих: ' + filled : '') + '.' : 'В выбранной папке нет картинок.');
            });
            bLoad.addEventListener('click', async () => {
                const id = curSetupId();
                if (!id) { uiToast('Выберите сетап в списке.', 'warn'); return; }
                bLoad.disabled = true;
                try {
                    const r = await loadSetup(id);
                    syncAll();
                    if (!r) { say('Сетап не найден.'); return; }
                    const parts = ['Сетап загружен.'];
                    if (r.loaded) parts.push('Картинок подставлено: ' + r.loaded + (r.fromFolder ? ' (из папки: ' + r.fromFolder + ')' : '') + '.');
                    if (r.missing.length) {
                        parts.push('Не найдено: ' + r.missing.join(', ') + '.' + (folder.files.size ? '' : ' Выберите папку с картинками и нажмите «Загрузить» ещё раз.'));
                    }
                    say(parts.join(' '));
                    uiToast(r.missing.length ? 'Сетап загружен, но не все картинки найдены' : 'Сетап загружен', r.missing.length ? 'warn' : 'ok');
                } catch (e) {
                    say('Не удалось загрузить сетап.');
                    uiToast('Не удалось загрузить сетап.', 'error');
                } finally {
                    bLoad.disabled = false;
                }
            });
            bSave.addEventListener('click', async () => {
                const cur = userThemes.find(t => t.id === curSetupId());
                const name = await uiDialog({
                    title: 'Сохранить сетап оформления',
                    text: 'Сохраняются вид, имена картинок, их размеры и положения.',
                    input: { value: cur ? cur.name : 'Мой сетап', maxlength: 60, placeholder: 'Название сетапа' },
                    validate: v => (cleanThemeName(v) ? '' : 'Введите название сетапа.'),
                    okText: 'Сохранить'
                });
                if (name === null) return;
                const clean = cleanThemeName(name);
                if (!clean) { uiToast('Введите название сетапа.', 'warn'); return; }
                if (findUserTheme(clean) && !(await uiDialog({ title: 'Перезаписать сетап?', text: 'Сетап «' + clean + '» уже есть. Заменить его текущим оформлением?', okText: 'Перезаписать', danger: true }))) return;
                const it = saveUserTheme(clean);
                if (!it) { uiToast('Не удалось сохранить: достигнут лимит сетапов (' + THEME_MAX + ').', 'error'); return; }
                syncAll();
                setupSel.value = 'user:' + it.id;
                say('Сохранено: «' + it.name + '». Названия картинок и размеры записаны.');
                uiToast('Сетап «' + it.name + '» сохранён', 'ok');
            });
            bDel.addEventListener('click', async () => {
                const cur = userThemes.find(t => t.id === curSetupId());
                if (!cur) { uiToast('Выберите сетап в списке.', 'warn'); return; }
                if (!(await uiDialog({ title: 'Удалить сетап?', text: 'Сетап «' + cur.name + '» будет удалён. Текущее оформление не изменится.', okText: 'Удалить', danger: true }))) return;
                deleteUserTheme(cur.id);
                syncAll();
                say('Сетап удалён.');
                uiToast('Сетап «' + cur.name + '» удалён', 'ok');
            });
            bSetupExp.addEventListener('click', () => {
                const cur = userThemes.find(t => t.id === curSetupId());
                const text = cur ? exportSetupFile(cur.id) : null;
                if (!text) { uiToast('Выберите сетап в списке (или сначала сохраните текущий).', 'warn'); return; }
                const nm = cur.name.replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'setup';
                downloadFile('gartic-setup-' + nm + '.json', text, 'application/json');
                say('Файл передан браузеру для скачивания. Картинок в нём нет: передавайте их вместе, в одной папке.');
                uiToast('Файл сетапа передан браузеру для скачивания', 'info');
            });
            bSetupImp.addEventListener('click', () => impFile.click());
            impFile.addEventListener('change', () => {
                const f = impFile.files && impFile.files[0];
                impFile.value = '';
                if (!f) return;
                const rd = new FileReader();
                rd.onload = () => {
                    const r = importSetupFile(String(rd.result));
                    if (!r) { say('Файл не похож на сетап.'); uiToast('Файл не похож на сетап оформления.', 'error'); return; }
                    syncAll();
                    setupSel.value = 'user:' + r.id;
                    say('Импортировано сетапов: ' + r.added + '. Выберите папку с картинками и нажмите «Загрузить».');
                    uiToast('Импортировано сетапов: ' + r.added, 'ok');
                };
                rd.readAsText(f);
            });
            bRst.addEventListener('click', async () => {
                if (!(await uiDialog({
                    title: 'Сбросить всё оформление?',
                    text: 'Внешний вид, рамка, фон, замены элементов и свой CSS вернутся к исходным.\n\nШрифты и сохранённые сетапы останутся. Действие нельзя отменить.',
                    okText: 'Сбросить',
                    danger: true
                }))) return;
                reset();
                syncAll();
                say('Сброшено (шрифты и сохранённые сетапы остались).');
                uiToast('Оформление сброшено', 'warn');
            });
            const setupSection = section('Сетапы оформления', [
                bFolder, folderInp, folderInfo,
                h('div', { class: 'gpa-row' }, [h('span', { text: 'Сетап' }), setupSel]),
                h('div', { class: 'gpue-btnrow' }, [bLoad, bSave, bDel]),
                markAdv(h('div', { class: 'gpue-btnrow' }, [bSetupExp, bSetupImp, impFile])),
                markAdv(bRst),
                stat,
                h('div', {
                    class: 'gpue-hint',
                    text: 'Сетап хранит вид, ИМЕНА картинок, их размеры и положения (сами картинки не входят). Чтобы загрузить чужой интерфейс: импортируйте файл сетапа, выберите папку с его картинками и нажмите «Загрузить» - картинки встанут на места по совпадающим именам.'
                })
            ], true);

            const diagArea = h('textarea', { class: 'gpa-code', readonly: 'readonly', spellcheck: 'false', wrap: 'off', style: 'min-height:200px' });
            const bDiag = h('button', { class: 'gpue-b', text: '🩺 Собрать отчёт' });
            const bDiagCopy = h('button', { class: 'gpue-b', text: '📋 Копировать' });
            bDiag.addEventListener('click', () => { try { diagArea.value = diagnostics(); } catch (e) { diagArea.value = 'Не удалось собрать отчёт: ' + (e && e.message ? e.message : e); } });
            bDiagCopy.addEventListener('click', () => {
                if (!diagArea.value) bDiag.click();
                diagArea.select();
                let ok = false;
                try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
                if (ok) { uiToast('Отчёт скопирован', 'ok', 1800); return; }
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(diagArea.value)
                        .then(() => uiToast('Отчёт скопирован', 'ok', 1800))
                        .catch(() => uiToast('Не удалось скопировать: выделите текст и нажмите Ctrl+C', 'warn'));
                } else {
                    uiToast('Не удалось скопировать: выделите текст и нажмите Ctrl+C', 'warn');
                }
            });
            // исследование игры (зонд только читает) и проверка точности попадания
            // game research (the probe only reads) and hit-accuracy checking
            const probeStat = h('div', { class: 'gpue-hint' });
            const bProbe = h('button', { class: 'gpue-b', text: '🔬 Исследовать игру (2 мин)', title: 'Подсчитать, как игра рисует, зумит и отправляет рисунок. Ничего не меняет.' });
            const bProbeStop = h('button', { class: 'gpue-b', text: '⏹ Стоп' });
            const bAcc = h('button', { class: 'gpue-b', text: '🎯 Проверка точности', title: 'Проведите линию на холсте: отчёт покажет, насколько линия игры отклоняется от курсора' });
            const syncProbe = () => {
                let on = false;
                try { on = GameProbe.isOn(); probeStat.textContent = GameProbe.status(); } catch (e) { probeStat.textContent = 'Зонд недоступен.'; }
                bProbeStop.disabled = !on;
            };
            bProbe.addEventListener('click', () => { GameProbe.start(120); syncProbe(); uiToast('Исследование началось: порисуйте мышью и пером, Ctrl+колесо, ПКМ, «Готово».', 'info', 5000); });
            bProbeStop.addEventListener('click', () => { GameProbe.stop(); syncProbe(); bDiag.click(); });
            bAcc.addEventListener('click', () => { GameProbe.startAccuracy(); syncProbe(); uiToast('Проведите линию на холсте игры.', 'info', 4000); });
            try {
                GameProbe.onUpdate(() => { syncProbe(); if (!GameProbe.isOn() || diagArea.value) { try { diagArea.value = diagnostics(); } catch (e) { /* ignore */ } } });
            } catch (e) { /* ignore */ }
            setInterval(() => { if (!document.hidden && GameProbe.isOn()) syncProbe(); }, 1000);
            syncProbe();
            const diagSection = section('Диагностика', [
                h('div', { class: 'gpue-btnrow' }, [bDiag, bDiagCopy]),
                h('div', { class: 'gpue-btnrow' }, [bProbe, bProbeStop]),
                bAcc,
                probeStat,
                diagArea,
                h('div', { class: 'gpue-hint', text: 'Отчёт показывает, какие элементы игры найдены и что доступно в браузере: пригодится, если что-то не работает. В нём только счётчики и размеры, без ваших картинок и настроек.' })
            ], false);
            // «Кисть», «Нажим кисти», «Перемещение холста» и «Слои» перенесены во вкладку «Рисование»
            // "Brush", "Brush pressure", "Canvas panning" and "Layers" were moved to the "Drawing" tab
            markAdv(diagSection);
            const enabledCard = h('div', { class: 'gpue-ui-card', style: 'gap:6px' }, [
                enabledRow,
                h('div', { class: 'gpue-hint', text: 'Пока выключено, игра выглядит как обычно. Окно редактора, кисть и раскладка от этого переключателя не зависят.' })
            ]);
            const advNote = h('div', { class: 'gpue-hint', style: 'text-align:center;padding:2px 0' });
            advNote.append('Свой CSS, окно редактора, дополнительные параметры стиля и диагностика - в ');
            const advLink = h('button', { type: 'button', class: 'gpue-b gpue-ui-ghost gpue-ui-sm', text: 'расширенном режиме', style: 'display:inline-flex;min-height:0;padding:0 4px;color:#B9A6FF;vertical-align:baseline' });
            advLink.addEventListener('click', () => setUiMode('advanced'));
            advNote.appendChild(advLink);
            const advNoteWrap = h('div', { class: 'gpue-ui-simple-only' }, [advNote]);
            const page = h('div', { class: 'gpa', style: 'display:flex;flex-direction:column;gap:10px' }, [
                enabledCard,
                frameSection,
                bgSection,
                interfaceSection,
                fontsSection,
                styleSection,
                customSection,
                editorSection,
                setupSection,
                diagSection,
                advNoteWrap
            ].filter(Boolean));

            syncAll = () => syncs.forEach(fn => fn());
            syncAll();
            return page;
        }

        return {
            init, load, save, get, set, apply, reset, setTheme,
            toggleEditorTransparent, onChange, diagnostics,
            addFont: addFontFile, removeFont, listFonts: () => fontLib.items.map(f => ({ id: f.id, name: f.name, family: f.family })),
            saveUserTheme, deleteUserTheme, loadSetup, exportSetupFile, importSetupFile, setFolder,
            listUserThemes: () => userThemes.map(t => ({ id: t.id, name: t.name })), resetLook,
            putImage, dropImage, setSkinProp, removeSkin,
            buildPage,
            getCss: () => buildCss(settings),
            getThemes: () => Object.keys(THEMES)
        };
    })();


    // =====================================================
    // BrushSettings: блок «Кисть» во вкладке «Внешний вид».
    // BrushSettings: the "Brush" block in the "Appearance" tab.
    //
    // 1) Курсор кисти - чисто визуальный слой (position:fixed, pointer-events:none). Позиция берётся из НЕИСПРАВЛЕННЫХ
    // 1) The brush cursor is a purely visual layer (position:fixed, pointer-events:none). The position is taken from the UNCORRECTED
    // координат события (геттер MouseEvent.prototype), диаметр круга - из кружка, который игра сама рисует на курсорном
    // event coordinates (the MouseEvent.prototype getter), the circle diameter - from the circle the game itself draws on the cursor
    // canvas (getCursorCanvas), поэтому он равен реальной кисти и учитывает масштаб холста.
    // canvas (getCursorCanvas), so it equals the real brush and accounts for the canvas scale.
    // 2) Толщина и нажим меняют только ОТРИСОВКУ линий на canvas рисования: на время вызова stroke ширина линии
    // 2) Thickness and pressure change only the RENDERING of lines on the drawing canvas: for the duration of a stroke call the line width
    // умножается на коэффициент и сразу возвращается (arc-«штампы» кисти масштабируются так же). Это единственный способ
    // is multiplied by a factor and immediately restored (the brush's arc "stamps" are scaled the same way). This is the only way
    // получить кисть тоньше минимума игры. Перехват ставится ЛЕНИВО: только если толщина не 100% или нажим > 0,
    // to get a brush thinner than the game's minimum. The hook is installed LAZILY: only if the thickness is not 100% or pressure > 0,
    // а при возврате к значениям по умолчанию снимается. События, координаты и код коррекции не затрагиваются.
    // and it is removed when returning to the default values. Events, coordinates and the correction code are not touched.
    // Если игра рисует иначе (OffscreenCanvas, кэшированные методы, чужие обёртки), блок честно сообщает, что перехвата нет.
    // If the game draws differently (OffscreenCanvas, cached methods, foreign wrappers), the block honestly reports that there is no hook.
    // =====================================================
    const BrushSettings = (() => {
        const KEY = 'gpUiBrush.v1';
        const CUR_ID = 'gpe-brush-cursor', STYLE_ID = 'gpe-brush-style';
        const DRAW_SEL = '.draw .drawingContainer canvas'; // реальный canvas рисования (как в «Рамке холста») | the real drawing canvas (as in "Canvas frame")
        const DRAW_BOX = '.draw .drawingContainer';
        const IMG_DATA_RE = /^data:image\/(?:png|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
        const IMG_PERSIST_MAX = 260000;
        const IMG_FILE_MAX = 512 * 1024;
        const MODES = ['normal', 'circle', 'cross', 'dot', 'image'];
        const clone = o => JSON.parse(JSON.stringify(o));
        const num = (v, a, b, d) => { v = Number(v); return isFinite(v) ? Math.min(b, Math.max(a, v)) : d; };
        const DEF = {
            cursor: { mode: 'normal', color: '#00ffff', width: 2, imageData: '' },
            thickness: 100, // % от кисти игры; меньше 100 - тоньше | % of the game brush; below 100 - thinner
            pressure: 0     // чувствительность к нажиму пера, % | pen pressure sensitivity, %
        };
        let cfg = clone(DEF);
        let ui = null;
        let saveT = 0, raf = 0, trailT = 0;
        let px = 0, py = 0, haveXY = false, moved = false, lastMeasure = 0;
        let pType = 'mouse', pPress = 0.5, downIn = false;
        const meas = { d: 0, at: 0 };            // диаметр кружка игры в px canvas | diameter of the game cursor circle in canvas px
        let imgSrc = '', blobUrl = '', imgSize = 32, shapeKey = '', hiddenCanvas = null;
        const handlers = [];                      // [target, type, fn, opts]
        const hook = { on: false, proto: null, oStroke: null, oArc: null, oFill: null, oBegin: null, oMoveTo: null, oLineTo: null, oQuad: null, oBezier: null, oClose: null, oRect: null, oEllipse: null, oArcTo: null, wStroke: null, wArc: null, wFill: null, wBegin: null, wMoveTo: null, wLineTo: null, wQuad: null, wBezier: null, wClose: null, wRect: null, wEllipse: null, wArcTo: null, seen: 0, seenAux: 0, fills: 0, scaled: 0, seg: 0, fallback: 0, cacheHit: 0, normHit: 0, replay: 0, err: '' };

        // --------- рекордер path-команд и кэш профиля нажима ----------
        // --------- path-command recorder and the pressure profile cache ----------
        // Модель игры хранит ОДНУ толщину на весь штрих ([type, [color, thickness, alpha], ...coords]),
        // The game's model stores ONE thickness for the whole stroke ([type, [color, thickness, alpha], ...coords]),
        // а рендер повторяет штрихи из данных. Поэтому нажим фиксируется на стороне скрипта:
        // and the render repeats strokes from the data. Therefore pressure is fixed on the script side:
        // rec (WeakMap ctx→entry): команды текущего пути с множителем ширины, взятым В МОМЕНТ команды;
        // rec (WeakMap ctx→entry): the commands of the current path with the width multiplier taken AT THE MOMENT of the command;
        // segStore (WeakMap ctx→Map): сигнатура сегмента (координаты) → множитель; переживает повторный
        // segStore (WeakMap ctx→Map): a segment signature (coordinates) → multiplier; it survives a repeated
        // beginPath+полный re-stroke растущего пути в каждом кадре — у «старых» сегментов множитель
        // beginPath + full re-stroke of the growing path in every frame - the "old" segments' multipliers
        // не перезаписывается текущим нажимом;
        // are not overwritten by the current pressure;
        // profileCache (Map, LRU 400): сигнатура всего пути → массив множителей сегментов; при повторной
        // profileCache (Map, LRU 400): the signature of the whole path → an array of segment multipliers; on a repeated
        // отрисовке тех же координат игрой (undo/redo, новый раунд, альбом) возвращает нажимной профиль.
        // rendering of the same coordinates by the game (undo/redo, a new round, the album) it returns the pressure profile.
        const rec = new WeakMap();
        const segStore = new WeakMap();
        const PROFILE_MAX = 2000; // альбом в конце раунда перерисовывает ВСЕ штрихи - кэш должен их вместить | the album at the end of a round redraws ALL strokes - the cache must fit them
        // номер серии штриха. Множители сегментов ключуются с ним: записи старого штриха не
        // the stroke series number. Segment multipliers are keyed with it: the records of an old stroke are not
        // подмешиваются в новый, а финальная перерисовка ТОГО ЖЕ штриха (после pointerup, когда gesture
        // mixed into a new one, and the final re-rendering of the SAME stroke (after pointerup, when gesture
        // уже false) находит свои нажимные множители по тем же координатам.
        // is already false) finds its pressure multipliers by the same coordinates.
        let segEpoch = 0;
        const profileCache = new Map();
        const segDiag = { kind: '', lw0: 0, base: 0, press: 0, min: 0, max: 0, last: 0, resets: 0 };
        const r1 = v => Math.round(v * 10) / 10;
        function recEntry(ctx) {
            let e = rec.get(ctx);
            if (!e) { e = { cmds: [], usable: true, sig: '', lw: 0 }; rec.set(ctx, e); }
            return e;
        }
        function segMapFor(ctx) {
            let m = segStore.get(ctx);
            if (!m) { m = new Map(); segStore.set(ctx, m); }
            return m;
        }
        // ключ содержит segEpoch — в пределах одного штриха координаты уникальны, поэтому
        // the key contains segEpoch - within one stroke the coordinates are unique, so
        // сохранённый множитель возвращается ВСЕГДА, без проверки gesture. Именно это позволяет
        // the stored multiplier is returned ALWAYS, without a gesture check. This is exactly what allows
        // финальной перерисовке (сразу после pointerup, когда gesture уже false) получить нажимные
        // the final re-rendering (right after pointerup, when gesture is already false) to get the pressure
        // множители, а не widthFactor при отпущенном пере. Новый штрих = новая эпоха = чистые ключи.
        // multipliers rather than the widthFactor with the pen released. A new stroke = a new epoch = clean keys.
        function segFactor(ctx, key, f) {
            const m = segMapFor(ctx);
            const old = m.get(key);
            if (old !== undefined) return old;
            m.set(key, f);
            return f;
        }
        // нормализованная сигнатура профиля - форма штриха в единичном квадрате (точки минус bbox,
        // a normalized profile signature - the stroke's shape in a unit square (points minus the bbox,
        // делённые на размер). Не зависит от координат, размера canvas и плотности рендера, поэтому
        // divided by the size). It does not depend on coordinates, canvas size or render density, so
        // совпадает при повторной отрисовке на ДРУГОМ canvas в другом масштабе (альбом/книга в конце раунда).
        // it matches when re-rendered on ANOTHER canvas at a different scale (the album/book at the end of a round).
        // Квантование 1/50 терпит мелкие различия координат между живым штрихом и повтором из данных.
        // Quantization of 1/50 tolerates small coordinate differences between the live stroke and the replay from data.
        function normKey(ctx, entry) {
            try {
                const pts = [];
                for (const c of entry.cmds) {
                    if (c.op === 'M') pts.push([c.x, c.y]);
                    else if (c.op === 'L') pts.push([c.x, c.y]);
                    else if (c.op === 'Q') pts.push([c.x2, c.y2]);
                    else if (c.op === 'C') pts.push([c.x3, c.y3]);
                }
                if (pts.length < 2) return null;
                let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
                for (const p of pts) { if (p[0] < mnx) mnx = p[0]; if (p[1] < mny) mny = p[1]; if (p[0] > mxx) mxx = p[0]; if (p[1] > mxy) mxy = p[1]; }
                const scale = Math.max(mxx - mnx, mxy - mny) || 1;
                const q = v => Math.round(v * 50);
                return 'N:' + String(ctx.strokeStyle) + '|' + pts.map(p => q((p[0] - mnx) / scale) + '.' + q((p[1] - mny) / scale)).join('');
            } catch (e) { return null; }
        }
        // Профиль сохраняется под двумя ключами: точная сигнатура и нормализованная форма
        // The profile is stored under two keys: the exact signature and the normalized shape
        function profilePutPair(key, nk, factors) {
            if (profileCache.has(key)) profileCache.delete(key);
            profileCache.set(key, factors);
            if (nk && nk !== key) {
                if (profileCache.has(nk)) profileCache.delete(nk);
                profileCache.set(nk, factors);
            }
            while (profileCache.size > PROFILE_MAX) profileCache.delete(profileCache.keys().next().value);
        }
        function markUnusable(ctx) { const e = rec.get(ctx); if (e) e.usable = false; }

        // последние ЖИВЫЕ штрихи (форма полилинии + профиль нажима). Финальный рендер игра делает
        // the last LIVE strokes (the polyline shape + the pressure profile). The game's final render is done
        // СГЛАЖЕННОЙ геометрией из данных и может дорисовать «хвост» после отрыва стилуса - координаты и концы
        // with SMOOTHED geometry from the data and may add a "tail" after the pen lift - the coordinates and ends
        // не совпадают с живыми, поэтому сравниваем не концы, а ФОРМУ: живой путь как префикс финального
        // do not match the live ones, so we compare not the ends but the SHAPE: the live path as a prefix of the final one
        // по длине дуги (допуск 2% холста). Найденный профиль переносится на финальную геометрию по длине
        // by arc length (a 2% canvas tolerance). The found profile is transferred onto the final geometry by arc
        // дуги - хвост за пределами живого пути получает последний множитель. Попутно канонический путь
        // length - the tail beyond the live path gets the last multiplier. Along the way the canonical path
        // записывается в кэш профиля, чтобы undo и альбом попадали в кэш напрямую.
        // is written into the profile cache so that undo and the album hit the cache directly.
        const liveByCv = new Map(); // canvas -> [{style, pts, cum, total, facs, at}]; до 30 штрихов и 12 canvas | canvas -> [{style, pts, cum, total, facs, at}]; up to 30 strokes and 12 canvases
        function segPolyline(segs) {
            const pts = [];
            if (!segs.length) return pts;
            pts.push(segs[0].from);
            for (const s of segs) {
                if (s.op === 'L') pts.push([s.args[0], s.args[1]]);
                else if (s.op === 'Q') pts.push([s.args[2], s.args[3]]);
                else if (s.op === 'C') pts.push([s.args[4], s.args[5]]);
                else pts.push(s.from); // Z - замыкание (для сопоставления формы достаточно) | Z - closing (enough for shape comparison)
            }
            return pts;
        }
        function cumLen(pts) {
            const c = [0];
            for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
            return c;
        }
        function pointAt(pts, cum, t) {
            if (t <= 0) return pts[0];
            for (let i = 1; i < pts.length; i++) {
                if (cum[i] >= t) {
                    const d = cum[i] - cum[i - 1] || 1e-9, k = (t - cum[i - 1]) / d;
                    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
                }
            }
            return pts[pts.length - 1];
        }
        function storeLive(ctx, segs, factors) {
            try {
                const cv = ctx.canvas; if (!cv) return;
                const tw = cv.width || 1, th = cv.height || 1;
                const pts = segPolyline(segs).map(p => [p[0] / tw, p[1] / th]);
                if (pts.length < 2) return;
                const cum = cumLen(pts);
                const rec = { style: String(ctx.strokeStyle), pts, cum, total: cum[cum.length - 1], facs: factors.slice(), at: Date.now(), w: tw, h: th };
                let list = liveByCv.get(cv);
                if (!list) { list = []; liveByCv.set(cv, list); if (liveByCv.size > 12) liveByCv.delete(liveByCv.keys().next().value); }
                const last = list[list.length - 1];
                // тот же штрих - новый кадр живого рендера (замена), новый штрих - добавление
                // the same stroke - a new frame of the live render (a replacement), a new stroke - an addition
                if (last && Math.abs(last.pts[0][0] - pts[0][0]) < 0.003 && Math.abs(last.pts[0][1] - pts[0][1]) < 0.003) list[list.length - 1] = rec;
                else { list.push(rec); if (list.length > 30) list.shift(); }
            } catch (e) { /* ignore */ }
        }
        // Живой путь как ПРЕФИКС финального по длине дуги (финал может быть сглажен и иметь «хвост»)
        // The live path as a PREFIX of the final one by arc length (the final one may be smoothed and have a "tail")
        function matchLive(ctx, segs) {
            try {
                if (!segs.length) return null;
                const cv = ctx.canvas; if (!cv) return null;
                const tw = cv.width || 1, th = cv.height || 1;
                const fp = segPolyline(segs).map(p => [p[0] / tw, p[1] / th]);
                if (fp.length < 2) return null;
                const fc = cumLen(fp);
                const fTotal = fc[fc.length - 1];
                const style = String(ctx.strokeStyle);
                const now = Date.now();
                for (const [cvs, list] of liveByCv) {
                    for (let ri = list.length - 1; ri >= 0; ri--) {
                        const r = list[ri];
                        if (r.style !== style) continue;
                        if (now - r.at > 60000) { list.splice(ri, 1); continue; } // старьё чистим на ходу | old data is cleaned on the fly
                        if (!(r.total > 0)) continue;
                        const cmpLen = Math.min(r.total, fTotal);
                        if (cmpLen < r.total * 0.5) continue; // финал сильно короче живого - не тот штрих | the final is much shorter than the live stroke - a different stroke
                        const S = 24;
                        let maxDev = 0;
                        for (let i = 0; i <= S; i++) {
                            const t = cmpLen * i / S;
                            const a = pointAt(fp, fc, t), b = pointAt(r.pts, r.cum, t);
                            const d = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
                            if (d > maxDev) maxDev = d;
                        }
                        if (maxDev < 0.02) return r; // форма совпала (допуск 2% холста) | the shape matched (tolerance 2% of the canvas)
                    }
                }
            } catch (e) { /* ignore */ }
            return null;
        }
        // Множитель живого штриха на длине t (интерполяция по сегментам); за концом - последний множитель
        // The live stroke's multiplier at length t (interpolation over segments); beyond the end - the last multiplier
        function factorAt(r, t) {
            const c = r.cum;
            if (t <= 0) return r.facs[0] || 1;
            for (let i = 1; i < c.length; i++) {
                if (c[i] >= t) {
                    const k = (t - c[i - 1]) / ((c[i] - c[i - 1]) || 1e-9);
                    return r.facs[i - 1] + ((r.facs[i] || r.facs[i - 1]) - r.facs[i - 1]) * k;
                }
            }
            return r.facs[r.facs.length - 1] || 1;
        }
        // Профиль живого штриха, перенесённый на ФИНАЛЬНУЮ геометрию по длине дуги
        // The live stroke's profile transferred onto the FINAL geometry by arc length
        function factorsForLive(r, segs, cv) {
            const tw = cv.width || 1, th = cv.height || 1;
            const fc = cumLen(segPolyline(segs).map(p => [p[0] / tw, p[1] / th]));
            const out = [];
            for (let i = 0; i < segs.length; i++) out.push(factorAt(r, (fc[i] + fc[i + 1]) / 2));
            return out;
        }

        // --------- хранение ----------
        // --------- storage ----------
        function sanitize(raw) {
            const o = clone(DEF);
            if (!raw || typeof raw !== 'object') return o;
            const c = raw.cursor && typeof raw.cursor === 'object' ? raw.cursor : {};
            if (MODES.includes(c.mode)) o.cursor.mode = c.mode;
            if (typeof c.color === 'string' && /^#[0-9a-f]{6}$/i.test(c.color)) o.cursor.color = c.color.toLowerCase();
            o.cursor.width = Math.round(num(c.width, 1, 12, 2));
            if (typeof c.imageData === 'string' && c.imageData.length <= IMG_PERSIST_MAX * 1.4 && IMG_DATA_RE.test(c.imageData)) o.cursor.imageData = c.imageData;
            o.thickness = Math.round(num(raw.thickness, 1, 200, 100));
            o.pressure = Math.round(num(raw.pressure, 0, 100, 0));
            return o;
        }
        function load() {
            try {
                const raw = typeof GM_getValue === 'function' ? GM_getValue(KEY, null) : localStorage.getItem(KEY);
                cfg = sanitize(raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null);
            } catch (e) { cfg = clone(DEF); }
        }
        function saveNow() {
            try {
                const raw = JSON.stringify(cfg);
                if (typeof GM_setValue === 'function') GM_setValue(KEY, raw); else localStorage.setItem(KEY, raw);
                uiSaveDone('brush', true);
            } catch (e) { uiSaveDone('brush', false); }
        }
        const save = () => { clearTimeout(saveT); uiSavePending('brush'); saveT = setTimeout(saveNow, 300); };
        const fmt = v => (Math.round(v * 100) / 100).toString();

        // --------- координаты: НЕИСПРАВЛЕННЫЕ ----------
        // --------- coordinates: UNCORRECTED ----------
        const rawDesc = (() => {
            try {
                const x = Object.getOwnPropertyDescriptor(MouseEvent.prototype, 'clientX');
                const y = Object.getOwnPropertyDescriptor(MouseEvent.prototype, 'clientY');
                return x && x.get && y && y.get ? { x: x.get, y: y.get } : null;
            } catch (e) { return null; }
        })();
        function xy(e) {
            if (rawDesc) { try { return [rawDesc.x.call(e), rawDesc.y.call(e)]; } catch (err) { /* запасной вариант */ } }
            return [e.clientX, e.clientY];
        }

        // --------- измерение кружка игры ----------
        // --------- measuring the game's circle ----------
        function measureDiameter(cx, cy) {
            const cv = getCursorCanvas();
            if (!cv) return 0;
            const r = cv.getBoundingClientRect();
            if (!r.width || !r.height || !cv.width || !cv.height) return 0;
            const x = (cx - r.left) * cv.width / r.width, y = (cy - r.top) * cv.height / r.height;
            const half = 140;
            const x0 = Math.max(0, Math.floor(x - half)), y0 = Math.max(0, Math.floor(y - half));
            const x1 = Math.min(cv.width, Math.ceil(x + half)), y1 = Math.min(cv.height, Math.ceil(y + half));
            const w = x1 - x0, hh = y1 - y0;
            if (w < 2 || hh < 2) return 0;
            let data;
            try {
                const ctx = cv.getContext('2d');
                if (!ctx) return 0;
                data = ctx.getImageData(x0, y0, w, hh).data;
            } catch (e) { return 0; }
            let minX = w, maxX = -1, minY = hh, maxY = -1;
            for (let yy = 0; yy < hh; yy++) {
                for (let xx = 0; xx < w; xx++) {
                    if (data[(yy * w + xx) * 4 + 3] > 24) {
                        if (xx < minX) minX = xx;
                        if (xx > maxX) maxX = xx;
                        if (yy < minY) minY = yy;
                        if (yy > maxY) maxY = yy;
                    }
                }
            }
            if (maxX < 0) return 0;
            const bw = maxX - minX + 1, bh = maxY - minY + 1;
            if (bw >= w - 1 || bh >= hh - 1) return 0; // упёрлись в область чтения - это не кружок кисти | we hit the reading area - this is not the brush circle
            return Math.max(bw, bh);
        }

        // --------- перехват рисования: тонкая кисть и нажим ----------
        // --------- the drawing hook: thin brush and pressure ----------
        // кроме canvas рисования (.drawingContainer) учитываются другие canvas области холста (.draw .core):
        // besides the drawing canvas (.drawingContainer) the other canvas areas of the canvas (.draw .core) are accounted for:
        // игра может рисовать текущий штрих на вспомогательном слое и переносить его на рисунок после.
        // the game may draw the current stroke on an auxiliary layer and transfer it to the drawing afterwards.
        // На вспомогательных canvas линии меняются только пока идёт штрих (кнопка нажата), чтобы не трогать
        // On auxiliary canvases lines change only while a stroke is in progress (the button is pressed), so as not to touch
        // кружок курсора при наведении.
        // the cursor circle on hover.
        const drawKind = (() => {
            const known = new WeakMap();
            return c => {
                if (!c || !c.closest) return null;
                if (known.has(c)) return known.get(c);
                const k = c.closest(DRAW_BOX) ? 'main' : (c.closest('.draw .core') ? 'aux' : null);
                if (k) known.set(c, k);
                return k;
            };
        })();
        const gesture = () => { try { return PressureSettings.gestureActive(); } catch (e) { return false; } };
        // кнопка нажата прямо сейчас. После отпускания (до 250мс) gesture ещё true - это окно
        // the button is pressed right now. After release (up to 250ms) gesture is still true - that is the window
        // финального переноса штриха на основной холст, кэш профиля там нужен, поэтому проверяем isDown.
        // of the final transfer of the stroke to the main canvas; the profile cache is needed there, so we check isDown.
        const penDown = () => { try { return PressureSettings.isDown(); } catch (e) { return false; } };
        // Нажим: модель вынесена в PressureSettings (кривая, минимум/максимум, сглаживание). Значение нажима
        // Pressure: the model is moved out into PressureSettings (the curve, minimum/maximum, smoothing). The pressure value
        // PressureSettings читает сам из passive-слушателей; при выключенном нажиме коэффициент равен 1.
        // PressureSettings reads itself from passive listeners; with pressure off the factor equals 1.
        function pressureFactor() {
            try { return PressureSettings.widthFactor(); } catch (e) { return 1; }
        }
        function widthFactor(ctx) {
            if (ctx.globalCompositeOperation === 'destination-out') return 1; // ластик не трогаем | we do not touch the eraser
            return (cfg.thickness / 100) * pressureFactor();
        }
        // влияние нажима на прозрачность (globalAlpha только на время вызова)
        // the effect of pressure on opacity (globalAlpha only for the duration of the call)
        function alphaFactor(ctx) {
            if (ctx.globalCompositeOperation === 'destination-out') return 1;
            try { return PressureSettings.alphaFactor(); } catch (e) { return 1; }
        }
        const alphaWanted = () => { try { return PressureSettings.alphaWanted(); } catch (e) { return false; } };
        const pressureWanted = () => { try { return PressureSettings.pressureWanted(); } catch (e) { return cfg.pressure > 0; } };
        const hookWanted = () => cfg.thickness !== 100 || pressureWanted() || alphaWanted();
        // разбор записанного пути на сегменты [{from:[x,y], op, args, f}]
        // parsing the recorded path into segments [{from:[x,y], op, args, f}]
        function recSegments(entry) {
            const segs = [];
            let cur = null, start = null;
            for (const c of entry.cmds) {
                if (c.op === 'M') { cur = [c.x, c.y]; if (start === null) start = cur; }
                else if (c.op === 'L') { if (cur) segs.push({ from: cur, op: 'L', args: [c.x, c.y], f: c.f }); cur = [c.x, c.y]; }
                else if (c.op === 'Q') { if (cur) segs.push({ from: cur, op: 'Q', args: [c.x1, c.y1, c.x2, c.y2], f: c.f }); cur = [c.x2, c.y2]; }
                else if (c.op === 'C') { if (cur) segs.push({ from: cur, op: 'C', args: [c.x1, c.y1, c.x2, c.y2, c.x3, c.y3], f: c.f }); cur = [c.x3, c.y3]; }
                else if (c.op === 'Z') { if (cur && start) segs.push({ from: cur, op: 'Z', f: c.f }); cur = start; }
            }
            return segs;
        }
        // локальная ГЛАДКОСТЬ. Сегмент штриха раньше рисовался ОДНОЙ постоянной
        // local SMOOTHNESS. A stroke segment used to be drawn with ONE constant
        // lineWidth — на длинных сегментах оставались ступеньки. Теперь сегмент делится на
        // lineWidth - long segments kept their stair-steps. Now a segment is divided into
        // 3-4 точных куска (Де Кастельжо, геометрия кривых не искажается), а толщина кусков
        // 3-4 precise pieces (De Casteljau, the curve geometry is not distorted), and the thickness of the pieces
        // линейно интерполируется между множителем предыдущей точки (f0) и текущей (f1).
        // is linearly interpolated between the previous point's multiplier (f0) and the current one (f1).
        // meth — безопасные методы контекста (оригиналы рекордера) или null: брать методы ctx.
        // meth - safe context methods (the recorder's originals) or null: take the ctx methods.
        function smoothStrokeSeg(ctx2, meth, oStroke, s, f0, f1, baseLw) {
            const B = meth ? meth.b : ctx2.beginPath, M = meth ? meth.m : ctx2.moveTo,
                L = meth ? meth.l : ctx2.lineTo, Q = meth ? meth.q : ctx2.quadraticCurveTo,
                BZ = meth ? meth.bz : ctx2.bezierCurveTo, CL = meth ? meth.cl : ctx2.closePath;
            const piece = (x0, y0, op, a, lw) => {
                B.apply(ctx2, []); M.apply(ctx2, [x0, y0]);
                if (op === 'L') L.apply(ctx2, [a[0], a[1]]);
                else if (op === 'Q') Q.apply(ctx2, [a[0], a[1], a[2], a[3]]);
                else if (op === 'C') BZ.apply(ctx2, [a[0], a[1], a[2], a[3], a[4], a[5]]);
                else if (op === 'Z') CL.apply(ctx2, []);
                ctx2.lineWidth = lw; oStroke.apply(ctx2, []);
            };
            if (s.op !== 'L' && s.op !== 'Q' && s.op !== 'C') { // Z и прочее — целиком, как раньше | Z and the rest - entirely, as before
                piece(s.from[0], s.from[1], s.op, s.args, Math.max(0.05, baseLw * f1));
                return;
            }
            const N = s.op === 'L' ? 3 : 4;
            const lwMid = t => Math.max(0.05, baseLw * (f0 + (f1 - f0) * t));
            const lp = (a, b, t) => a + (b - a) * t;
            let px = s.from[0], py = s.from[1];
            const x0 = s.from[0], y0 = s.from[1];
            if (s.op === 'L') {
                for (let j = 1; j <= N; j++) {
                    const t = j / N, cx = lp(x0, s.args[0], t), cy = lp(y0, s.args[1], t);
                    piece(px, py, 'L', [cx, cy], lwMid(t - 0.5 / N));
                    px = cx; py = cy;
                }
                return;
            }
            if (s.op === 'Q') {
                let p1x = s.args[0], p1y = s.args[1], p2x = s.args[2], p2y = s.args[3];
                for (let j = 1; j <= N; j++) {
                    const t = j / N;
                    const ax = lp(px, p1x, t), ay = lp(py, p1y, t);
                    const bx = lp(p1x, p2x, t), by = lp(p1y, p2y, t);
                    const mx = lp(ax, bx, t), my = lp(ay, by, t);
                    piece(px, py, 'Q', [ax, ay, mx, my], lwMid(t - 0.5 / N));
                    px = mx; py = my; p1x = bx; p1y = by;
                }
                return;
            }
            let p1x = s.args[0], p1y = s.args[1], p2x = s.args[2], p2y = s.args[3], p3x = s.args[4], p3y = s.args[5];
            for (let j = 1; j <= N; j++) {
                const t = j / N;
                const ax = lp(px, p1x, t), ay = lp(py, p1y, t);
                const bx = lp(p1x, p2x, t), by = lp(p1y, p2y, t);
                const cx = lp(p2x, p3x, t), cy = lp(p2y, p3y, t);
                const dx = lp(ax, bx, t), dy = lp(ay, by, t);
                const ex = lp(bx, cx, t), ey = lp(by, cy, t);
                const mx = lp(dx, ex, t), my = lp(dy, ey, t);
                piece(px, py, 'C', [ax, ay, dx, dy, mx, my], lwMid(t - 0.5 / N));
                px = mx; py = my; p1x = ex; p1y = ey; p2x = cx; p2y = cy;
            }
        }
        // воспроизведение сегментов с индивидуальной lineWidth.
        // replaying segments with an individual lineWidth.
        // Круглые lineCap/lineJoin сохраняются в контексте игры; стыки сегментов совпадают (конец предыдущего
        // Round lineCap/lineJoin are preserved in the game's context; segment joints coincide (the end of the previous
        // = начало следующего), разрывов нет. При globalAlpha < 1 сегменты рисуются в offscreen-слой с alpha 1
        // = the start of the next one), no gaps. With globalAlpha < 1 segments are drawn into an offscreen layer with alpha 1
        // и накладываются одним drawImage — иначе круглые стыки темнели бы двойным наложением полупрозрачности.
        // and applied with a single drawImage - otherwise round joints would darken from the double overlap of translucency.
        function replaySegments(ctx, oStroke, segs, key, baseLw) {
            const off = ctx.globalAlpha < 1;
            let tctx = ctx, tf = null;
            if (off && typeof ctx.getTransform === 'function') {
                const cv = document.createElement('canvas');
                cv.width = ctx.canvas.width; cv.height = ctx.canvas.height;
                if (!cv.width || !cv.height) { tf = null; }
                else { tf = cv.getContext('2d'); tf.setTransform(ctx.getTransform()); tctx = tf; }
                if (tf) { tf.globalAlpha = 1; tf.strokeStyle = ctx.strokeStyle; tf.lineCap = ctx.lineCap; tf.lineJoin = ctx.lineJoin; tf.miterLimit = ctx.miterLimit; }
                else off = false;
            }
            let prevF = segs.length ? segs[0].f : 1;
            for (const s of segs) {
                smoothStrokeSeg(tctx, null, oStroke, s, prevF, s.f, baseLw);
                prevF = s.f;
            }
            if (tf) {
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.drawImage(tf.canvas, 0, 0); // globalAlpha контекста остался исходным — один уровень прозрачности | the context globalAlpha stayed original - one level of transparency
                ctx.restore();
            }
            hook.seg++;
            segDiag.last = Date.now();
            const ws = segs.map(s => Math.max(0.05, baseLw * s.f));
            segDiag.min = ws.reduce((a, b) => Math.min(a, b), Infinity);
            segDiag.max = ws.reduce((a, b) => Math.max(a, b), 0);
        }
        // применить массив множителей к сегментам (используется и для холста рисования, и для
        // apply the multiplier array to segments (used both for the drawing canvas and for
        // воспроизведения из кэша на других canvas). Оригиналы o* берём из hook - обёртки рекордера
        // replaying from the cache on other canvases). The originals o* are taken from hook - the recorder's wrappers
        // не должны записывать повторные команды в путь.
        // must not record repeated commands into the path.
        function applyFactors(ctx, oStroke, segs, factors, lw) {
            if (ctx.globalAlpha >= 1) {
                const oB = hook.oBegin, oM = hook.oMoveTo, oL = hook.oLineTo, oQ = hook.oQuad, oBz = hook.oBezier, oC = hook.oClose;
                const saveLw = ctx.lineWidth;
                try {
                    for (let i = 0; i < segs.length; i++) {
                        const f0 = i > 0 ? factors[i - 1] : factors[0];
                        smoothStrokeSeg(ctx, { b: oB, m: oM, l: oL, q: oQ, bz: oBz, cl: oC }, oStroke, segs[i], f0, factors[i], lw);
                    }
                } finally { ctx.lineWidth = saveLw; }
                hook.seg++;
                segDiag.last = Date.now();
                const ws = factors.map(f => Math.max(0.05, lw * f));
                segDiag.min = ws.reduce((a, b) => Math.min(a, b), Infinity);
                segDiag.max = ws.reduce((a, b) => Math.max(a, b), 0);
            } else {
                replaySegments(ctx, oStroke, segs.map((s, i) => ({ from: s.from, op: s.op, args: s.args, f: factors[i] })), '', lw);
            }
        }
        function installHook() {
            if (hook.on) return true;
            try {
                const PW = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
                const proto = PW.CanvasRenderingContext2D && PW.CanvasRenderingContext2D.prototype;
                if (!proto || typeof proto.stroke !== 'function') throw new Error('CanvasRenderingContext2D недоступен');
                // Обёртки уже стоят (removeHook не смог снять их из-за чужого wrapper’а):
                // The wrappers are already in place (removeHook failed to remove them because of a foreign wrapper):
                // просто включаем их обратно, не создавая вторую копию.
                // we simply turn them back on without creating a second copy.
                if (hook.stillInstalled && hook.proto === proto && hook.wStroke) {
                    hook.stillInstalled = false;
                    hook.on = true;
                    return true;
                }
                const oStroke = proto.stroke, oArc = proto.arc, oFill = proto.fill,
                    oBegin = proto.beginPath, oMoveTo = proto.moveTo, oLineTo = proto.lineTo,
                    oQuad = proto.quadraticCurveTo, oBezier = proto.bezierCurveTo, oClose = proto.closePath,
                    oRect = proto.rect, oEllipse = proto.ellipse, oArcTo = proto.arcTo;
                // рекордер path-команд — множитель ширины фиксируется В МОМЕНТ команды.
                // path-command recorder - the width multiplier is fixed AT THE MOMENT of the command.
                // arc/rect/ellipse/arcTo помечают путь непригодным → откат к прежнему единому поведению.
                // arc/rect/ellipse/arcTo mark the path unsuitable → fall back to the previous uniform behavior.
                const recCmd = function (ctx, c) {
                    if (!hook.on) return;
                    const e = recEntry(ctx);
                    if (!e.usable) return;
                    const f = widthFactor(ctx);
                    const coordKey = c.op + ':' + r1(c.x) + ',' + r1(c.y);
                    // segKey - с эпохой (только для хранилища множителей сегментов);
                    // segKey - with the epoch (only for the segment multiplier store);
                    // entry.sig - без эпохи (для кэша профиля: должен совпадать при повторной
                    // entry.sig - without the epoch (for the profile cache: it must match on a repeated
                    // отрисовке из данных игры - undo/redo, альбом, книга).
                    // rendering from the game's data - undo/redo, album, book).
                    const segKey = segEpoch + ':' + coordKey;
                    c.f = segFactor(ctx, segKey, f);
                    e.cmds.push(c);
                    e.sig += (e.sig ? '|' : '') + coordKey;
                };
                const wBegin = function () {
                    if (!hook.on) return oBegin.apply(this, arguments);
                    const r = oBegin.apply(this, arguments);
                    const e = recEntry(this);
                    e.cmds.length = 0; e.usable = true; e.sig = ''; e.lw = this.lineWidth;
                    // хранилище НЕ очищаем - финальная перерисовка готового штриха (сразу после
                    // the store is NOT cleared - the final re-rendering of the finished stroke (right after
                    // pointerup, gesture уже false) должна найти свои множители по тем же координатам.
                    // pointerup, gesture already false) must find its multipliers by the same coordinates.
                    // Штрихи разделены segEpoch, старые записи новому не мешают; размер ограничиваем LRU.
                    // Strokes are separated by segEpoch, old records do not interfere with the new one; the size is limited by LRU.
                    const m = segStore.get(this);
                    if (m && m.size > 40000) { while (m.size > 30000) m.delete(m.keys().next().value); }
                    return r;
                };
                const wMoveTo = function (x, y) { const r = oMoveTo.apply(this, arguments); try { recCmd(this, { op: 'M', x, y }); } catch (e) { } return r; };
                const wLineTo = function (x, y) { const r = oLineTo.apply(this, arguments); try { recCmd(this, { op: 'L', x, y }); } catch (e) { } return r; };
                const wQuad = function (x1, y1, x2, y2) { const r = oQuad.apply(this, arguments); try { recCmd(this, { op: 'Q', x1, y1, x2, y2, get x() { return x2; }, get y() { return y2; } }); } catch (e) { } return r; };
                const wBezier = function (x1, y1, x2, y2, x3, y3) { const r = oBezier.apply(this, arguments); try { recCmd(this, { op: 'C', x1, y1, x2, y2, x3, y3, get x() { return x3; }, get y() { return y3; } }); } catch (e) { } return r; };
                const wClose = function () { const r = oClose.apply(this, arguments); try { recCmd(this, { op: 'Z' }); } catch (e) { } return r; };
                const wRect = function () { if (!hook.on) return oRect.apply(this, arguments); markUnusable(this); return oRect.apply(this, arguments); };
                const wEllipse = function () { if (!hook.on) return oEllipse.apply(this, arguments); markUnusable(this); return oEllipse.apply(this, arguments); };
                const wArcTo = function () { if (!hook.on) return oArcTo.apply(this, arguments); markUnusable(this); return oArcTo.apply(this, arguments); };
                const wStroke = function () {
                    if (!hook.on) return oStroke.apply(this, arguments);
                    const kind = drawKind(this.canvas);
                    if (!kind) {
                        // canvas ВНЕ области рисования (альбом/книга в конце раунда, повтор истории):
                        // A canvas OUTSIDE the drawing area (album/book at the end of a round, history replay):
                        // игра перерисовывает штрихи из данных со стандартной толщиной. Вмешиваемся ТОЛЬКО
                        // the game re-renders strokes from the data with the standard thickness. We interfere ONLY
                        // при точном попадании в кэш профиля нажима (нормализованная форма + цвет) -
                        // on an exact hit in the pressure profile cache (normalized shape + color) -
                        // посторонние canvas игры не затрагиваются, их stroke проходит без изменений.
                        // foreign game canvases are not touched, their stroke passes unchanged.
                        if (!(pressureWanted() && !penDown())) return oStroke.apply(this, arguments);
                        const entry = rec.get(this);
                        if (!entry || !entry.usable || !entry.cmds.length) return oStroke.apply(this, arguments);
                        const segs = recSegments(entry);
                        if (!segs.length) return oStroke.apply(this, arguments);
                        const nk = normKey(this, entry);
                        let factors = (nk && profileCache.get(nk)) || null;
                        if (factors && factors.length !== segs.length) factors = null;
                        if (!factors) {
                            const key = r1(this.lineWidth) + '|' + String(this.strokeStyle) + '|' + entry.sig;
                            const cached = profileCache.get(key);
                            if (cached && cached.length === segs.length) factors = cached;
                            if (!factors) {
                                // живой штрих той же формы и цвета (альбом перерисовывает
                                // a live stroke of the same shape and color (the album re-renders
                                // сглаженной геометрией) - переносим профиль на неё и запоминаем канонический путь
                                // with smoothed geometry) - we transfer the profile onto it and remember the canonical path
                                const r = matchLive(this, segs);
                                if (r) {
                                    const mf = factorsForLive(r, segs, this.canvas);
                                    profilePutPair(key, normKey(this, entry), mf.slice());
                                    hook.replay++; hook.cacheHit++;
                                    applyFactors(this, oStroke, segs, mf, this.lineWidth);
                                    return;
                                }
                            }
                        }
                        if (!factors) return oStroke.apply(this, arguments);
                        hook.replay++;
                        applyFactors(this, oStroke, segs, factors, this.lineWidth);
                        return;
                    }
                    if (kind === 'aux' && !gesture()) return oStroke.apply(this, arguments);
                    if (kind === 'main') hook.seen++; else hook.seenAux++;
                    const entry = rec.get(this);
                    const lw = this.lineWidth, ga = this.globalAlpha;
                    // пытаемся воспроизвести записанный путь по сегментам
                    // we try to replay the recorded path from segments
                    if (entry && entry.usable && entry.cmds.length) {
                        const segs = recSegments(entry);
                        if (segs.length > 0) {
                            const key = r1(lw) + '|' + String(this.strokeStyle) + '|' + entry.sig;
                            let factors = segs.map(s => s.f);
                            const uniform = factors.every(f => Math.abs(f - factors[0]) < 0.005);
                            if (uniform) {
                                // профиль нажима берём из кэша, когда кнопка НЕ нажата - это либо окно
                                // the pressure profile is taken from the cache when the button is NOT pressed - that is either the window
                                // после отпускания (финальный перенос штриха на основной холст), либо повторная
                                // after release (the final transfer of the stroke to the main canvas), or a re-render
                                // отрисовка игрой (undo/redo, новый раунд, альбом). Только при включённом нажиме.
                                // by the game (undo/redo, a new round, the album). Only with pressure enabled.
                                // Сначала точная сигнатура, затем нормализованная форма; если оба промахнулись -
                                // First the exact signature, then the normalized shape; if both miss -
                                // ищем сохранённый ЖИВОЙ штрих с теми же концами и цветом (финальный рендер
                                // we look for a saved LIVE stroke with the same ends and color (the final render
                                // канонической геометрией) и заменяем его живой геометрией с профилем.
                                // of the canonical geometry) and replace it with the live geometry plus the profile.
                                if (pressureWanted() && !penDown()) {
                                    let cached = profileCache.get(key);
                                    if (cached && cached.length !== segs.length) cached = null;
                                    if (!cached) { const nk = normKey(this, entry); if (nk) { cached = profileCache.get(nk); if (cached && cached.length !== segs.length) cached = null; if (cached) hook.normHit++; } }
                                    if (cached) { factors = cached; hook.cacheHit++; }
                                    else {
                                        const r = matchLive(this, segs);
                                        if (r) {
                                            // профиль живого штриха переносится на ФИНАЛЬНУЮ геометрию
                                            // the live stroke's profile is transferred onto the FINAL geometry
                                            // по длине дуги (сглаживание, «хвост» - последний множитель)
                                            // by arc length (smoothing, the "tail" - the last multiplier)
                                            const mf = factorsForLive(r, segs, this.canvas);
                                            profilePutPair(key, normKey(this, entry), mf.slice());
                                            hook.replay++; hook.cacheHit++;
                                            applyFactors(this, oStroke, segs, mf, lw);
                                            return;
                                        }
                                    }
                                }
                            } else {
                                profilePutPair(key, normKey(this, entry), factors.slice());
                                storeLive(this, segs, factors); // живой штрих - для финального рендера | the live stroke - for the final render
                            }
                            segDiag.kind = kind; segDiag.lw0 = lw;
                            try { segDiag.base = PressureSettings.widthFactor(); segDiag.press = PressureSettings.lastPressure ? PressureSettings.lastPressure() : 0; } catch (e) { }
                            // сегментный повтор нужен только когда множители РАЗНЫЕ; при равномерных
                            // segment replay is needed only when the multipliers DIFFER; with uniform ones
                            // (тонкая кисть без нажима, кэш не сработал) достаточно прежнего единого множителя
                            // (a thin brush without pressure, the cache missed) the previous single multiplier is enough
                            const nonUniform = factors.some((f, i) => i > 0 && Math.abs(f - factors[0]) > 0.005);
                            if (nonUniform) {
                                applyFactors(this, oStroke, segs, factors, lw);
                                return;
                            }
                        }
                    }
                    // откат: прежнее поведение (один множитель на весь путь).
                    // fallback: the previous behavior (one multiplier for the whole path).
                    // ВНЕ живого штриха (undo/повторная отрисовка) остаточное давление пера НЕ
                    // OUTSIDE the live stroke (undo/re-rendering) the pen's residual pressure is NOT
                    // применяется к целому штриху - только толщина. Иначе каждый повтор получал бы
                    // applied to the whole stroke - thickness only. Otherwise every replay would get
                    // случайную единую толщину от последнего значения давления.
                    // a random single thickness from the last pressure value.
                    const replaying = !gesture() && !penDown();
                    const f = replaying ? (cfg.thickness / 100) : widthFactor(this);
                    const a = replaying ? 1 : alphaFactor(this);
                    if (f === 1 && a === 1) return oStroke.apply(this, arguments);
                    hook.fallback++;
                    if (f !== 1) { this.lineWidth = Math.max(0.05, lw * f); hook.scaled++; }
                    if (a !== 1) this.globalAlpha = ga * a;
                    try { return oStroke.apply(this, arguments); } finally { this.lineWidth = lw; this.globalAlpha = ga; }
                };
                // «штампы» кисти заливаются fill: прозрачность от нажима применяем и к ним
                // the brush's "stamps" are filled with fill: the pressure opacity is applied to them too
                const wFill = function () {
                    if (!hook.on) return oFill.apply(this, arguments);
                    const kind = drawKind(this.canvas);
                    if (!kind || (kind === 'aux' && !gesture())) return oFill.apply(this, arguments);
                    if (gesture()) hook.fills++;
                    const a = alphaFactor(this);
                    if (a === 1) return oFill.apply(this, arguments);
                    const ga = this.globalAlpha;
                    this.globalAlpha = ga * a;
                    try { return oFill.apply(this, arguments); } finally { this.globalAlpha = ga; }
                };
                // «штампы» кисти: круг, диаметр которого равен ширине линии, - всегда; во время штриха - любой круг.
                // the brush's "stamps": a circle whose diameter equals the line width - always; during a stroke - any circle.
                // arc внутри пути (не штамп) делает путь непригодным для сегментного повтора - откат к единому множителю
                // an arc inside the path (not a stamp) makes the path unsuitable for segment replay - fall back to a single multiplier
                const wArc = function (x, y, r) {
                    if (!hook.on) return oArc.apply(this, arguments);
                    if (arguments.length >= 3) {
                        const kind = drawKind(this.canvas);
                        const stampExact = kind === 'main' && Math.abs(r * 2 - this.lineWidth) <= 0.75;
                        const stamp = kind && (stampExact || gesture());
                        // точное совпадение с шириной линии - штамп кисти; иначе arc может быть частью пути:
                        // an exact match with the line width - a brush stamp; otherwise an arc can be part of the path:
                        if (!stampExact) markUnusable(this);
                        if (stamp) {
                            const f = widthFactor(this);
                            if (f !== 1) {
                                const a = Array.prototype.slice.call(arguments);
                                a[2] = r * f;
                                if (kind === 'main') hook.seen++; else hook.seenAux++;
                                hook.scaled++;
                                return oArc.apply(this, a);
                            }
                        }
                    }
                    return oArc.apply(this, arguments);
                };
                proto.stroke = wStroke;
                proto.arc = wArc;
                if (typeof oFill === 'function') proto.fill = wFill;
                // рекордер path-команд (идемпотентно: снимаются в removeHook вместе с остальными)
                // path-command recorder (idempotent: removed in removeHook together with the others)
                if (typeof oBegin === 'function') { proto.beginPath = wBegin; proto.moveTo = wMoveTo; proto.lineTo = wLineTo; }
                if (typeof oQuad === 'function') proto.quadraticCurveTo = wQuad;
                if (typeof oBezier === 'function') proto.bezierCurveTo = wBezier;
                if (typeof oClose === 'function') proto.closePath = wClose;
                if (typeof oRect === 'function') proto.rect = wRect;
                if (typeof oEllipse === 'function') proto.ellipse = wEllipse;
                if (typeof oArcTo === 'function') proto.arcTo = wArcTo;
                Object.assign(hook, { on: true, proto, oStroke, oArc, oFill, oBegin, oMoveTo, oLineTo, oQuad, oBezier, oClose, oRect, oEllipse, oArcTo, wStroke, wArc, wFill, wBegin, wMoveTo, wLineTo, wQuad, wBezier, wClose, wRect, wEllipse, wArcTo, err: '' });
                return true;
            } catch (e) {
                hook.err = e && e.message ? e.message : 'ошибка';
                return false;
            }
        }
        function removeHook() {
            if (!hook.on) return;
            let left = false;
            const restoreOne = (m, w, o) => {
                if (!hook[w]) return;
                if (hook.proto[m] === hook[w]) hook.proto[m] = hook[o];
                else left = true; // поверх нашей обёртки стоит чужая — снять безопасно нельзя | someone else's wrapper sits on top of ours - it cannot be removed safely
            };
            try {
                restoreOne('stroke', 'wStroke', 'oStroke');
                restoreOne('arc', 'wArc', 'oArc');
                restoreOne('fill', 'wFill', 'oFill');
                // рекордер path-команд — восстанавливаем только наши обёртки
                // path-command recorder - we restore only our own wrappers
                const pairs = [['beginPath', 'wBegin', 'oBegin'], ['moveTo', 'wMoveTo', 'oMoveTo'], ['lineTo', 'wLineTo', 'oLineTo'],
                    ['quadraticCurveTo', 'wQuad', 'oQuad'], ['bezierCurveTo', 'wBezier', 'oBezier'], ['closePath', 'wClose', 'oClose'],
                    ['rect', 'wRect', 'oRect'], ['ellipse', 'wEllipse', 'oEllipse'], ['arcTo', 'wArcTo', 'oArcTo']];
                for (const [m, w, o] of pairs) restoreOne(m, w, o);
                profileCache.clear();
            } catch (e) { left = true; /* ignore */ }
            // Если снять все обёртки не удалось, оставляем их в цепочке, но выключаем:
            // If not all wrappers could be removed, we keep them in the chain but disable them:
            // каждая обёртка проверяет hook.on и проходит в оригинал. При повторном
            // each wrapper checks hook.on and passes through to the original. On re-enabling
            // включении не навешиваем вторую копию (это ломало цепочку GameProbe).
            // we do not attach a second copy (that broke the GameProbe chain).
            hook.stillInstalled = left;
            hook.on = false;
        }
        function syncHook() {
            if (hookWanted()) installHook(); else removeHook();
            // штрих определяется по pointer-событиям, которые читает модуль нажима
            // the stroke is identified by the pointer events the pressure module reads
            try { PressureSettings.need('brush', hook.on); } catch (e) { /* ignore */ }
            syncListeners();
            refreshStatus();
        }

        // --------- курсор ----------
        // --------- cursor ----------
        function ensureCursorEl() {
            let el = document.getElementById(CUR_ID);
            if (!el) {
                el = document.createElement('div');
                el.id = CUR_ID;
                el.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;margin:0;padding:0;pointer-events:none;z-index:2147483645;display:none';
                el.appendChild(document.createElement('div'));
                document.body.appendChild(el);
            }
            return el;
        }
        function buildShape(el, d) {
            const k = cfg.cursor;
            const key = [k.mode, k.color, k.width, Math.round(d * 10), imgSrc, imgSize].join('|');
            if (key === shapeKey) return;
            shapeKey = key;
            const box = el.firstChild;
            box.textContent = '';
            box.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0';
            const mk = s => { const n = document.createElement('div'); n.style.cssText = s; return n; };
            if (k.mode === 'circle' || k.mode === 'cross') {
                const D = Math.max(2, d);
                box.appendChild(mk('position:absolute;left:' + (-D / 2) + 'px;top:' + (-D / 2) + 'px;width:' + D + 'px;height:' + D +
                    'px;box-sizing:border-box;border:' + k.width + 'px solid ' + k.color + ';border-radius:50%'));
                if (k.mode === 'cross') {
                    const L = Math.max(8, Math.min(D * 0.6, 18));
                    box.appendChild(mk('position:absolute;left:' + (-L / 2) + 'px;top:' + (-k.width / 2) + 'px;width:' + L + 'px;height:' + k.width + 'px;background:' + k.color));
                    box.appendChild(mk('position:absolute;left:' + (-k.width / 2) + 'px;top:' + (-L / 2) + 'px;width:' + k.width + 'px;height:' + L + 'px;background:' + k.color));
                }
            } else if (k.mode === 'dot') {
                const D = Math.max(3, k.width * 3);
                box.appendChild(mk('position:absolute;left:' + (-D / 2) + 'px;top:' + (-D / 2) + 'px;width:' + D + 'px;height:' + D + 'px;border-radius:50%;background:' + k.color));
            } else if (k.mode === 'image' && imgSrc) {
                const img = document.createElement('img');
                img.alt = '';
                img.draggable = false;
                img.src = imgSrc;
                img.style.cssText = 'position:absolute;left:' + (-imgSize / 2) + 'px;top:' + (-imgSize / 2) + 'px;width:' + imgSize + 'px;height:' + imgSize + 'px;object-fit:contain;pointer-events:none';
                box.appendChild(img);
            }
        }
        function setGameHidden(on) {
            document.documentElement.classList.toggle('gpe-brush-hidecursor', on);
            const cv = on ? getCursorCanvas() : null; // кружок игры скрываем, пока виден свой курсор | we hide the game cursor circle while our cursor is visible
            if (hiddenCanvas && hiddenCanvas !== cv) { hiddenCanvas.style.visibility = ''; hiddenCanvas = null; }
            if (cv) { cv.style.visibility = 'hidden'; hiddenCanvas = cv; }
        }
        function hideCursor() {
            const el = document.getElementById(CUR_ID);
            if (el) el.style.display = 'none';
            setGameHidden(false);
        }
        function update() {
            raf = 0;
            const k = cfg.cursor;
            const curCv = getCursorCanvas();
            const base = curCv || document.querySelector(DRAW_SEL);
            const rect = base ? base.getBoundingClientRect() : null;
            const inside = !!(rect && rect.width > 1 && haveXY && px >= rect.left && px <= rect.right && py >= rect.top && py <= rect.bottom);
            if (inside && moved && (k.mode === 'circle' || k.mode === 'cross' || hook.on)) {
                const now = performance.now();
                if (now - lastMeasure >= 200) {
                    lastMeasure = now;
                    moved = false;
                    const d = measureDiameter(px, py);
                    if (d > 0) { meas.d = d; meas.at = now; refreshReadout(); }
                } else {
                    clearTimeout(trailT);
                    trailT = setTimeout(schedule, 220);
                }
            }
            const show = k.mode !== 'normal' && !editMode && inside && (k.mode !== 'image' || !!imgSrc);
            if (!show) { hideCursor(); return; }
            const el = ensureCursorEl();
            const scaleCss = curCv && curCv.width ? rect.width / curCv.width : 1;
            // круг показывает фактическую кисть: кисть игры × выбранная толщина
            // the circle shows the actual brush: the game's brush × the chosen thickness
            const d = meas.d > 0 ? Math.max(2, meas.d * scaleCss * (cfg.thickness / 100)) : 24 * (cfg.thickness / 100);
            buildShape(el, d);
            el.style.transform = 'translate(' + px + 'px,' + py + 'px)';
            el.style.display = 'block';
            setGameHidden(true);
        }
        function schedule() { if (!raf) raf = requestAnimationFrame(update); }

        // --------- слушатели страницы: только читают, события не меняют ----------
        // --------- page listeners: they only read, events are not changed ----------
        const inCanvas = (x, y) => {
            const base = getCursorCanvas() || document.querySelector(DRAW_SEL);
            if (!base) return false;
            const r = base.getBoundingClientRect();
            return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        };
        function onMove(e) {
            const p = xy(e); px = p[0]; py = p[1]; haveXY = true; moved = true;
            if (e.pointerType) { pType = e.pointerType; if (e.pressure != null) pPress = e.pressure; }
            schedule();
        }
        function onDown(e) {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            segEpoch++; // новый штрих - новые ключи сегментов (до первых команд пути игры) | a new stroke - new segment keys (before the first path commands of the game)
            const p = xy(e); px = p[0]; py = p[1]; haveXY = true;
            if (e.pointerType) { pType = e.pointerType; if (e.pressure != null) pPress = e.pressure; }
            downIn = inCanvas(px, py);
            schedule();
        }
        function onUp() {
            if (downIn) {
                downIn = false;
                // толщина/нажим включены, а игра не сделала ни одного вызова рисования на нашем canvas - значит перехват не работает
                // thickness/pressure are enabled but the game made not a single drawing call on our canvas - the hook is not working
                setTimeout(refreshStatus, 60);
            }
            schedule();
        }
        function onOut(e) { if (!e.relatedTarget) { haveXY = false; downIn = false; schedule(); } }
        function on(t, ty, fn, o) { t.addEventListener(ty, fn, o); handlers.push([t, ty, fn, o]); }
        function detach() {
            while (handlers.length) { const h2 = handlers.pop(); h2[0].removeEventListener(h2[1], h2[2], h2[3]); }
            cancelAnimationFrame(raf); raf = 0;
            clearTimeout(trailT);
        }
        function syncListeners() {
            const need = cfg.cursor.mode !== 'normal' || hook.on;
            if (need && !handlers.length) {
                const o = { capture: true, passive: true };
                on(window, 'pointermove', onMove, o);
                on(window, 'mousemove', onMove, o);
                on(window, 'pointerdown', onDown, o);
                on(window, 'pointerup', onUp, o);
                on(window, 'pointercancel', onUp, o);
                on(window, 'blur', onUp, o);
                on(document, 'mouseout', onOut, o);
            } else if (!need && handlers.length) {
                detach();
                hideCursor();
            }
        }

        // --------- картинка курсора ----------
        // --------- cursor picture ----------
        function revokeBlob() { if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = ''; } }
        function useImage(src, isBlob, size) {
            if (isBlob) { if (blobUrl && blobUrl !== src) URL.revokeObjectURL(blobUrl); blobUrl = src; } else revokeBlob();
            imgSrc = src;
            imgSize = size > 0 ? Math.min(64, Math.max(8, size)) : 32;
            shapeKey = '';
            refreshImage();
            schedule();
        }
        function probe(src) {
            return new Promise(resolve => {
                const im = new Image();
                im.onload = () => resolve(Math.max(im.naturalWidth || 0, im.naturalHeight || 0) || 32);
                im.onerror = () => resolve(0);
                im.src = src;
            });
        }
        function dataUrlToBlob(du) {
            const m = /^data:([^;]+);base64,(.*)$/.exec(du);
            if (!m) return null;
            const bin = atob(m[2]);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return new Blob([bytes], { type: m[1] });
        }
        async function loadFile(file) {
            const okType = file && (/^image\/(png|svg\+xml)$/i.test(file.type) || /\.(png|svg)$/i.test(file.name || ''));
            if (!okType) { say('Нужен PNG или SVG.'); return; }
            if (file.size > IMG_FILE_MAX) { say('Файл больше 512 КБ.'); return; }
            const url = URL.createObjectURL(file); // безопасный предпросмотр; SVG показывается как картинка и не исполняется | a safe preview; the SVG is shown as a picture and is not executed
            const size = await probe(url);
            if (!size) { URL.revokeObjectURL(url); say('Не удалось открыть картинку.'); return; }
            useImage(url, true, size);
            cfg.cursor.imageData = '';
            if (cfg.cursor.mode !== 'image') { cfg.cursor.mode = 'image'; syncListeners(); }
            if (file.size <= IMG_PERSIST_MAX) {
                const rd = new FileReader();
                rd.onload = () => {
                    const du = String(rd.result).replace(/^data:[^;]*;/, 'data:' + (/svg/i.test(file.name || '') ? 'image/svg+xml' : 'image/png') + ';');
                    if (IMG_DATA_RE.test(du)) { cfg.cursor.imageData = du; save(); }
                };
                rd.readAsDataURL(file);
            } else say('Курсор работает, но после перезагрузки страницы его нужно загрузить снова (файл больше 250 КБ).');
            save();
            refreshUi();
        }
        function clearImage() {
            revokeBlob();
            imgSrc = '';
            shapeKey = '';
            cfg.cursor.imageData = '';
            if (cfg.cursor.mode === 'image') { cfg.cursor.mode = 'normal'; syncListeners(); hideCursor(); }
            save();
            refreshUi();
            schedule();
        }
        async function restoreImage() {
            const du = cfg.cursor.imageData;
            if (!du) return;
            const b = dataUrlToBlob(du);
            if (!b) return;
            const url = URL.createObjectURL(b);
            const size = await probe(url);
            if (size) { useImage(url, true, size); } else URL.revokeObjectURL(url);
        }

        // --------- блок в «Внешнем виде» ----------
        // --------- the block in "Appearance" ----------
        function say(t) { if (ui && ui.msg) ui.msg.textContent = t || ''; }
        function refreshImage() {
            if (!ui) return;
            if (imgSrc) ui.prev.src = imgSrc; else ui.prev.removeAttribute('src');
            ui.prev.style.visibility = imgSrc ? 'visible' : 'hidden';
        }
        function refreshReadout() {
            if (!ui) return;
            const fresh = meas.d > 0 && performance.now() - meas.at < 6000;
            ui.read.textContent = fresh
                ? 'Кисть игры сейчас ' + fmt(meas.d) + ' px, с вашей толщиной: ≈ ' + fmt(meas.d * cfg.thickness / 100) + ' px (в пикселях холста)'
                : 'Наведите курсор на холст - покажу реальный размер кисти в пикселях.';
        }
        function refreshStatus() {
            if (!ui) return;
            if (!hookWanted()) {
                ui.status.textContent = 'Толщина и нажим по умолчанию: игра рисует как обычно, перехват рисования выключен.';
                ui.status.className = 'gpue-hint';
            } else if (!hook.on) {
                ui.status.textContent = 'Не удалось включить перехват рисования' + (hook.err ? ' (' + hook.err + ')' : '') + '. Толщина и нажим не применяются.';
                ui.status.className = 'gpue-hint';
            } else if (hook.seen === 0) {
                ui.status.textContent = 'Перехват включён. Нарисуйте линию на холсте: если после неё здесь ничего не изменится, игра рисует иначе и тонкая кисть не сработает.';
                ui.status.className = 'gpue-hint';
            } else if (hook.scaled === 0) {
                ui.status.textContent = 'Рисование на холсте замечено, но ширина не менялась (ластик или игра рисует без stroke). Перехвачено: 0.';
                ui.status.className = 'gpue-hint';
            } else {
                ui.status.textContent = 'Перехват работает. Изменено вызовов рисования: ' + hook.scaled + '.';
                ui.status.className = 'gpue-hint';
            }
        }
        function refreshUi() {
            if (!ui) return;
            const k = cfg.cursor;
            ui.mode.value = k.mode;
            ui.color.value = k.color;
            ui.wid.set(k.width);
            ui.thk.set(cfg.thickness);
            ui.prs.set(cfg.pressure);
            ui.imgRow.style.display = k.mode === 'image' ? 'flex' : 'none';
            refreshImage();
            refreshReadout();
            refreshStatus();
        }
        function rangeRow(label, min, max, unit, onInput) {
            const input = h('input', { type: 'range', min: String(min), max: String(max), step: '1' });
            const val = h('span', { class: 'gpa-val' });
            const show = v => { val.textContent = v + unit; };
            input.addEventListener('input', () => { show(input.value); onInput(Number(input.value)); });
            return { row: h('div', { class: 'gpa-row' }, [h('span', { text: label }), input, val]), set: v => { input.value = String(v); show(v); } };
        }
        // sectionFn - та же функция раскрывающегося блока, что и у остальных блоков «Внешнего вида»
        // sectionFn - the same collapsible-block function as the other "Appearance" blocks
        function buildSection(sectionFn) {
            const u = {};
            const sel = opts => h('select', {}, opts.map(o => h('option', { value: o[0], text: o[1] })));
            u.mode = sel([['normal', 'Обычный (кружок игры)'], ['circle', 'Круг по размеру кисти'], ['cross', 'Круг с перекрестием'], ['dot', 'Точка в центре'], ['image', 'Своя картинка (PNG/SVG)']]);
            u.color = h('input', { type: 'color' });
            u.wid = rangeRow('Контур', 1, 12, 'px', v => { cfg.cursor.width = v; shapeKey = ''; save(); schedule(); });
            u.prev = h('img', { class: 'gpa-prev', alt: '' });
            u.file = h('input', { type: 'file', accept: '.png,.svg,image/png,image/svg+xml', style: 'display:none' });
            u.bFile = h('button', { class: 'gpue-b', text: '📁 PNG / SVG', title: 'Выбрать картинку курсора на компьютере' });
            u.bClr = h('button', { class: 'gpue-b', text: '✕', title: 'Убрать картинку' });
            u.imgRow = h('div', { class: 'gpa-imgbox' }, [u.prev, u.bFile, u.bClr, u.file]);
            u.thk = rangeRow('Толщина кисти', 1, 200, '%', v => { cfg.thickness = v; shapeKey = ''; save(); syncHook(); refreshReadout(); schedule(); });
            u.prs = rangeRow('Нажим пера', 0, 100, '%', v => { cfg.pressure = v; save(); syncHook(); notifyPressure(); });
            u.read = h('div', { class: 'gpue-hint' });
            u.status = h('div', { class: 'gpue-hint' });
            u.msg = h('div', { class: 'gpue-hint' });
            u.bReset = h('button', { class: 'gpue-b gpue-danger', text: '↺ Сбросить кисть' });

            u.mode.addEventListener('change', () => {
                cfg.cursor.mode = u.mode.value;
                shapeKey = '';
                save();
                syncListeners();
                if (cfg.cursor.mode === 'normal') hideCursor();
                refreshUi();
                schedule();
            });
            u.color.addEventListener('input', () => { cfg.cursor.color = u.color.value; shapeKey = ''; save(); schedule(); });
            u.bFile.addEventListener('click', () => u.file.click());
            u.file.addEventListener('change', async () => { const f = u.file.files && u.file.files[0]; u.file.value = ''; if (f) await loadFile(f); });
            u.bClr.addEventListener('click', clearImage);
            u.bReset.addEventListener('click', async () => {
                if (!(await uiDialog({ title: 'Сбросить кисть?', text: 'Курсор, толщина и нажим кисти вернутся к значениям по умолчанию.', okText: 'Сбросить', danger: true }))) return;
                clearImage();
                Object.assign(cfg.cursor, clone(DEF.cursor));
                cfg.thickness = DEF.thickness;
                cfg.pressure = DEF.pressure;
                hook.seen = 0; hook.seenAux = 0; hook.fills = 0; hook.scaled = 0; hook.seg = 0; hook.fallback = 0; hook.cacheHit = 0; hook.normHit = 0; hook.replay = 0;
                save();
                hideCursor();
                syncHook();
                refreshUi();
                notifyPressure();
                say('Сброшено.');
            });
            ui = u;
            const el = sectionFn('Кисть', [
                u.mode,
                h('div', { class: 'gpa-row' }, [h('span', { text: 'Цвет' }), u.color]),
                u.wid.row,
                u.imgRow,
                u.thk.row,
                u.prs.row,
                u.read,
                u.status,
                u.bReset,
                u.msg,
                h('div', {
                    class: 'gpue-hint',
                    text: 'Курсор - только картинка поверх страницы: клики и перо идут сквозь него, координаты рисования не меняются. Толщина меньше 100% делает линии тоньше минимума игры, нажим работает только с пером (у мыши нажима нет). Перехват рисования включается лишь когда значения не по умолчанию.'
                })
            ], false);
            refreshUi();
            return el;
        }

        function init() {
            const root = document.documentElement;
            // защита от дублей при повторном запуске скрипта: слушатели и перехват ставим один раз на страницу
            // protection against duplicates on a repeated script run: listeners and the hook are installed once per page
            if (root.getAttribute('data-gpe-brush') === '1') { load(); return; }
            root.setAttribute('data-gpe-brush', '1');
            load();
            if (!document.getElementById(STYLE_ID)) {
                const st = document.createElement('style');
                st.id = STYLE_ID;
                st.textContent = 'html.gpe-brush-hidecursor .draw .core,html.gpe-brush-hidecursor .draw .core *{cursor:none !important}';
                (document.head || document.documentElement).appendChild(st);
            }
            restoreImage();
            syncHook();
            refreshUi(); // блок мог быть построен до загрузки настроек - показываем сохранённые значения | the block may have been built before the settings loaded - show the saved values
        }

        // --------- связь с блоком «Нажим кисти» ----------
        // --------- connection with the "Brush pressure" block ----------
        const pressureListeners = [];
        function notifyPressure() { pressureListeners.forEach(fn => { try { fn(); } catch (e) { /* не мешаем кисти */ } }); }
        function setPressure(v) {
            cfg.pressure = Math.round(num(v, 0, 100, 0));
            save();
            syncHook();
            if (ui) ui.prs.set(cfg.pressure);
            notifyPressure();
        }
        // Диаметр кисти игры в px экрана (по кружку на курсорном canvas), 0 - ещё не измерен
        // The game brush's diameter in screen px (from the circle on the cursor canvas), 0 - not measured yet
        function gameBrushScreenPx() {
            if (!(meas.d > 0)) return 0;
            const cv = getCursorCanvas();
            if (!cv || !cv.width) return 0;
            const r = cv.getBoundingClientRect();
            return r.width ? meas.d * r.width / cv.width : 0;
        }

        // сторож (баг C). Настройки живут в GM-хранилище, обёртки - на прототипе (переживают смену
        // watchdog (bug C). The settings live in GM storage, the wrappers - on the prototype (they survive a round
        // раунда/канваса), но если состояние всё же потеряно (внешняя причина), синхронизируем по tick.
        // canvas change), but if the state is still lost (an external cause), we synchronize on tick.
        // Намеренно минимально: меняем состояние только при явном расхождении hookWanted и hook.on -
        // Deliberately minimal: we change the state only on an explicit mismatch of hookWanted and hook.on -
        // переворачивать обёртки поверх чужих (GameProbe) нельзя, иначе команды запишутся дважды.
        // wrapping foreign wrappers (GameProbe) is not allowed, otherwise commands would be recorded twice.
        function tickCheck() {
            try { if (hookWanted() !== hook.on) syncHook(); } catch (e) { /* ignore */ }
        }

        // снимок недавних «живых» штрихов с профилем нажима — для PressurePublish
        // a snapshot of recent "live" strokes with the pressure profile - for PressurePublish
        function liveStrokes() {
            const out = [];
            for (const [, list] of liveByCv) for (const r of list) out.push({ style: r.style, pts: r.pts, cum: r.cum, total: r.total, facs: r.facs, at: r.at, w: r.w, h: r.h });
            return out.sort((a, b) => b.at - a.at);
        }
        return {
            init, getConfig: () => clone(cfg), buildSection, tickCheck,
            liveStrokes,
            getPressure: () => cfg.pressure, setPressure, onPressureChange: fn => pressureListeners.push(fn),
            syncHook, gameBrushScreenPx,
            getDiag: () => ({
                hookOn: hook.on, seen: hook.seen, seenAux: hook.seenAux, fills: hook.fills, scaled: hook.scaled, err: hook.err, pType, pPress, thickness: cfg.thickness, pressure: cfg.pressure, mode: cfg.cursor.mode,
                // диагностика сегментного нажима
                // segment pressure diagnostics
                segStrokes: hook.seg, segFallback: hook.fallback, cacheHit: hook.cacheHit, cacheSize: profileCache.size,
                normHit: hook.normHit, replayStrokes: hook.replay,
                lastKind: segDiag.kind, lastLineWidth: segDiag.lw0, lastBaseFactor: Math.round(segDiag.base * 100) / 100,
                lastPressure: Math.round(segDiag.press * 100) / 100, minSegW: segDiag.min, maxSegW: segDiag.max
            })
        };
    })();

    // =====================================================
    // общие помощники модулей «Нажим кисти», «Перемещение холста», «Слои» и зонда диагностики.
    // common helpers of the "Brush pressure", "Canvas panning", "Layers" modules and the diagnostics probe.
    // Хранение - тот же механизм GM_getValue/GM_setValue, отдельные новые ключи.
    // Storage - the same GM_getValue/GM_setValue mechanism, separate new keys.
    // =====================================================
    const DRAW_CANVAS_SEL = '.draw .drawingContainer canvas'; // реальный canvas рисования (как в «Рамке холста» и «Кисти») | the real drawing canvas (as in "Canvas frame" and "Brushes")

    // Координаты события БЕЗ исправления (геттер MouseEvent.prototype): код коррекции мог переопределить
    // The event's coordinates WITHOUT correction (the MouseEvent.prototype getter): the correction code could redefine
    // clientX/clientY на самом событии, а нашим слоям и жестам нужна фактическая точка под курсором.
    // clientX/clientY on the event itself, while our layers and gestures need the actual point under the cursor.
    const RAW_CLIENT = (() => {
        try {
            const x = Object.getOwnPropertyDescriptor(MouseEvent.prototype, 'clientX');
            const y = Object.getOwnPropertyDescriptor(MouseEvent.prototype, 'clientY');
            return x && x.get && y && y.get ? { x: x.get, y: y.get } : null;
        } catch (e) { return null; }
    })();
    function rawXY(e) {
        if (RAW_CLIENT) { try { return [RAW_CLIENT.x.call(e), RAW_CLIENT.y.call(e)]; } catch (err) { /* запасной вариант ниже */ } }
        return [e.clientX, e.clientY];
    }
    function coalescedOf(e) {
        if (typeof e.getCoalescedEvents === 'function') {
            try { const list = e.getCoalescedEvents(); if (list && list.length) return list; } catch (err) { /* нет в этом браузере */ }
        }
        return [e];
    }
    function drawCanvasEl() { return document.querySelector(DRAW_CANVAS_SEL); }
    function inRect(x, y, r) { return !!r && r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }
    function isEditableTarget(t) { return !!(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))); }

    function readStoreKey(key) {
        try {
            const raw = typeof GM_getValue === 'function' ? GM_getValue(key, null) : localStorage.getItem(key);
            if (!raw) return null;
            return typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch (e) { return null; }
    }
    // Отложенная запись настроек модуля; результат показывает индикатор автосохранения панели.
    // Deferred saving of the module's settings; the result is shown by the panel's auto-save indicator.
    // при уходе со страницы/скрытии вкладки не ждём debounce и пишем сразу.
    // on page leave/tab hiding we do not wait for the debounce and write immediately.
    function makeSaver(key, source, getData) {
        let t = 0, dirty = false;
        const write = () => {
            if (!dirty) return;
            dirty = false;
            try {
                const raw = JSON.stringify(getData());
                if (typeof GM_setValue === 'function') GM_setValue(key, raw); else localStorage.setItem(key, raw);
                uiSaveDone(source, true);
            } catch (e) { uiSaveDone(source, false); }
        };
        const saver = () => {
            dirty = true;
            clearTimeout(t);
            uiSavePending(source);
            t = setTimeout(write, 300);
        };
        saver.flush = write;
        try {
            window.addEventListener('pagehide', write);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') write();
            });
        } catch (e) { /* ignore */ }
        return saver;
    }

    // Строки блоков «Оформления» (те же классы gpa-row / gpue-chk, что у модуля оформления)
    // The rows of "Appearance" blocks (the same gpa-row / gpue-chk classes as the appearance module)
    function uiRange(label, min, max, step, fmt, onInput) {
        const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': label });
        const val = h('span', { class: 'gpa-val' });
        const show = v => { val.textContent = fmt(Number(v)); };
        input.addEventListener('input', () => { show(input.value); onInput(Number(input.value)); });
        const row = h('div', { class: 'gpa-row' }, [h('span', { text: label }), input, val]);
        return { row, input, set: v => { input.value = String(v); show(v); } };
    }
    function uiSwitch(label, onChange) {
        const input = h('input', { type: 'checkbox' });
        input.addEventListener('change', () => onChange(input.checked));
        return { row: h('label', { class: 'gpue-chk' }, [input, label]), input, set: v => { input.checked = !!v; } };
    }
    function uiSelect(label, options, onChange) {
        const sel = h('select', {}, options.map(o => h('option', { value: o[0], text: o[1] })));
        sel.addEventListener('change', () => onChange(sel.value));
        return { row: h('div', { class: 'gpa-row' }, [h('span', { text: label }), sel]), input: sel, set: v => { sel.value = v; } };
    }
    // Раскрывающийся блок (та же разметка, что у блоков «Оформления») - для вкладки «Рисование»
    // A collapsible block (the same markup as the "Appearance" blocks) - for the "Drawing" tab
    function uiSection(title, rows, open) {
        const d = h('details', { class: 'gpa-sec' }, [h('summary', { text: title }), h('div', { class: 'gpa-body' }, rows.filter(Boolean))]);
        d.open = !!open;
        return d;
    }

    // Короткое уведомление поверх игры (работает и при закрытой панели), не ловит мышь
    // A short notification over the game (works with the panel closed), does not catch the mouse
    function floatNotice(text, ms) {
        let el = document.getElementById('gpue-notice');
        if (!el) {
            el = document.createElement('div');
            el.id = 'gpue-notice';
            el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483646;max-width:min(520px,90vw);' +
                'padding:10px 14px;border-radius:10px;background:#1B1E26;color:#F4F5FA;border:1px solid rgba(232,162,59,.6);' +
                'box-shadow:0 10px 30px rgba(0,0,0,.45);font:13px/1.45 "Segoe UI",system-ui,Arial,sans-serif;pointer-events:none;text-align:center;display:none';
            document.body.appendChild(el);
        }
        el.textContent = text;
        el.style.display = 'block';
        clearTimeout(floatNotice.t);
        floatNotice.t = setTimeout(() => { el.style.display = 'none'; }, ms || 5000);
    }

    // Видимая часть холста: его прямоугольник, обрезанный предками с overflow (как и сам холст обрезается в игре).
    // The visible part of the canvas: its rectangle clipped by ancestors with overflow (just as the canvas itself is clipped in the game).
    // shift(el) -> [dx, dy]: поправка для предков, которые сдвинуты нашим перемещением (чтобы получить «окно» без сдвига).
    // shift(el) -> [dx, dy]: the correction for ancestors shifted by our panning (to get the "window" without the shift).
    const clipCache = new WeakMap();
    function clipsOverflow(el) {
        const now = performance.now();
        const c = clipCache.get(el);
        if (c && now - c.at < 1000) return c.v;
        const cs = getComputedStyle(el);
        const v = cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
        clipCache.set(el, { v, at: now });
        return v;
    }
    function visibleRectOf(cv, shift, base) {
        const r = base || cv.getBoundingClientRect();
        let L = r.left, T = r.top, R = r.right, B = r.bottom;
        for (let el = cv.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
            if (!clipsOverflow(el)) continue;
            const er = el.getBoundingClientRect();
            const s = shift ? shift(el) : [0, 0];
            L = Math.max(L, er.left - s[0]); T = Math.max(T, er.top - s[1]);
            R = Math.min(R, er.right - s[0]); B = Math.min(B, er.bottom - s[1]);
        }
        L = Math.max(L, 0); T = Math.max(T, 0); R = Math.min(R, window.innerWidth); B = Math.min(B, window.innerHeight);
        return { left: L, top: T, right: R, bottom: B, width: Math.max(0, R - L), height: Math.max(0, B - T) };
    }

    // =====================================================
    // PressureSettings: нажим кисти (расширение блока «Кисть»).
    // PressureSettings: brush pressure (an extension of the "Brush" block).
    //
    // Нажим только ЧИТАЕТСЯ: passive-слушатели pointer-событий на window (фаза захвата, срабатывают раньше
    // Pressure is only READ: passive listeners of pointer events on window (capture phase, they fire earlier than
    // mousemove игры). События не меняются и не блокируются. Применяется нажим к отрисовке существующим
    // the game's mousemove). Events are not changed or blocked. The pressure is applied to the rendering by the existing
    // механизмом - обёртками stroke/arc/fill модуля BrushSettings (его pressureFactor вызывает widthFactor).
    // mechanism - the stroke/arc/fill wrappers of the BrushSettings module (its pressureFactor calls widthFactor).
    // Чувствительность - прежний параметр «Нажим пера» (gpUiBrush.v1); кривая, минимум/максимум, сглаживание,
    // Sensitivity - the former "Pen pressure" parameter (gpUiBrush.v1); the curve, minimum/maximum, smoothing,
    // прозрачность и режим - новый ключ gpUiPressure.v1. Мышь рисует как обычно (её нажим считается равным 1),
    // opacity and mode - the new gpUiPressure.v1 key. The mouse draws as usual (its pressure is considered 1),
    // наведение пера (pressure 0) линию не уменьшает: берётся последнее значение.
    // pen hover (pressure 0) does not thin the line: the last value is used.
    // =====================================================
    const PressureSettings = (() => {
        const KEY = 'gpUiPressure.v1';
        const CURVES = ['legacy', 'linear', 'soft', 'hard', 'gamma'];
        const DEVICES = ['auto', 'pen', 'pentouch'];
        const DEF = { enabled: null, device: 'auto', curve: 'linear', gamma: 1.6, min: 20, max: 100, smooth: 30, alpha: 0 };
        let cfg = Object.assign({}, DEF);
        let loaded = false, hadSaved = false;
        // текущее состояние нажима (читается из passive-слушателей)
        // the current pressure state (read from passive listeners)
        const cur = { type: 'mouse', raw: 1, val: 1, real: false, down: false, fresh: true, at: 0, lastUp: 0 };
        // что видели от устройства: помогает понять, почему нажим «не работает»
        // what we saw from the device: helps to understand why pressure "does not work"
        const seen = { pen: 0, penNoPressure: 0, real: 0, mouseHalf: 0 };
        const handlers = [];
        const needs = new Set();
        let ui = null, uiRaf = 0, statT = 0;
        const save = makeSaver(KEY, 'pressure', () => cfg);

        function sanitize(o) {
            const r = Object.assign({}, DEF);
            if (!o || typeof o !== 'object') return r;
            if (typeof o.enabled === 'boolean') r.enabled = o.enabled;
            if (DEVICES.includes(o.device)) r.device = o.device; else if (o.touch === true) r.device = 'pentouch';
            if (CURVES.includes(o.curve)) r.curve = o.curve;
            r.gamma = Math.round(clampNum(o.gamma, 0.2, 5, DEF.gamma) * 10) / 10;
            r.min = Math.round(clampNum(o.min, 1, 100, DEF.min));
            r.max = Math.round(clampNum(o.max, 50, 300, DEF.max));
            if (r.max < r.min) r.max = r.min;
            r.smooth = Math.round(clampNum(o.smooth, 0, 90, DEF.smooth));
            r.alpha = Math.round(clampNum(o.alpha, 0, 100, 0));
            return r;
        }
        function load() {
            if (loaded) return;
            loaded = true;
            const raw = readStoreKey(KEY);
            hadSaved = !!raw;
            cfg = sanitize(raw);
        }

        const sens = () => { try { return BrushSettings.getPressure() / 100; } catch (e) { return 0; } };
        const isOn = () => cfg.enabled === true;
        // Есть ли у события настоящий нажим для выбранного режима устройства
        // Whether the event has real pressure for the selected device mode
        function realPressure(type, p) {
            if (type === 'pen') return true;
            if (cfg.device === 'pen') return false;
            if (type === 'touch') return cfg.device === 'pentouch' || (p > 0 && Math.abs(p - 0.5) > 0.001);
            // мышь: у обычной мыши нажим всегда 0.5; другое значение - драйвер планшета передаёт перо как мышь
            // mouse: a regular mouse always has pressure 0.5; another value means the tablet driver sends the pen as a mouse
            return cfg.device === 'auto' && p > 0 && Math.abs(p - 0.5) > 0.001;
        }
        function curve(p) {
            switch (cfg.curve) {
                case 'soft': return Math.sqrt(p);
                case 'hard': return p * p;
                case 'gamma': return Math.pow(p, cfg.gamma);
                default: return p;
            }
        }
        // Множитель ширины для нажима p (0..1) при силе эффекта S (0..1). S = 0 - ровно 1 (как было).
        // Width multiplier for pressure p (0..1) with effect strength S (0..1). S = 0 - exactly 1 (as before).
        function widthFor(p, S) {
            if (!(S > 0)) return 1;
            if (cfg.curve === 'legacy') return Math.pow(4, S * (2 * p - 1)); // формула  | formula
            const w = (cfg.min + (cfg.max - cfg.min) * curve(p)) / 100;
            return 1 + (w - 1) * S;
        }
        function alphaFor(p) {
            if (!cfg.alpha) return 1;
            const c = cfg.curve === 'legacy' ? p : curve(p);
            return Math.max(0.05, 1 - (cfg.alpha / 100) * (1 - c));
        }
        function widthFactor() {
            load();
            return isOn() && cur.real ? widthFor(cur.val, sens()) : 1;
        }
        function alphaFactor() {
            load();
            return isOn() && cfg.alpha && cur.real ? alphaFor(cur.val) : 1;
        }
        function alphaWanted() { load(); return isOn() && cfg.alpha > 0; }
        function pressureWanted() { load(); return isOn() && sens() > 0; }
        // Идёт ли сейчас штрих (нажата кнопка или только что отпущена: игра может дорисовать в следующем кадре)
        // Whether a stroke is in progress (the button is pressed or has just been released: the game may finish the stroke in the next frame)
        function gestureActive() { return cur.down || performance.now() - cur.lastUp < 250; }
        // кнопка нажата прямо сейчас (без 250мс-окна после отпускания) - для кэша профиля нажима
        // the button is pressed right now (without the 250ms window after release) - for the pressure profile cache
        function isDown() { load(); return !!cur.down; }

        // Отдельный «счётчик» нажима для одного штриха (слои скрипта, тестовое поле): своё сглаживание
        // A separate pressure "counter" for one stroke (a script layer, a test field): its own smoothing
        function sampler(type) {
            load();
            const S = isOn() ? sens() : 0, k = cfg.smooth / 100;
            let val = null, real = false;
            return {
                next(ev) {
                    const p = ev && ev.pressure;
                    if (realPressure(type || 'mouse', p)) {
                        real = true;
                        if (p > 0) { const v = Math.min(1, p); val = val === null ? v : val * k + v * (1 - k); }
                    }
                    if (!real) return { w: 1, a: 1, p: 1 };
                    const pv = val === null ? 1 : val;
                    return { w: widthFor(pv, S), a: isOn() && cfg.alpha ? alphaFor(pv) : 1, p: pv };
                }
            };
        }

        // --------- чтение нажима со страницы ----------
        // --------- reading pressure from the page ----------
        function take(e, isDown) {
            const type = e.pointerType || 'mouse';
            cur.type = type;
            if (isDown) cur.fresh = true;
            const k = cfg.smooth / 100;
            let real = false;
            for (const ev of (isDown ? [e] : coalescedOf(e))) {
                const p = ev.pressure;
                if (type === 'pen' && e.buttons) { seen.pen++; if (!(p > 0) || Math.abs(p - 0.5) < 0.001) seen.penNoPressure++; }
                if (type === 'mouse' && e.buttons && Math.abs(p - 0.5) < 0.001) seen.mouseHalf++;
                if (!realPressure(type, p)) continue;
                real = true;
                if (!(p > 0)) continue; // наведение пера (0) или нет данных: прежнее значение | pen hover (0) or no data: the previous value
                if (e.buttons) seen.real++;
                const v = Math.min(1, p);
                cur.raw = v;
                cur.val = cur.fresh ? v : cur.val * k + v * (1 - k);
                cur.fresh = false;
            }
            cur.real = real;
            if (!real) { cur.raw = cur.val = 1; }
            cur.at = performance.now();
            scheduleUi();
        }
        // штрих - только основная кнопка мыши или касание пера/пальца (ПКМ - перемещение холста, не рисование)
        // a stroke - only the main mouse button or a pen/finger touch (RMB - canvas panning, not drawing)
        const onDown = e => { if (e.button === 0 || (e.pointerType && e.pointerType !== 'mouse')) cur.down = true; take(e, true); };
        const onMove = e => take(e, false);
        const onUp = () => { if (cur.down) cur.lastUp = performance.now(); cur.down = false; scheduleUi(); };
        function syncListeners() {
            const want = needs.size > 0;
            if (want && !handlers.length) {
                const o = { capture: true, passive: true };
                [['pointerdown', onDown], ['pointermove', onMove], ['pointerup', onUp], ['pointercancel', onUp]].forEach(p => {
                    window.addEventListener(p[0], p[1], o);
                    handlers.push([p[0], p[1], o]);
                });
            } else if (!want && handlers.length) {
                while (handlers.length) { const x = handlers.pop(); window.removeEventListener(x[0], x[1], x[2]); }
                cur.down = false;
            }
        }
        // Кто нуждается в чтении нажима: нажим кисти, перехват кисти, открытый блок, рисование на слоях
        // Who needs pressure reading: brush pressure, the brush hook, an open block, drawing on layers
        function need(token, on) {
            if (on) needs.add(token); else needs.delete(token);
            syncListeners();
        }
        function syncNeeds() {
            load();
            need('hook', pressureWanted() || alphaWanted());
        }
        function changed() {
            save();
            syncNeeds();
            try { BrushSettings.syncHook(); } catch (e) { /* модуль кисти недоступен */ }
            refreshUi();
        }
        function setEnabled(on) {
            cfg.enabled = !!on;
            // включили, а сила эффекта («Нажим пера» в блоке «Кисть») стоит на 0 - ставим 100%, иначе ничего не изменится
            // it was enabled but the effect strength ("Pen pressure" in the "Brush" block) is 0 - we set 100%, otherwise nothing would change
            if (cfg.enabled && sens() === 0) { try { BrushSettings.setPressure(100); } catch (e) { /* ignore */ } }
            changed();
        }

        // --------- блок во вкладке «Рисование» ----------
        // --------- the block in the "Drawing" tab ----------
        function scheduleUi() { if (ui && ui.open() && !uiRaf) uiRaf = requestAnimationFrame(drawMeter); }
        function drawMeter() {
            uiRaf = 0;
            if (!ui) return;
            const recent = performance.now() - cur.at < 1500;
            const p = recent && cur.real ? cur.val : 0;
            ui.fill.style.width = Math.round(p * 100) + '%';
            ui.num.textContent = recent && cur.real ? Math.round(cur.val * 100) + '%' : '—';
            const typeName = { pen: 'перо', mouse: 'мышь', touch: 'касание' }[cur.type] || cur.type;
            ui.meta.textContent = recent
                ? typeName + (cur.real ? ' · ширина ×' + widthFor(cur.val, isOn() ? sens() : 0).toFixed(2) + (isOn() && cfg.alpha ? ' · прозрачность ×' + alphaFor(cur.val).toFixed(2) : '') : ' · нажим не передаётся')
                : 'Проведите пером по тестовому полю или холсту';
            // почему может не работать: перо без нажима или перо, которое браузер видит как мышь
            // why it may not work: a pen without pressure or a pen the browser sees as a mouse
            let warn = '';
            if (seen.pen > 20 && seen.penNoPressure / seen.pen > 0.9) warn = 'Перо не передаёт силу нажима (всегда 0 или 0.5). Проверьте настройки драйвера планшета.';
            else if (!seen.pen && !seen.real && seen.mouseHalf > 40 && cur.type === 'mouse') warn = 'Видна только мышь. Если вы рисуете пером, драйвер передаёт его как мышь без нажима: включите Windows Ink (Wacom: «Use Windows Ink», Huion/XP-Pen: «Windows Ink»).';
            if (ui.warn.textContent !== warn) { ui.warn.textContent = warn; ui.warn.style.display = warn ? 'block' : 'none'; }
        }
        function refreshStats() {
            if (!ui) return;
            let b = null;
            try { b = BrushSettings.getDiag(); } catch (e) { b = null; }
            let t;
            if (!isOn()) t = 'Нажим выключен.';
            else if (!b || !b.hookOn) t = 'Перехват рисования игры не включён' + (b && b.err ? ' (' + b.err + ')' : '') + '.';
            else if (!b.seen && !b.seenAux && !b.fills) t = 'Перехват включён, но игра ещё не рисовала. Нарисуйте линию на холсте игры.';
            else if (!b.seen && !b.seenAux && b.fills) t = 'Игра рисует заливкой (fill), а не линиями: толщину так изменить нельзя. Пришлите отчёт «Диагностики».';
            else t = 'Линий игры перехвачено: ' + (b.seen + b.seenAux) + (b.seenAux ? ' (на вспомогательном холсте: ' + b.seenAux + ')' : '') + ', с изменённой толщиной: ' + b.scaled + '.' +
                (b.scaled === 0 ? ' Толщина не менялась: нажим не дошёл (см. индикатор выше) или рисовали мышью.' : '');
            if (ui.stats.textContent !== t) ui.stats.textContent = t;
        }
        function refreshUi() {
            if (!ui) return;
            ui.en.set(isOn());
            ui.body.style.display = isOn() ? '' : 'none';
            ui.device.set(cfg.device);
            ui.sens.set(Math.round(sens() * 100));
            ui.curve.set(cfg.curve);
            ui.gamma.set(cfg.gamma);
            ui.gamma.row.style.display = cfg.curve === 'gamma' ? '' : 'none';
            ui.min.set(cfg.min);
            ui.max.set(cfg.max);
            const minMax = cfg.curve !== 'legacy';
            ui.min.row.style.display = minMax ? '' : 'none';
            ui.max.row.style.display = minMax ? '' : 'none';
            ui.smooth.set(cfg.smooth);
            ui.alpha.set(cfg.alpha);
            refreshStats();
            drawMeter();
        }
        function buildTestPad() {
            const cv = h('canvas', { class: 'gpue-ui-pad', 'aria-label': 'Тестовое поле для пера' });
            const clear = h('button', { type: 'button', class: 'gpue-b gpue-ui-sm', text: 'Очистить поле' });
            let st = null;
            const fit = () => {
                const dpr = Math.min(3, window.devicePixelRatio || 1);
                const w = Math.max(10, Math.round(cv.clientWidth * dpr)), hh = Math.max(10, Math.round(cv.clientHeight * dpr));
                if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; }
                return dpr;
            };
            const padPoint = ev => {
                const r = cv.getBoundingClientRect();
                const p = rawXY(ev);
                const x = (p[0] - r.left) * st.dpr, y = (p[1] - r.top) * st.dpr;
                const s = st.s.next(ev);
                const c = st.ctx;
                const prev = st.last || { x, y };
                c.save();
                c.globalAlpha = s.a;
                c.strokeStyle = '#B9A6FF';
                c.lineWidth = Math.max(0.5, 10 * st.dpr * s.w);
                c.lineCap = 'round';
                c.lineJoin = 'round';
                c.beginPath(); c.moveTo(prev.x, prev.y); c.lineTo(x, y); c.stroke();
                c.restore();
                st.last = { x, y };
            };
            cv.addEventListener('pointerdown', e => {
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                const dpr = fit();
                try { cv.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
                st = { id: e.pointerId, dpr, last: null, s: sampler(e.pointerType), ctx: cv.getContext('2d') };
                e.preventDefault();
                padPoint(e);
            });
            cv.addEventListener('pointermove', e => { if (st && e.pointerId === st.id) coalescedOf(e).forEach(padPoint); });
            const end = () => { st = null; refreshStats(); };
            cv.addEventListener('pointerup', end);
            cv.addEventListener('pointercancel', end);
            clear.addEventListener('click', () => { fit(); cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); });
            return { cv, clear };
        }
        function buildSection(sectionFn) {
            load();
            const u = {};
            u.en = uiSwitch('Включить нажим кисти', v => setEnabled(v));
            u.device = uiSelect('Устройство', [['auto', 'Авто'], ['pen', 'Только перо'], ['pentouch', 'Перо и касание']], v => { cfg.device = v; changed(); });
            u.sens = uiRange('Сила эффекта', 0, 100, 1, v => v + '%', v => { try { BrushSettings.setPressure(v); } catch (e) { /* ignore */ } });
            u.curve = uiSelect('Кривая', [['linear', 'Линейная'], ['soft', 'Мягкая'], ['hard', 'Жёсткая'], ['gamma', 'Своя (gamma)'], ['legacy', 'Как в 2.4']], v => { cfg.curve = v; changed(); });
            u.gamma = uiRange('Gamma', 0.2, 5, 0.1, v => v.toFixed(1), v => { cfg.gamma = Math.round(v * 10) / 10; changed(); });
            u.min = uiRange('Лёгкое касание', 1, 100, 1, v => v + '%', v => { cfg.min = v; if (cfg.max < v) cfg.max = Math.max(50, v); changed(); });
            u.max = uiRange('Сильный нажим', 50, 300, 1, v => v + '%', v => { cfg.max = v; if (cfg.min > v) cfg.min = v; changed(); });
            u.smooth = uiRange('Сглаживание', 0, 90, 1, v => v + '%', v => { cfg.smooth = v; changed(); });
            u.alpha = uiRange('Прозрачность от нажима', 0, 100, 1, v => v + '%', v => { cfg.alpha = v; changed(); });
            u.fill = h('div', { class: 'gpue-ui-meter-fill' });
            u.num = h('span', { class: 'gpa-val', text: '—' });
            u.meta = h('div', { class: 'gpue-hint' });
            u.warn = h('div', { class: 'gpue-ui-warnbox', style: 'display:none' });
            u.stats = h('div', { class: 'gpue-hint' });
            const pad = buildTestPad();
            u.body = h('div', { style: 'display:flex;flex-direction:column;gap:9px' }, [
                u.device.row,
                u.curve.row,
                markAdv(u.gamma.row),
                u.min.row,
                u.max.row,
                markAdv(u.smooth.row),
                u.alpha.row,
                PressureBake.row(),
                PressurePublish.row(),
                markAdv(u.sens.row),
                h('div', { class: 'gpa-row' }, [h('span', { text: 'Нажим сейчас' }), h('div', { class: 'gpue-ui-meter' }, [u.fill]), u.num]),
                u.meta,
                u.warn,
                pad.cv,
                pad.clear,
                u.stats,
                h('div', { class: 'gpue-hint', text: 'Толщина линии меняется от «лёгкого касания» до «сильного нажима» (в % от кисти игры). Мышь рисует как обычно. Тестовое поле показывает, что приходит от пера; строка выше - меняет ли скрипт линии самой игры.' })
            ]);
            const el = sectionFn('Нажим кисти', [u.en.row, u.body], false);
            u.open = () => {
                const p = document.getElementById('gpue-panel');
                return el.open && !!(p && p.classList.contains('open'));
            };
            el.addEventListener('toggle', () => {
                need('ui', el.open);
                clearInterval(statT);
                statT = el.open ? setInterval(refreshStats, 1000) : 0;
                scheduleUi();
                refreshStats();
            });
            ui = u;
            refreshUi();
            return el;
        }

        function init() {
            const root = document.documentElement;
            load();
            if (root.getAttribute('data-gpe-pressure') === '1') return; // повторный запуск скрипта: слушатели уже есть | script re-run: the listeners already exist
            root.setAttribute('data-gpe-pressure', '1');
            // конфигурации без нового ключа: нажим включён, если в был включён «Нажим пера»; формула прежняя
            // configs without the new key: pressure is on if "Pen pressure" was on; the formula is the old one
            if (cfg.enabled === null) cfg.enabled = sens() > 0;
            if (!hadSaved && sens() > 0 && cfg.curve === DEF.curve) cfg.curve = 'legacy';
            try {
                BrushSettings.onPressureChange(() => {
                    if (sens() > 0 && !isOn()) { cfg.enabled = true; save(); }
                    syncNeeds();
                    refreshUi();
                });
            } catch (e) { /* ignore */ }
            syncNeeds();
            try { BrushSettings.syncHook(); } catch (e) { /* ignore */ }
            refreshUi();
        }

        return {
            init, buildSection, widthFactor, alphaFactor, alphaWanted, pressureWanted, gestureActive, isDown, sampler, need,
            lastPressure: () => { load(); return cur.real ? cur.val : 0; },
            getDiag: () => ({ enabled: isOn(), device: cfg.device, curve: cfg.curve, min: cfg.min, max: cfg.max, smooth: cfg.smooth, alpha: cfg.alpha, sens: Math.round(sens() * 100), listening: handlers.length > 0, type: cur.type, val: cur.val, real: cur.real, seen: Object.assign({}, seen) })
        };
    })();

    // =====================================================
    // PressureBake — нажим в ИТОГОВОМ рисунке.
    // PressureBake - pressure in the FINAL drawing.
    //
    // Проблема: тонкие «нажимные» штрихи видны на своём холсте, но в итоговых рисунках у всех
    // The problem: thin "pressure" strokes are visible on your own canvas, but in the final drawings of all
    // игроков толщина стандартная. Причина: перед отправкой игра перерисовывает холст
    // players the thickness is standard. The reason: before sending, the game re-renders the canvas
    // канонически (по своей геометрии штрихов), и съём картинки происходит уже после этой
    // canonically (from its stroke geometry), and the image capture happens after that
    // перерисовки; окно слоёв возвращает свои пиксели в холст каждый кадр, а нажим — нет.
    // re-render; the layers window returns its pixels into the canvas every frame, but pressure does not.
    //
    // Решение: после каждого штриха делаем снимок холста рисования (нажимная толщина уже
    // Solution: after each stroke we take a snapshot of the drawing canvas (the pressure thickness is already
    // в пикселях). В момент съёма картинки (toDataURL/toBlob на холсте рисования) подменяем
    // in pixels). At the moment of image capture (toDataURL/toBlob on the drawing canvas) we swap
    // содержимое холста снимком, снимаем и мгновенно возвращаем прежние пиксели. Снимок
    // the canvas content with the snapshot, capture it and instantly restore the previous pixels. The snapshot
    // берётся ТОЛЬКО по окончании штриха — чтобы не «запечь» каноническую перерисовку.
    // is taken ONLY after the stroke ends - so as not to "bake in" the canonical re-render.
    // Действует только при включённом перехвате (нажим/толщина) и включённом переключателе.
    // Works only with the hook enabled (pressure/thickness) and the toggle on.
    // =====================================================
    const PressureBake = (() => {
        const KEY = 'gpUiBake.v1';
        const DEF = { enabled: true };
        let cfg = Object.assign({}, DEF), loaded = false;
        const save = makeSaver(KEY, 'bake', () => cfg);
        function load() { if (loaded) return; loaded = true; const o = readStoreKey(KEY); if (o && typeof o === 'object' && typeof o.enabled === 'boolean') cfg.enabled = o.enabled; }

        let snap = null, snapCtx = null, snapCv = null, hasSnap = false, snapAt = 0;
        let downIn = false, pendT = 0, hooked = false, captures = 0, restores = 0;
        const handlers = [];
        const pendingRestores = []; // toBlob: холсты, которые ещё нужно вернуть | toBlob: canvases that still need to be returned

        // Снимок устаревает при новом штрихе, отмене, очистке и смене раунда.
        // The snapshot expires on a new stroke, undo, clear and round change.
        function invalidate() {
            hasSnap = false;
            snapCv = null;
            snapAt = 0;
        }
        function restorePending() {
            if (!pendingRestores.length) return;
            const list = pendingRestores.splice(0);
            for (const r of list) { try { r.restore(); } catch (e) { /* ignore */ } }
        }

        // запекание актуально, только когда перехват рисования реально меняет линии
        // baking is relevant only when the drawing hook actually changes the lines
        function interceptionOn() {
            try { if (PressureSettings.pressureWanted() || PressureSettings.alphaWanted()) return true; } catch (e) { /* ignore */ }
            try { const d = BrushSettings.getDiag(); if (d && d.hookOn) return true; } catch (e) { /* ignore */ }
            return false;
        }
        const active = () => { load(); return cfg.enabled !== false && interceptionOn(); };

        function takeSnapshot() {
            const cv = drawCanvasEl();
            if (!cv || !cv.isConnected || !cv.width || !cv.height) { invalidate(); return; }
            try {
                if (!snap || snapCv !== cv || snap.width !== cv.width || snap.height !== cv.height) {
                    snap = document.createElement('canvas');
                    snap.width = cv.width; snap.height = cv.height;
                    snapCtx = snap.getContext('2d');
                    snapCv = cv;
                }
                if (!snapCtx) { invalidate(); return; }
                snapCtx.clearRect(0, 0, snap.width, snap.height);
                snapCtx.drawImage(cv, 0, 0);
                hasSnap = true;
                snapAt = Date.now();
            } catch (e) {
                // tainted canvas / нет 2D-контекста — просто отключаем запекание
                // tainted canvas / no 2D context - we simply disable baking
                invalidate();
            }
        }
        // после отпускания: в 45 мс финальный перенос штриха уже случился, в 135 мс - страховка
        // after release: at 45ms the final stroke transfer has already happened, at 135ms - a safety net
        function scheduleSnap() {
            clearTimeout(pendT);
            pendT = setTimeout(() => { takeSnapshot(); setTimeout(takeSnapshot, 90); }, 45);
        }

        // --------- съём картинки игрой ----------
        // --------- image capture by the game ----------
        function swapIn(cv) {
            const ctx = cv.getContext('2d');
            if (!ctx) throw new Error('no 2d context');
            const backup = ctx.getImageData(0, 0, cv.width, cv.height);
            ctx.clearRect(0, 0, cv.width, cv.height);
            ctx.drawImage(snap, 0, 0);
            return backup;
        }
        function swapOut(cv, backup) { try { if (backup) cv.getContext('2d').putImageData(backup, 0, 0); } catch (e) { /* ignore */ } restores++; }
        // Снимок считаем актуальным не дольше 5 минут: защита от «воскрешения»
        // We consider the snapshot valid for no longer than 5 minutes: protection against "resurrecting"
        // рисунка прошлого раунда, если игра не сменила canvas.
        // the previous round's drawing if the game did not change the canvas.
        function want(cv) {
            return !!(cv && snap && hasSnap && snapCv === cv && cv.width === snap.width && cv.height === snap.height &&
                snapAt && Date.now() - snapAt < 300000) && active();
        }

        function installHooks() {
            if (hooked) return;
            const PW = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
            const list = [];
            try { if (PW && PW.HTMLCanvasElement && PW.HTMLCanvasElement.prototype) list.push(PW.HTMLCanvasElement.prototype); } catch (e) { /* ignore */ }
            try {
                const SP = window.HTMLCanvasElement && window.HTMLCanvasElement.prototype;
                if (SP && list.indexOf(SP) < 0) list.push(SP);
            } catch (e) { /* ignore */ }
            for (const CEP of list) {
                try {
                    if (CEP.__gpueBake) { hooked = true; return; }
                    const oData = CEP.toDataURL, oBlob = CEP.toBlob;
                    if (typeof oData === 'function') {
                        CEP.toDataURL = function (...a) {
                            if (want(this)) {
                                let b = null;
                                try { b = swapIn(this); } catch (e) { b = null; }
                                if (b) {
                                    captures++;
                                    try { return oData.apply(this, a); } finally { swapOut(this, b); }
                                }
                            }
                            return oData.apply(this, a);
                        };
                    }
                    if (typeof oBlob === 'function') {
                        CEP.toBlob = function (cb, ...a) {
                            if (!want(this)) return oBlob.apply(this, arguments);
                            let b = null;
                            try { b = swapIn(this); } catch (e) { b = null; }
                            if (!b) return oBlob.apply(this, arguments);
                            captures++;
                            const cv = this;
                            let done = false;
                            let rec = null;
                            const restore = () => {
                                if (done) return;
                                done = true;
                                swapOut(cv, b);
                                if (rec) { const i = pendingRestores.indexOf(rec); if (i >= 0) pendingRestores.splice(i, 1); }
                            };
                            rec = { cv, restore };
                            pendingRestores.push(rec);
                            // Страховка ставится ДО вызова: если oBlob бросит синхронно,
                            // The safety net is installed BEFORE the call: if oBlob throws synchronously,
                            // холст всё равно будет возвращён (и в catch, и по таймауту).
                            // the canvas will still be restored (both in catch and by timeout).
                            setTimeout(restore, 1200);
                            try {
                                return oBlob.call(cv, blob => { restore(); if (cb) cb(blob); }, ...a);
                            } catch (e) {
                                restore();
                                throw e;
                            }
                        };
                    }
                    try { CEP.__gpueBake = true; } catch (e) { /* ignore */ }
                    hooked = true;
                    return;
                } catch (e) { /* попробуем следующий realm */ }
            }
        }
        function installListeners() {
            if (handlers.length) return;
            const add = (ty, fn, o) => { window.addEventListener(ty, fn, o); handlers.push([ty, fn, o]); };
            add('pointerdown', e => {
                const cv = drawCanvasEl();
                if (!cv) { downIn = false; return; }
                const p = rawXY(e), r = cv.getBoundingClientRect();
                downIn = !!p && p[0] >= r.left && p[0] <= r.right && p[1] >= r.top && p[1] <= r.bottom;
                // Новый штрих начинается только на холсте. Клик по кнопке «Готово»
                // A new stroke starts only on the canvas. A click on the "Done" button
                // снаружи/поверх canvas НЕ должен инвалидировать снимок перед экспортом.
                // outside/over the canvas must NOT invalidate the snapshot before the export.
                const onButton = !!(e.target && e.target.closest && e.target.closest('button,[role="button"],a'));
                if (downIn && !onButton) {
                    restorePending(); // незавершённый toBlob-возврат закончить до рисования | an unfinished toBlob callback will finish before drawing
                    invalidate();
                }
            }, true);
            const up = () => { if (!downIn) return; downIn = false; if (active()) scheduleSnap(); };
            add('pointerup', up, true);
            add('pointercancel', up, true);
            // undo/redo и очистка: снимок мог бы вернуть отменённое содержимое
            // undo/redo and clear: the snapshot could bring back cancelled content
            add('keydown', e => {
                if (!(e.ctrlKey || e.metaKey)) return;
                const k = String(e.key || '').toLowerCase();
                if (k === 'z' || k === 'y') { restorePending(); invalidate(); }
            }, true);
            add('click', e => {
                const t = e.target;
                if (!t || !t.closest) return;
                const b = t.closest('button,[role="button"]');
                if (!b) return;
                let cls = '';
                try { cls = String(b.className || ''); } catch (err) { /* SVGAnimatedString */ }
                const s = [b.getAttribute('aria-label'), b.getAttribute('title'), b.id, cls, b.getAttribute('data-testid')]
                    .filter(Boolean).join(' ').toLowerCase();
                if (/(undo|отмен|clear|очист|reset|сброс|trash|delete|удал)/.test(s)) {
                    restorePending();
                    invalidate();
                }
            }, true);
        }
        function init() { load(); installListeners(); installHooks(); }
        // переключатель в разделе «Нажим кисти»
        // the toggle in the "Brush pressure" section
        function row() {
            load();
            const r = uiSwitch('Запекать нажим в итоговый рисунок', v => { cfg.enabled = v !== false; save(); });
            r.set(cfg.enabled !== false);
            return r.row;
        }
        return {
            init, row,
            getDiag: () => ({ on: active(), snap: hasSnap, captures, restores })
        };
    })();

    // =====================================================
    // PressurePublish — нажим В СЕТИ (другие игроки).
    // PressurePublish - pressure ON THE NETWORK (other players).
    //
    // Причина, почему толщина нажима не видна другим: игра передаёт рисунок ШТРИХАМИ по
    // Why the pressure thickness is invisible to others: the game sends the drawing as STROKES over
    // WebSocket (не картинкой), и в модели игры у штриха ОДНА толщина на весь путь
    // a WebSocket (not as an image), and in the game's model a stroke has ONE thickness for the whole path
    // ([tool, id, [color, size, alpha], ...точки]). Пиксели холста никуда не уходят,
    // ([tool, id, [color, size, alpha], ...points]). The canvas pixels do not go anywhere,
    // поэтому запекание в холст на других игроков влиять не могло.
    // so baking into the canvas could not affect other players.
    //
    // Решение: перехватываем ИСХОДЯЩИЕ сообщения штрихов в WebSocket.send. Найдя штрих,
    // Solution: we intercept OUTGOING stroke messages in WebSocket.send. Having found a stroke,
    // сопоставляем его с записанным «живым» профилем нажима (та же геометрия/цвет) и
    // we match it with the recorded "live" pressure profile (the same geometry/color) and
    // заменяем ОДИН штрих на несколько подряд идущих «подштрихов» — квантованной шириной
    // replace ONE stroke with several consecutive "sub-strokes" - with a width quantized
    // по нажиму (размер в протоколе задаётся на каждый штрих и может быть произольным
    // by pressure (the size in the protocol is set per stroke and can be an arbitrary
    // числом — приём подтверждён сторонними инструментами с произвольной толщиной).
    // number - the technique is confirmed by third-party tools with arbitrary thickness).
    // Первый подштрих сохраняет id исходного штриха, остальные получают уникальные id.
    // The first sub-stroke keeps the original stroke's id, the others get unique ids.
    // Формат менялся игрой, поэтому распознавание СТРОГОЕ: любое несоответствие —
    // The format was changed by the game, so the recognition is STRICT: any mismatch -
    // сообщение проходит без изменений (безопасный проход). Промежуточные/неполные
    // the message passes unchanged (a safe pass-through). Intermediate/incomplete
    // куски не трогаем (замена только полного штриха: совпадает конец линии).
    // pieces are not touched (only a full stroke is replaced: the line end matches).
    // =====================================================
    const PressurePublish = (() => {
        const KEY = 'gpUiPublish.v1';
        // публикация нажима по сети — экспериментальная функция и по умолчанию
        // publishing pressure over the network is an experimental feature and by default
        // ВЫКЛЮЧЕНА (вмешательство в игровой протокол). Включается только вручную.
        // DISABLED (interference with the game protocol). Enabled only manually.
        const DEF = { enabled: false };
        let cfg = Object.assign({}, DEF), loaded = false;
        const save = makeSaver(KEY, 'publish', () => cfg);
        function load() { if (loaded) return; loaded = true; const o = readStoreKey(KEY); if (o && typeof o === 'object' && typeof o.enabled === 'boolean') cfg.enabled = o.enabled; }

        const stats = { msgs: 0, stroke: 0, shape: 0, replaced: 0, sent: 0, nomatch: 0, uniform: 0, d1: 0, d2: 0, d3: 0, chunk: 0, pref: 0, dot: 0 };
        const samples = [];              // последние сетевые сообщения — образцы для «Диагностики» | the latest network messages - samples for "Diagnostics"
        const ID_BASE = 900000 + Math.floor(Math.random() * 90000);
        let idShift = 0;
        const usedIds = new Set();
        const sentGroups = new Map(); // original id -> { ids: [...], at }
        function nextSyntheticId() {
            let id;
            do { id = ID_BASE + (idShift++); } while (usedIds.has(id));
            if (usedIds.size > 4000) {
                // Вытесняем СТАРЕЙШУЮ половину (Set хранит порядок вставки), а не очищаем всё:
                // We evict the OLDEST half (a Set keeps insertion order) rather than clearing everything:
                // полная очистка могла выдать заново id ещё живого подштриха.
                // a full clear could re-issue the id of a still-live sub-stroke.
                let n = 2000;
                for (const x of usedIds) { usedIds.delete(x); if (--n <= 0) break; }
            }
            usedIds.add(id);
            return id;
        }
        // если игра шлёт штрих КУСКАМИ (поток при рисовании): id -> { live, arc (в единицах живого штриха), at }
        // if the game sends the stroke IN PIECES (a stream while drawing): id -> { live, arc (in live-stroke units), at }
        const chunkMap = new Map();

        function active() {
            load();
            if (cfg.enabled === false) return false;
            // публикуем и нажим пера, и «тонкую кисть» (толщина < 100%) — иначе у других игроков
            // we publish both the pen pressure and the "thin brush" (thickness < 100%) - otherwise other players
            // останется стандартная толщина игры, даже если локально линия тоньше
            // will keep the game's standard thickness even if the line is thinner locally
            let pw = false, th = 100;
            try { pw = PressureSettings.pressureWanted(); } catch (e) { }
            try { const c = BrushSettings.getConfig(); th = c && typeof c.thickness === 'number' ? c.thickness : 100; } catch (e) { }
            return pw || th !== 100;
        }

        // --------- геометрия ----------
        // --------- geometry ----------
        function hexOf(s) {
            try {
                if (typeof s !== 'string') return null;
                s = s.trim().toLowerCase();
                let m = s.match(/^#([0-9a-f]{3})$/);
                if (m) return parseInt(m[1][0] + m[1][0] + m[1][1] + m[1][1] + m[1][2] + m[1][2], 16);
                m = s.match(/^#([0-9a-f]{6})/);
                if (m) return parseInt(m[1], 16);
                m = s.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
                if (m) return (m[1] << 16) + (m[2] << 8) + (+m[3]);
            } catch (e) { /* ignore */ }
            return null;
        }
        const cumOf = pts => { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return c; };
        function ptAt(pts, cum, t) {
            if (t <= 0) return pts[0];
            for (let i = 1; i < pts.length; i++) {
                if (cum[i] >= t) {
                    const d = cum[i] - cum[i - 1] || 1e-9, k = (t - cum[i - 1]) / d;
                    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
                }
            }
            return pts[pts.length - 1];
        }
        // нормируем полилинию: начало в (0,0), масштаб — диагональ bbox. Единицы не важны.
        // we normalize the polyline: the start at (0,0), the scale - the bbox diagonal. Units do not matter.
        function normPoly(pts) {
            const p0 = pts[0];
            let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
            for (const p of pts) { const x = p[0] - p0[0], y = p[1] - p0[1]; if (x < mnx) mnx = x; if (y < mny) mny = y; if (x > mxx) mxx = x; if (y > mxy) mxy = y; }
            const diag = Math.hypot(mxx - mnx, mxy - mny) || 1;
            return pts.map(p => [(p[0] - p0[0]) / diag, (p[1] - p0[1]) / diag]);
        }
        // одна ли это форма: ОБЕ полилинии уже в нормализованном пространстве живого штриха
        // whether it is one shape: BOTH polylines are already in the live stroke's normalized space
        // (x/ширину, y/высоту холста). Конец обязан совпасть — иначе это кусок штриха.
        // (x/width, y/canvas height). The end must match - otherwise it is a piece of a stroke.
        function devAlong(a, ac, b, bc, L) {
            let maxDev = 0;
            const S = 14;
            for (let i = 0; i <= S; i++) {
                const t = L * i / S;
                const pa = ptAt(a, ac, t), pb = ptAt(b, bc, t);
                maxDev = Math.max(maxDev, Math.hypot(pa[0] - pb[0], pa[1] - pb[1]));
            }
            return maxDev;
        }
        function sameShape(np, nc, r) {
            if (!r || !(r.total > 0) || !r.pts || r.pts.length < 2) return false;
            const nt = nc[nc.length - 1];
            if (!(nt > 0)) return false;
            const e1 = np[np.length - 1], e2 = r.pts[r.pts.length - 1];
            if (Math.hypot(e1[0] - e2[0], e1[1] - e2[1]) > 0.03) return false; // конец совпадает | the end matches
            const L = Math.min(nt, r.total);
            if (L < r.total * 0.5) return false; // финал сильно короче живого — не тот штрих | the final is much shorter than the live stroke - a different stroke
            return devAlong(np, nc, r.pts, r.cum, L) < 0.025;
        }
        // ПРЕФИКС-совпадение: сообщение — НАЧАЛО живого штриха (игра шлёт штрих кусками?).
        // PREFIX match: the message is the BEGINNING of the live stroke (the game sends the stroke in pieces?).
        // Обе полилинии в нормализованном пространстве. Возвращает покрытую дугу или 0.
        // Both polylines in normalized space. Returns the covered arc or 0.
        function prefMatch(np, nc, r) {
            if (!r || !(r.total > 0) || !r.pts || r.pts.length < 2 || np.length < 3) return 0;
            const nt = nc[nc.length - 1];
            if (!(nt > 0)) return 0;
            if (nt > r.total * 1.05) return 0; // длиннее живого — не префикс | longer than the live one - not a prefix
            const s1 = np[0], s2 = r.pts[0];
            if (Math.hypot(s1[0] - s2[0], s1[1] - s2[1]) > 0.02) return 0; // начало совпадает | the beginning matches
            const L = Math.min(nt, r.total);
            return devAlong(np, nc, r.pts, r.cum, L) < 0.03 ? nt : 0;
        }
        // множитель нажима живого штриха на доле дуги f (0..1)
        // the live stroke's pressure multiplier at arc fraction f (0..1)
        function facAt(r, f) {            const t = Math.max(0, Math.min(1, f)) * r.total;
            const c = r.cum, n = r.facs ? r.facs.length : 0;
            if (!n) return 1;
            for (let i = 1; i < c.length; i++) if (c[i] >= t) return r.facs[Math.min(n - 1, i - 1)];
            return r.facs[n - 1];
        }

        // --------- задержка одноточечных штампов ----------
        // --------- delaying single-point stamps ----------
        // Одноточечное сообщение (d:1) приходит ДО того, как живой штрих записан, и рисует
        // A single-point message (d:1) arrives BEFORE the live stroke is recorded and draws
        // на приёмнике «штамп» кисти исходного размера — это и есть жирные точки. Держим
        // a brush "stamp" of the original size on the receiver - those are the fat dots. We keep
        // такой штамп до появления полного штриха того же id (миллисекунды), правим размер
        // such a stamp until the full stroke of the same id appears (milliseconds), correct the size
        // по профилю нажима и отправляем ПЕРВЫМ, перед основным штрихом.
        // by the pressure profile and send it FIRST, before the main stroke.
        const heldStart = new Map(); // id штриха -> { arr, at } | stroke id -> { arr, at }
        const lastFull = new Map();  // id штриха -> { live, at }: уже обработанный полный штрих | stroke id -> { live, at }: an already processed full stroke
        const flushQ = [];          // штампы, отпущенные по таймауту | stamps released by timeout
        const HOLD_MS = 3000;
        function purgeHeld(now) {
            for (const [id, h] of heldStart) {
                if (now - h.at <= HOLD_MS) continue;
                heldStart.delete(id);
                try { flushQ.push('42' + JSON.stringify(h.arr)); } catch (e) { }
            }
            if (lastFull.size > 40) { for (const [id, e] of lastFull) if (now - e.at > 30000) lastFull.delete(id); }
        }
        // выпустить задержанный штамп ПЕРЕД основным сообщением штриха;
        // release the delayed stamp BEFORE the main stroke message;
        // main: undefined (пропустить) | строка | массив — результат обработки полного штриха
        // main: undefined (skip) | a string | an array - the result of processing the full stroke
        function releaseHeld(id, startSize, main, data) {
            const h = heldStart.get(id);
            if (!h) return main; // штампа не было — ведём себя как раньше | there was no stamp - we behave as before
            heldStart.delete(id);
            try {
                const st = h.arr && h.arr[2] && h.arr[2].v && h.arr[2].v[2];
                if (typeof startSize === 'number' && startSize > 0 && Array.isArray(st) &&
                    typeof st[1] === 'number' && startSize !== st[1]) {
                    st[1] = Math.max(1, Math.round(startSize)); // в сеть — ТОЛЬКО целые размеры | to the network - ONLY integer sizes
                    stats.dot++;
                }
                const f = '42' + JSON.stringify(h.arr);
                if (Array.isArray(main)) return [f].concat(main);
                if (typeof main === 'string') return [f, main];
                if (typeof data === 'string') return [f, data];
                return [f];
            } catch (e) { return main !== undefined ? main : undefined; }
        }

        // --------- перехват ----------
        // --------- the hook ----------
        // вернуть: undefined — пропустить как есть; строка — заменённое сообщение; массив — своя серия
        // return: undefined - pass as is; a string - the replaced message; an array - your own series
        function rewrite(data) {
            load();
            stats.msgs++;
            purgeHeld(Date.now()); // отпустить штампы, залежавшиеся дольше HOLD_MS | release stamps that have been held longer than HOLD_MS
            if (typeof data !== 'string' || data.charCodeAt(0) !== 52 || data.charCodeAt(1) !== 50 || data[2] !== '[') return;
            // канал динамический: 42[<channel>,7,{...}] — принимаем любой канал
            // the channel is dynamic: 42[<channel>,7,{...}] - we accept any channel
            const pm = /^42\[(\d+),(\d+),/.exec(data);
            if (!pm || +pm[2] !== 7) return;
            let arr = null;
            try { arr = JSON.parse(data.slice(2)); } catch (e) { return; }
            if (!Array.isArray(arr) || arr.length < 3 || typeof arr[0] !== 'number' || arr[1] !== 7) return;
            const ch = arr[0];
            const o = arr[2];
            if (!o || typeof o !== 'object') return;
            // счётчики типов d: 1 — штрих, 2 — отмена (v = голый id), 3 — конец штриха
            // type counters d: 1 - a stroke, 2 - an undo (v = a bare id), 3 - the end of a stroke
            if (o.d === 1) stats.d1++; else if (o.d === 2) stats.d2++; else if (o.d === 3) stats.d3++;
            if (o.d === 2) {
                // Отмена должна убрать не только исходный id, но и все синтетические
                // An undo must remove not only the original id but also all synthetic
                // подштрихи, которые мы отправили вместо него. Иначе остаются «сироты».
                // sub-strokes we sent instead of it. Otherwise "orphans" remain.
                const uid = Array.isArray(o.v) ? o.v[1] : o.v;
                if (typeof uid === 'number') {
                    heldStart.delete(uid);
                    lastFull.delete(uid);
                    chunkMap.delete(uid);
                    const rec = sentGroups.get(uid);
                    if (rec && Date.now() - rec.at < 120000 && rec.ids.length) {
                        sentGroups.delete(uid);
                        // Форма v сохраняется как у оригинала: если игра шлёт отмену
                        // The shape of v is preserved as in the original: if the game sends the undo
                        // массивом [tool, id], подштрихи отменяются так же, а не голым id.
                        // as an array [tool, id], the sub-strokes are undone the same way, not by a bare id.
                        const arrV = Array.isArray(o.v);
                        const head = arrV ? o.v[0] : undefined;
                        return rec.ids.slice().reverse().map(sid =>
                            '42' + JSON.stringify([ch, 7, Object.assign({}, o, { v: arrV ? [head, sid] : sid })])
                        );
                    }
                }
                return; // чужая/неизвестная отмена — пропускаем без изменений | someone else's/unknown cancel - we skip without changes
            }
            if (o.d !== 1 && o.d !== 3) return; // 1 — штрих, 3 — конец штриха (полные точки приходят в обоих) | 1 - a stroke, 3 - the end of a stroke (full points arrive in both)
            // кольцевой буфер образцов: ЛЮБОЕ исходящее 42[N,7,{d:1|d:3}] — даже при выключенном модуле
            // a ring buffer of samples: ANY outgoing 42[N,7,{d:1|d:3}] - even with the module disabled
            try { samples.push(data.slice(0, 260)); if (samples.length > 8) samples.shift(); } catch (e) { }
            if (!Array.isArray(o.v)) return;
            const v = o.v;
            if (!(v.length >= 4) || typeof v[0] !== 'number' || typeof v[1] !== 'number' ||
                !Array.isArray(v[2]) || typeof v[2][0] !== 'string' || typeof v[2][1] !== 'number') return;
            if (v[0] === 8) return; // заливка: payload — прямоугольники, не полилиния | flood fill: the payload is rectangles, not a polyline
            // координаты: пары [x,y] (старый формат, абсолютные) или плоский список чисел.
            // coordinates: pairs [x,y] (the old format, absolute) or a flat list of numbers.
            // АКТУАЛЬНЫЙ формат игры: x0,y0, затем ДЕЛЬТЫ (смещения от предыдущей точки):
            // The game's CURRENT format: x0,y0, then DELTAS (offsets from the previous point):
            // "1160,73,-6,6,-20,20,..." — подтверждено образцами из «Диагностики».
            // "1160,73,-6,6,-20,20,..." - confirmed by samples from "Diagnostics".
            let flat = false;
            let pts = [];
            let ok = true;
            for (let i = 3; i < v.length; i++) {
                const p = v[i];
                if (Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number') { pts.push([p[0], p[1]]); continue; }
                ok = false; break;
            }
            if (!ok) {
                const rest = v.slice(3);
                ok = rest.length >= 2 && rest.length % 2 === 0 && rest.every(n => typeof n === 'number');
                if (ok) {
                    flat = true;
                    pts.push([rest[0], rest[1]]); // первая точка — абсолютная | the first point is absolute
                    for (let i = 2; i < rest.length; i += 2) pts.push([pts[pts.length - 1][0] + rest[i], pts[pts.length - 1][1] + rest[i + 1]]);
                    // вылезли за разумные границы поля — значит это не дельты, а абсолютные координаты
                    // they went beyond reasonable field bounds - so these are not deltas but absolute coordinates
                    if (!pts.every(p => p[0] > -2000 && p[0] < 8000 && p[1] > -2000 && p[1] < 8000)) {
                        pts = [];
                        for (let i = 0; i < rest.length; i += 2) pts.push([rest[i], rest[i + 1]]);
                    }
                }
            }
            if (!ok || pts.length < 1) { stats.shape++; return; }
            stats.stroke++;
            // ОДНОТОЧЕЧНОЕ сообщение (начало/конец штриха). Игра рисует по нему «штамп»
            // A SINGLE-POINT message (the start/end of a stroke). The game draws a brush "stamp"
            // кисти ОРИГИНАЛЬНОГО размера — на тонком нажимном штрихе он остаётся жирной точкой.
            // of the ORIGINAL size from it - on a thin pressure stroke it remains a fat dot.
            // Масштабируем и его, по профилю нажима в этой точке живого штриха.
            // We scale it too, by the pressure profile at that point of the live stroke.
            if (pts.length < 2) {
                // одноточечное сообщение (штамп начала/конца штриха с ИСХОДНЫМ размером
                // a single-point message (a stamp of the stroke's start/end with the ORIGINAL size
                // кисти) приходит РАНЬШЕ, чем существует запись живого штриха — в момент его
                // of the brush) arrives EARLIER than the live stroke record exists - at the moment of its
                // отправки сравнивать не с чем (прежний фикс не срабатывал: точек=0).
                // sending there is nothing to compare with (the previous fix did not fire: points=0).
                // Решение: ЗАДЕРЖАТЬ его. Когда придёт полный штрих этого же id и сопоставится
                // Solution: DELAY it. When the full stroke of the same id arrives and matches
                // с профилем нажима — вычислим толщину начала и отправим штамп ПЕРВЫМ,
                // the pressure profile - we compute the starting thickness and send the stamp FIRST,
                // уже с правильным размером. Таймаут 3 с — страховка: тогда уйдёт как есть.
                // already with the correct size. A 3s timeout - a safety net: then it goes as is.
                if (!active()) return;
                const now1 = Date.now();
                purgeHeld(now1);
                // полный штрих этого id мы УЖЕ обработали: одиночная точка после него —
                // we have ALREADY processed the full stroke of this id: a single point after it -
                // конечный штамп; правим сразу по профилю того же живого штриха
                // an ending stamp; we correct it right away by the same live stroke's profile
                const lf = lastFull.get(v[1]);
                if (lf && now1 - lf.at < 30000 && lf.live && lf.live.w > 0 && lf.live.h > 0) {
                    const r = lf.live;
                    const nx = pts[0][0] / r.w, ny = pts[0][1] / r.h;
                    const s0 = r.pts[0], e0 = r.pts[r.pts.length - 1];
                    const dS = Math.hypot(nx - s0[0], ny - s0[1]);
                    const dE = Math.hypot(nx - e0[0], ny - e0[1]);
                    if (dS <= 0.01 || dE <= 0.01) { // точка совпадает с началом или концом | the point matches the start or the end
                        const f = dS <= dE ? 0 : 1;
                        const qd = Math.max(1, Math.round(v[2][1] * facAt(r, f))); // целые | integer
                        if (qd !== v[2][1]) {
                            stats.dot++;
                            v[2][1] = qd;
                            return '42' + JSON.stringify(arr);
                        }
                        return; // размер и так правильный | the size is already correct
                    }
                }
                if (heldStart.size > 20) { // не копим | we do not accumulate
                    let oldest = null;
                    for (const [id2, h2] of heldStart) if (!oldest || h2.at < oldest[1].at) oldest = [id2, h2];
                    if (oldest) { heldStart.delete(oldest[0]); try { flushQ.push('42' + JSON.stringify(oldest[1].arr)); } catch (e) { } }
                }
                heldStart.set(v[1], { arr: arr, at: now1 });
                return { drop: true };
            }
            if (!active()) return;
            const cum = cumOf(pts), total = cum[cum.length - 1];
            if (!(total > 0)) return;
            // ищем «живой» штрих: переводим сетевые точки в нормализованное пространство
            // we look for the "live" stroke: we convert the network points into the normalized space
            // живого штриха (x/ширину, y/высоту холста) и сравниваем формы
            // of the live stroke (x/width, y/canvas height) and compare the shapes
            let list = [];
            try { list = BrushSettings.liveStrokes(); } catch (e) { return; }
            const col = hexOf(v[2][0]);
            const size = v[2][1];
            let live = null, np = null, nc = null, ntot = 0;
            const now = Date.now();
            for (const r of list) {
                if (now - r.at > 30000) continue;
                const rc = hexOf(r.style);
                if (col !== null && rc !== null && col !== rc) continue;
                if (!(r.w > 0) || !(r.h > 0)) continue;
                const np2 = pts.map(p => [p[0] / r.w, p[1] / r.h]);
                const nc2 = cumOf(np2);
                if (!(nc2[nc2.length - 1] > 0)) continue;
                if (!sameShape(np2, nc2, r)) continue;
                live = r; np = np2; nc = nc2; ntot = nc2[nc2.length - 1]; break;
            }
            if (!live) {
                // полного совпадения нет: возможно, игра шлёт штрих КУСКАМИ — пробуем префикс
                // no full match: possibly the game sends the stroke IN PIECES - we try a prefix
                for (const r of list) {
                    if (now - r.at > 30000) continue;
                    const rc = hexOf(r.style);
                    if (col !== null && rc !== null && col !== rc) continue;
                    if (!(r.w > 0) || !(r.h > 0)) continue;
                    const np2 = pts.map(p => [p[0] / r.w, p[1] / r.h]);
                    const nc2 = cumOf(np2);
                    const arc = prefMatch(np2, nc2, r);
                    if (!arc) continue;
                    // уже начатый кусок этого id — продолжаем тот же живой штрих
                    // an already started piece of this id - we continue the same live stroke
                    let ch2 = chunkMap.get(v[1]);
                    if (!ch2 || ch2.live !== r) { ch2 = { live: r, arc: 0, at: now }; chunkMap.set(v[1], ch2); }
                    if (chunkMap.size > 40) { // не копим | we do not accumulate
                        for (const [k2, e2] of chunkMap) if (now - e2.at > 60000) chunkMap.delete(k2);
                    }
                    const fMid = Math.min(1, (ch2.arc + arc / 2) / r.total);
                    ch2.arc += arc;
                    const q2 = Math.max(1, Math.round(size * facAt(r, fMid))); // целые | integer
                    stats.pref++;
                    if (q2 !== size) {
                        stats.chunk++;
                        v[2][1] = q2;
                        return releaseHeld(v[1], q2, '42' + JSON.stringify(arr), data);
                    }
                    return releaseHeld(v[1], size, undefined, data); // множитель 1 — не трогаем | multiplier 1 - do not touch
                }
                stats.nomatch++;
                return releaseHeld(v[1], size, undefined, data); // штамп отпускаем как есть | we release the stamp as is
            }
            // плавность БЕЗ дробных размеров (.10 с дробными ЛОМАЛА ИГРУ — приёмник
            // smoothness WITHOUT fractional sizes (fractional ones BROKE THE GAME - the receiver
            // ожидает целые размеры кисти; максимум подштрихов тоже возвращён к 8). Плавность
            // expects integer brush sizes; the maximum of sub-strokes was also returned to 8). Smoothness
            // теперь достигается размещением ГРАНИЦ: (1) профиль считается в дробных величинах
            // is now achieved by placing BOUNDARIES: (1) the profile is computed in fractional values
            // и сглаживается скользящим средним окна 5; (2) группы строятся по ДОПУСКУ 0.3 от
            // and smoothed with a sliding average of window 5; (2) groups are built by a TOLERANCE of 0.3 from
            // средней текущей группы (а не по точному равенству целых), ширина группы = средняя
            // the average of the current group (not by exact equality of integers), the group width = the average
            // её точек — уровни встают оптимально по профилю; (3) минимум 2 точки в группе
            // of its points - the levels settle optimally along the profile; (3) a minimum of 2 points in a group
            // (было 3) — короткий штрих получает 2-3 честных уровня вместо одной «средней».
            // (it was 3) - a short stroke gets 2-3 honest levels instead of one "average".
            // В СЕТЬ ОТПРАВЛЯЮТСЯ ТОЛЬКО ЦЕЛЫЕ РАЗМЕРЫ ≥1 — ровно как в эталоне.
            // ONLY INTEGER SIZES >= 1 ARE SENT TO THE NETWORK - exactly as in the reference.
            const q = nc.map((x, i) => Math.max(1, Math.round(10 * size * facAt(live, nc[i] / ntot)) / 10));
            const qs = q.map((_, i) => { // скользящее среднее окна 5 (у краёв окно меньше) | a sliding average over a window of 5 (a smaller window at the edges)
                const a = Math.max(0, i - 2), b = Math.min(q.length, i + 3);
                let s = 0; for (let j = a; j < b; j++) s += q[j];
                return s / (b - a);
            });
            let qmin = Infinity, qmax = -Infinity;
            for (const x of qs) { if (x < qmin) qmin = x; if (x > qmax) qmax = x; }
            if (qmax - qmin <= 0.15) { // профиль практически ровный — одна толщина | the profile is practically even - one thickness
                const qu = Math.max(1, Math.round((qmin + qmax) / 2));
                if (qu === size) return releaseHeld(v[1], size, undefined, data); // нажим не менял толщину — не трогаем | the press did not change the thickness - do not touch
                stats.uniform++;
                v[2][1] = qu;
                stats.replaced++;
                lastFull.set(v[1], { live: live, at: Date.now() });
                return releaseHeld(v[1], qu, '42' + JSON.stringify(arr), data);
            }
            // разбиваем на группы по допуску; стык — общая точка (+1 точка перекрытия на стык:
            // we split into groups by tolerance; the joint - a shared point (+1 overlap point at the joint:
            // игра сглаживает каждый подштрих ОТДЕЛЬНО, без перекрытия на стыках остаются щели)
            // the game smooths each sub-stroke SEPARATELY, without an overlap there are gaps at the joints)
            const TOL = 0.3;
            const groups = [];
            for (let i = 0; i < qs.length; i++) {
                const g = groups[groups.length - 1];
                if (g && Math.abs(qs[i] - g.q) <= TOL) { g.end = i; g.sum += qs[i]; g.q = g.sum / (g.end - g.start + 1); }
                else groups.push({ q: qs[i], start: i, end: i, sum: qs[i] });
            }
            // склейка одноточечных групп с соседом (мельчающие куски = швы)
            // merging single-point groups with a neighbour (tiny pieces = seams)
            const mergeInto = gi => {
                const prev = groups[gi - 1], next = groups[gi + 1];
                if (prev && (!next || (prev.end - prev.start) >= (next.end - next.start))) prev.end = groups[gi].end;
                else next.start = groups[gi].start;
                groups.splice(gi, 1);
            };
            for (let i = 0; i < groups.length && groups.length > 1; ) {
                if (groups[i].end - groups[i].start < 2) { mergeInto(i); continue; }
                i++;
            }
            // максимум 8 подштрихов (раньше было 16 — быстрее расходуются
            // a maximum of 8 sub-strokes (it used to be 16 - synthetic ids are used up faster
            // синтетические id и больше сообщений на штрих; конверт как в эталоне)
            // and there are more messages per stroke; the envelope as in the reference)
            while (groups.length > 8) {
                let mi = 0, ms = Infinity;
                for (let i = 0; i < groups.length; i++) { const L = groups[i].end - groups[i].start; if (L < ms) { ms = L; mi = i; } }
                mergeInto(mi);
            }
            // после склеек: пересчёт средних и слияние соседних групп с ОДИНАКОВОЙ целой
            // after merges: a recalculation of averages and a merge of neighbouring groups with the SAME integer
            // шириной (два подштриха одной толщины подряд = лишнее сообщение без информации)
            // width (two sub-strokes of the same thickness in a row = a redundant message without information)
            const recalc = g => { let s = 0, n2 = 0; for (let i = g.start; i <= g.end; i++) { s += qs[i]; n2++; } if (n2) g.q = s / n2; };
            for (let i = 0; i < groups.length; i++) recalc(groups[i]);
            for (let changed = true; changed; ) {
                changed = false;
                for (let i = 0; i + 1 < groups.length; i++) {
                    if (Math.max(1, Math.round(groups[i].q)) === Math.max(1, Math.round(groups[i + 1].q))) {
                        groups[i].end = groups[i + 1].end;
                        recalc(groups[i]);
                        groups.splice(i + 1, 1);
                        changed = true;
                    }
                }
            }
            const alpha = v[2].length > 2 && typeof v[2][2] === 'number' ? v[2][2] : null;
            const out = [], outIds = [];
            for (let gi = 0; gi < groups.length; gi++) {
                const g = groups[gi];
                const id = gi === 0 ? v[1] : nextSyntheticId();
                outIds.push(id);
                // стык: начинаем на 1 точку РАНЬШЕ стыка (перекрытие), чтобы сглаживание
                // the joint: we start 1 point BEFORE the joint (an overlap) so that the smoothing
                // каждого подштриха не оставляло щели/перелома на границе
                // of each sub-stroke does not leave a gap/kink at the boundary
                const from = gi === 0 ? g.start : Math.max(0, groups[gi - 1].end - 1);
                const pl = [];
                for (let i = from; i <= g.end; i++) {
                    if (flat) {
                        // пересобираем В ТОМ ЖЕ дельта-формате: абсолютная точка, затем смещения
                        // we rebuild in the SAME delta format: an absolute point, then offsets
                        if (i === from) pl.push(pts[i][0], pts[i][1]);
                        else pl.push(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
                    }
                    else pl.push(v[3 + i]);
                }
                const gq = Math.max(1, Math.round(g.q)); // в сеть — только целые размеры | to the network - only integer sizes
                const st = alpha === null ? [v[2][0], gq] : [v[2][0], gq, alpha];
                // сохраняем исходный тип (d:1 или d:3) и все поля объекта сообщения,
                // we keep the original type (d:1 or d:3) and all the fields of the message object,
                // меняя только v — иначе теряются стили/служебные поля протокола
                // changing only v - otherwise the protocol's styles/service fields are lost
                out.push('42' + JSON.stringify([ch, 7, Object.assign({}, o, { v: [v[0], id, st].concat(pl) })]));
            }
            stats.replaced++;
            stats.sent += out.length;
            if (outIds.length > 1) {
                usedIds.add(v[1]);
                sentGroups.set(v[1], { ids: outIds, at: Date.now() });
                if (sentGroups.size > 200) {
                    const now2 = Date.now();
                    for (const [k2, e2] of sentGroups) if (now2 - e2.at > 120000) sentGroups.delete(k2);
                }
            }
            lastFull.set(v[1], { live: live, at: Date.now() });
            return releaseHeld(v[1], Math.max(1, Math.round(groups[0].q)), out, data);
        }

        let installed = false, installErr = '', lastSocket = null, flushTimer = 0;
        function install() {
            // ГЛАВНЫЙ ФИКС: перехват надо ставить в ПРОТОТИП СТРАНИЦЫ (unsafeWindow),
            // THE MAIN FIX: the hook must be installed on the PAGE PROTOTYPE (unsafeWindow),
            // а не песочницы юзерскрипта — игра создаёт WebSocket в контексте страницы,
            // not in the userscript sandbox - the game creates the WebSocket in the page's context,
            // и window.WebSocket в песочнице его не видит. Раньше из-за этого сообщение игры
            // and window.WebSocket in the sandbox does not see it. Previously, because of this, the game's messages
            // не перехватывались ВООБЩЕ (при любом формате).
            // were not intercepted AT ALL (with any format).
            const PW = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
            const WSP = PW.WebSocket && PW.WebSocket.prototype;
            if (!WSP || typeof WSP.send !== 'function') { installErr = 'прототип WebSocket страницы недоступен'; return; }
            if (WSP.send.__gpuePub) { installed = true; return; }
            const orig = WSP.send;
            const fn = function (data) {
                lastSocket = this;
                try {
                    const r = rewrite(data);
                    if (r && r.drop) { // штамп задержан — оригинал не отправляем | the stamp is delayed - we do not send the original
                        if (flushQ.length) { const fl = flushQ.slice(); flushQ.length = 0; for (const m of fl) orig.call(this, m); }
                        return;
                    }
                    let seq = null;
                    if (typeof r === 'string') seq = [r];
                    else if (Array.isArray(r)) seq = r.slice();
                    if (flushQ.length) { // штампы, отпущенные по таймауту, уходят первыми | stamps released by timeout go first
                        const fl = flushQ.slice(); flushQ.length = 0;
                        seq = fl.concat(seq || [data]);
                    }
                    if (seq) { for (const m of seq) orig.call(this, m); return; }
                } catch (e) { /* никогда не ломаем игру: идём как есть */ }
                return orig.call(this, data);
            };
            try { fn.__gpuePub = true; } catch (e) { /* Greasemonkey: свойство нельзя — ставим через exportFunction */ }
            try {
                let target = fn;
                if (typeof exportFunction === 'function') { try { target = exportFunction(fn, PW); } catch (e2) { /* Tampermonkey: не нужен */ } }
                WSP.send = target;
                installed = true;
                // Таймер на HOLD_MS: одиночный «штамп» не должен зависнуть навсегда,
                // A timer for HOLD_MS: a single "stamp" must not hang forever
                // если после него больше не придёт ни одного сообщения.
                // if no more messages arrive after it.
                // Когда отправлять нечего, интервал снимается и создаётся заново
                // When there is nothing to send, the interval is removed and created anew
                // при следующем штампе (не тикает вхолостую до выгрузки страницы).
                // at the next stamp (it does not tick idly until the page is unloaded).
                if (!flushTimer) {
                    flushTimer = setInterval(() => {
                        if (!heldStart.size && !flushQ.length) { clearInterval(flushTimer); flushTimer = 0; return; }
                        purgeHeld(Date.now());
                        if (!flushQ.length || !lastSocket) return;
                        const fl = flushQ.splice(0);
                        for (const m of fl) { try { orig.call(lastSocket, m); } catch (e) { /* ignore */ } }
                    }, 500);
                }
            } catch (e) { installErr = 'не удалось заменить send: ' + (e && e.message ? e.message : e); }
        }
        install(); // document-start: раньше сокета игры | document-start: earlier than the game socket
        // Если прототип WebSocket ещё не создан/недоступен, пробуем позже:
        // If the WebSocket prototype is not created/unavailable yet, we try later:
        // document-start не гарантирует готовность page-realm API во всех менеджерах.
        // document-start does not guarantee page-realm API readiness in all managers.
        if (!installed) {
            let tries = 0;
            const retry = () => {
                if (installed || tries++ >= 10) return;
                install();
                if (!installed) setTimeout(retry, 1000);
            };
            setTimeout(retry, 500);
        }

        function row() {
            load();
            const r = uiSwitch('Передавать нажим другим игрокам (экспериментально)', v => { cfg.enabled = v !== false; save(); });
            r.set(cfg.enabled !== false);
            return r.row;
        }
        return {
            row, install,
            getDiag: () => ({
                on: active(), installed: installed, installErr: installErr,
                msgs: stats.msgs, stroke: stats.stroke, replaced: stats.replaced,
                sent: stats.sent, nomatch: stats.nomatch, shape: stats.shape, uniform: stats.uniform,
                d1: stats.d1, d2: stats.d2, d3: stats.d3, pref: stats.pref, chunk: stats.chunk, dot: stats.dot,
                held: heldStart.size
            })
        };
    })();

    // =====================================================
    // CanvasPan: перемещение вида холста при увеличении (по умолчанию - правой кнопкой мыши).
    // CanvasPan: panning the canvas view when zoomed in (by default - with the right mouse button).
    //
    // Своего панорамирования у игры в коде редактора не обнаружено (у неё есть только зум Ctrl+колесом, см.
    // No native panning of the game was found in the editor's code (it only has Ctrl+wheel zoom, see
    // комментарий к getOwnScaleFor), поэтому используется визуальный сдвиг: CSS-свойство translate на области
    // the comment on getOwnScaleFor), so a visual shift is used: the CSS translate property on the
    // холста. Это та же операция, что X/Y во вкладке «Раскладка»: положение уже входит в getBoundingClientRect
    // canvas area. This is the same operation as X/Y in the "Layout" tab: the position is already included in getBoundingClientRect
    // холста, поэтому код коррекции координат сдвиг учитывает сам и не менялся. Свойство translate складывается
    // of the canvas, so the coordinate correction code accounts for the shift by itself and was not changed. The translate property adds up
    // с transform раскладки и не трогает state.elements. Сдвиг живёт только в памяти (сессия).
    // with the layout transform and does not touch state.elements. The shift lives only in memory (a session).
    //
    // События игры не блокируются: ПКМ доходит до игры как раньше. Контекстное меню подавляется только на
    // The game's events are not blocked: the RMB reaches the game as before. The context menu is suppressed only on
    // холсте и только после реального перетаскивания (preventDefault, без остановки события). Исключение -
    // the canvas and only after a real drag (preventDefault, without stopping the event). An exception -
    // выбранный пользователем режим «Пробел + ЛКМ»: на время такого жеста нажатие ЛКМ до игры не доходит,
    // the user-selected "Space + LMB" mode: during such a gesture the LMB press does not reach the game,
    // иначе игра начала бы линию (тот же приём, что у режима редактирования).
    // otherwise the game would start a line (the same technique as in the editing mode).
    // =====================================================
    const CanvasPan = (() => {
        const KEY = 'gpUiPan.v1';
        const TARGETS = { core: '.draw .core', container: '.draw .drawingContainer' };
        const BUTTONS = ['right', 'middle', 'space'];
        const DEF = { enabled: false, button: 'right', onlyZoomed: true, bounds: true, target: 'core', rightExclusive: true };
        const STYLE_ID = 'gpue-pan-style', CURSOR_STYLE_ID = 'gpue-pan-cursor-style';
        const THRESHOLD = 4;
        let cfg = Object.assign({}, DEF), loaded = false;
        const view = { x: 0, y: 0, canvas: null };
        let g = null, suppressUntil = 0, spaceHeld = false, spaceClickUntil = 0, watchT = 0, lastSuppressed = null;
        const handlers = [];
        let ui = null, uiT = 0;
        const save = makeSaver(KEY, 'pan', () => cfg);

        function sanitize(o) {
            const r = Object.assign({}, DEF);
            if (!o || typeof o !== 'object') return r;
            r.enabled = !!o.enabled;
            if (BUTTONS.includes(o.button)) r.button = o.button;
            r.onlyZoomed = o.onlyZoomed !== false;
            r.bounds = o.bounds !== false;
            if (TARGETS[o.target]) r.target = o.target;
            r.rightExclusive = o.rightExclusive !== false;
            return r;
        }
        function load() { if (loaded) return; loaded = true; cfg = sanitize(readStoreKey(KEY)); }

        const targetEl = () => document.querySelector(TARGETS[cfg.target]);
        // px экрана на 1 CSS px в системе координат родителя цели: translate работает именно в ней
        // screen px per 1 CSS px in the target parent's coordinate system: translate works exactly in it
        function parentScale(el) {
            const p = el && el.parentElement;
            if (!p || !p.offsetWidth || !p.offsetHeight) return { kx: 1, ky: 1 };
            const r = p.getBoundingClientRect();
            const ok = k => isFinite(k) && k > 0.05 && k < 50;
            const kx = r.width / p.offsetWidth, ky = r.height / p.offsetHeight;
            return { kx: ok(kx) ? kx : 1, ky: ok(ky) ? ky : 1 };
        }
        // Увеличение холста относительно масштаба экрана игры: раскладка (W/H холста) × родной зум игры
        // Canvas zoom relative to the game's screen scale: the layout (the canvas W/H) × the game's native zoom
        function zoom() {
            const cv = drawCanvasEl(), core = document.querySelector('.draw .core');
            if (!cv || !core || !cv.offsetWidth) return 0;
            const r = cv.getBoundingClientRect();
            const k = r.width / (cv.offsetWidth * parentScale(core).kx);
            return isFinite(k) && k > 0 ? k : 0;
        }
        const isZoomed = () => zoom() > 1.01;

        function apply() {
            const on = cfg.enabled && (view.x || view.y);
            const css = on ? TARGETS[cfg.target] + '{translate:' + (Math.round(view.x * 100) / 100) + 'px ' + (Math.round(view.y * 100) / 100) + 'px !important}' : '';
            let st = document.getElementById(STYLE_ID);
            if (!st && css) {
                st = document.createElement('style');
                st.id = STYLE_ID;
                (document.head || document.documentElement).appendChild(st);
            }
            if (st && st.textContent !== css) st.textContent = css;
            syncWatch();
            syncSurround(on);
            refreshStatus();
        }
        function reset(say) {
            view.x = view.y = 0;
            apply();
            if (say) uiToast('Вид холста сброшен', 'info', 1600);
        }

        // --------- «окно» холста при сдвиге ----------
        // --------- the canvas "window" when shifted ----------
        // Пока вид сдвинут, холст показывается только в своём прежнем окне (где он стоял без сдвига), пространство
        // While the view is shifted, the canvas is shown only in its former window (where it was without the shift); the space
        // окна вне холста закрашено серым, холст белый, по краю тонкая рамка. Всё только визуально:
        // of the window outside the canvas is painted grey, the canvas is white, with a thin frame along the edge. Everything is purely visual:
        // clip-path, фон и outline не меняют ни размеры, ни координаты, ни getBoundingClientRect.
        // clip-path, background and outline change neither sizes, nor coordinates, nor getBoundingClientRect.
        const SUR_ID = 'gpue-pan-surround', CLIP_STYLE_ID = 'gpue-pan-clip-style';
        const GRAY = '#8d9099';
        let surRaf = 0, sur = null, clipCss = '', win = null;
        function setStyle(id, css) {
            let st = document.getElementById(id);
            if (!st && css) {
                st = document.createElement('style');
                st.id = id;
                (document.head || document.documentElement).appendChild(st);
            }
            if (st && st.textContent !== css) st.textContent = css;
        }
        function syncSurround(on) {
            if (on && !surRaf) surRaf = requestAnimationFrame(surroundFrame);
            if (!on) {
                cancelAnimationFrame(surRaf);
                surRaf = 0;
                win = null;
                clipCss = '';
                setStyle(CLIP_STYLE_ID, '');
                if (sur) { sur.remove(); sur = null; }
            }
        }
        function ensureSur() {
            if (sur && sur.isConnected) return sur;
            sur = document.createElement('div');
            sur.id = SUR_ID;
            sur.setAttribute('aria-hidden', 'true');
            sur.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147482990';
            for (let i = 0; i < 4; i++) {
                const p = document.createElement('div');
                p.style.cssText = 'position:fixed;pointer-events:none;background:' + GRAY + ';display:none';
                sur.appendChild(p);
            }
            document.body.appendChild(sur);
            return sur;
        }
        const r1 = v => Math.round(v * 10) / 10;
        function surroundFrame() {
            surRaf = 0;
            if (document.hidden) { surRaf = requestAnimationFrame(surroundFrame); return; }
            if (!cfg.enabled || !(view.x || view.y)) { syncSurround(false); return; }
            const cv = drawCanvasEl(), el = targetEl();
            if (cv && el && el.offsetWidth && el.offsetHeight) {
                const k = parentScale(el);
                const px = view.x * k.kx, py = view.y * k.ky;
                const cr = cv.getBoundingClientRect();
                // окно без сдвига: прямоугольник холста до сдвига, обрезанный предками (сдвинутые предки - тоже до сдвига)
                // the window without a shift: the canvas rectangle before the shift, clipped by ancestors (shifted ancestors - also before the shift)
                const base = { left: cr.left - px, top: cr.top - py, right: cr.right - px, bottom: cr.bottom - py };
                win = visibleRectOf(cv, a => (el.contains(a) ? [px, py] : [0, 0]), base);
                // обрезаем сдвигаемый элемент по окну (inset в его собственной системе координат)
                // we clip the shifted element by the window (an inset in its own coordinate system)
                const tr = el.getBoundingClientRect();
                const sx = tr.width / el.offsetWidth, sy = tr.height / el.offsetHeight;
                const ins = [
                    Math.max(0, (win.top - tr.top) / sy), Math.max(0, (tr.right - win.right) / sx),
                    Math.max(0, (tr.bottom - win.bottom) / sy), Math.max(0, (win.left - tr.left) / sx)
                ].map(r1);
                const css = TARGETS[cfg.target] + '{clip-path:inset(' + ins.join('px ') + 'px) !important}' +
                    DRAW_CANVAS_SEL + '{background-color:#fff !important;outline:1px solid rgba(0,0,0,.35) !important}';
                if (css !== clipCss) { clipCss = css; setStyle(CLIP_STYLE_ID, css); }
                // серое пространство: окно минус видимая часть холста
                // the grey space: the window minus the visible part of the canvas
                const vL = Math.max(cr.left, win.left), vT = Math.max(cr.top, win.top), vR = Math.min(cr.right, win.right), vB = Math.min(cr.bottom, win.bottom);
                const empty = vR <= vL || vB <= vT;
                const parts = empty ? [[win.left, win.top, win.right, win.bottom]] : [
                    [win.left, win.top, win.right, vT],
                    [win.left, vB, win.right, win.bottom],
                    [win.left, vT, vL, vB],
                    [vR, vT, win.right, vB]
                ];
                const s = ensureSur();
                for (let i = 0; i < 4; i++) {
                    const p = s.children[i], q = parts[i];
                    const show = !!q && q[2] - q[0] > 0.5 && q[3] - q[1] > 0.5;
                    const cssText = show ? 'left:' + r1(q[0]) + 'px;top:' + r1(q[1]) + 'px;width:' + r1(q[2] - q[0]) + 'px;height:' + r1(q[3] - q[1]) + 'px;display:block' : 'display:none';
                    if (p.dataset.k !== cssText) {
                        p.dataset.k = cssText;
                        if (show) { p.style.left = r1(q[0]) + 'px'; p.style.top = r1(q[1]) + 'px'; p.style.width = r1(q[2] - q[0]) + 'px'; p.style.height = r1(q[3] - q[1]) + 'px'; p.style.display = 'block'; }
                        else p.style.display = 'none';
                    }
                }
            }
            surRaf = requestAnimationFrame(surroundFrame);
        }
        // Холст сменился (новый раунд) - сдвиг сбрасываем
        // The canvas changed (a new round) - we reset the shift
        function syncWatch() {
            const need = !!(view.x || view.y);
            if (need && !watchT) {
                watchT = setInterval(() => {
                    const cv = drawCanvasEl();
                    if (!cv || cv !== view.canvas || !cv.isConnected) reset(false);
                }, 1000);
            } else if (!need && watchT) { clearInterval(watchT); watchT = 0; }
        }
        // Ограничение: холст не уходит за край видимой области дальше, чем на поле в 120 px
        // A limit: the canvas does not go past the edge of the visible area further than by a margin of 120 px
        function clampView(nx, ny, k) {
            if (!cfg.bounds) return [nx, ny];
            const cv = drawCanvasEl();
            if (!cv) return [nx, ny];
            const el = targetEl();
            if (!el) return [nx, ny];
            const r = cv.getBoundingClientRect();
            const px = view.x * k.kx, py = view.y * k.ky;
            const l0 = r.left - px, t0 = r.top - py;
            // окно - то же, что видно без сдвига (см. surroundFrame)
            // the window - the same as what is visible without a shift (see surroundFrame)
            const w0 = visibleRectOf(cv, a => (el.contains(a) ? [px, py] : [0, 0]), { left: l0, top: t0, right: l0 + r.width, bottom: t0 + r.height });
            if (!w0.width || !w0.height) return [nx, ny];
            const M = 40; // столько серого допускается у края | how much gray is allowed at the edge
            // холст больше окна - он должен закрывать окно; меньше или равен - двигается в пределах окна
            // the canvas is larger than the window - it must cover the window; smaller or equal - it moves within the window
            const axis = (start, size, wStart, wEnd) => (size >= wEnd - wStart
                ? [wEnd - size - M - start, wStart + M - start]
                : [wStart - M - start, wEnd - size + M - start]);
            const ax = axis(l0, r.width, w0.left, w0.right), ay = axis(t0, r.height, w0.top, w0.bottom);
            return [clamp(nx, ax[0] / k.kx, ax[1] / k.kx), clamp(ny, ay[0] / k.ky, ay[1] / k.ky)];
        }

        // --------- жест ----------
        // --------- the gesture ----------
        function matches(e) {
            if (cfg.button === 'right') return e.button === 2;
            if (cfg.button === 'middle') return e.button === 1;
            return e.button === 0 && spaceHeld && (!e.pointerType || e.pointerType === 'mouse');
        }
        function onDown(e) {
            if (!cfg.enabled || editMode || g || !matches(e) || isOurs(e.target)) return;
            const p = rawXY(e);
            const cv = drawCanvasEl();
            if (!cv || !inRect(p[0], p[1], cv.getBoundingClientRect())) return;
            // панорамирование возможно ТОЛЬКО когда холст реально увеличен.
            // Panning is possible ONLY when the canvas is actually zoomed in.
            // Без увеличения холст полностью статичен: жест не начинается, событие не блокируется.
            // Without zooming the canvas is fully static: the gesture does not start, the event is not blocked.
            if (!isZoomed()) return;
            const el = targetEl();
            if (!el) return;
            if (view.canvas !== cv) { view.canvas = cv; view.x = view.y = 0; apply(); }
            g = { id: e.pointerId, sx: p[0], sy: p[1], ox: view.x, oy: view.y, k: parentScale(el), dragging: false, block: cfg.button === 'space' || (cfg.button === 'right' && cfg.rightExclusive) };
            if (g.block) {
                // «Пробел + ЛКМ» и ПКМ (игра рисует правой кнопкой - проверено зондом в игре): нажатие до игры не доходит,
                // "Space + LMB" and RMB (the game draws with the right button - verified by the probe in the game): the press does not reach the game,
                // иначе она начала бы линию (отменённый pointerdown не порождает mousedown)
                // otherwise it would start a line (a cancelled pointerdown does not produce mousedown)
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        }
        function onMove(e) {
            if (!g || e.pointerId !== g.id) return;
            // режим «Пробел + ЛКМ» — обе кнопки должны удерживаться одновременно.
            // the "Space + LMB" mode - both buttons must be held simultaneously.
            // Отпустили пробел (а keyup по какой-то причине не поймали) — жест сразу заканчивается.
            // The space was released (and the keyup was not caught for some reason) - the gesture ends immediately.
            if (cfg.button === 'space' && !spaceHeld) { onUp(null); return; }
            const p = rawXY(e);
            const dx = p[0] - g.sx, dy = p[1] - g.sy;
            if (!g.dragging) {
                if (Math.hypot(dx, dy) < THRESHOLD) return;
                g.dragging = true;
                document.documentElement.classList.add('gpue-panning');
            }
            const c = clampView(g.ox + dx / g.k.kx, g.oy + dy / g.k.ky, g.k);
            view.x = c[0];
            view.y = c[1];
            apply();
        }
        function onUp(e) {
            if (!g || (e && e.pointerId !== undefined && e.pointerId !== g.id)) return;
            const was = g.dragging, space = g.block;
            g = null;
            document.documentElement.classList.remove('gpue-panning');
            if (was && cfg.button === 'right') suppressUntil = performance.now() + 1000;
            if (space && e && e.type === 'pointerup') {
                e.preventDefault();
                e.stopImmediatePropagation();
                spaceClickUntil = performance.now() + 400;
            }
        }
        function onMouseBlock(e) {
            // жест, забранный у игры: подстраховка на случай, если браузер всё же прислал mousedown/mouseup/click
            // a gesture taken away from the game: a safety net in case the browser still sent mousedown/mouseup/click
            if ((g && g.block) || ((e.type === 'click' || e.type === 'auxclick') && performance.now() < spaceClickUntil)) {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        }
        function onMenu(e) {
            if (!suppressUntil) return;
            const late = performance.now() > suppressUntil;
            suppressUntil = 0;
            if (late) return;
            const p = rawXY(e);
            const cv = drawCanvasEl();
            if (cv && inRect(p[0], p[1], cv.getBoundingClientRect())) { e.preventDefault(); lastSuppressed = e; } // только меню; событие идёт дальше | the menu only; the event continues further
        }
        function onKey(e) {
            if (!cfg.enabled) return;
            if (e.type === 'keydown' && e.code === 'Digit0' && e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && !isEditableTarget(e.target)) {
                e.preventDefault();
                reset(true);
                return;
            }
            if (e.code === 'Space') {
                if (e.type === 'keydown') spaceHeld = cfg.button === 'space' && !isEditableTarget(e.target) && !isOurs(e.target);
                else {
                    // отпустили пробел во время жеста — сдвиг заканчивается немедленно
                    // the space was released during the gesture - the shift ends immediately
                    spaceHeld = false;
                    if (g && cfg.button === 'space') onUp(null);
                }
            }
        }
        const onBlur = () => { spaceHeld = false; onUp(null); };
        function attach() {
            if (handlers.length) return;
            const add = (t, type, fn, o) => { t.addEventListener(type, fn, o); handlers.push([t, type, fn, o]); };
            add(window, 'pointerdown', onDown, { capture: true, passive: false });
            add(window, 'pointermove', onMove, { capture: true, passive: true });
            add(window, 'pointerup', onUp, { capture: true, passive: false });
            add(window, 'pointercancel', onUp, { capture: true, passive: true });
            add(window, 'mousedown', onMouseBlock, { capture: true, passive: false });
            add(window, 'mouseup', onMouseBlock, { capture: true, passive: false });
            add(window, 'click', onMouseBlock, { capture: true, passive: false });
            add(window, 'auxclick', onMouseBlock, { capture: true, passive: false });
            add(window, 'contextmenu', onMenu, { capture: true, passive: false });
            add(window, 'keydown', onKey, { capture: true });
            add(window, 'keyup', onKey, { capture: true });
            add(window, 'blur', onBlur, false);
        }
        function detach() {
            while (handlers.length) { const x = handlers.pop(); x[0].removeEventListener(x[1], x[2], x[3]); }
            g = null;
            spaceHeld = false;
            document.documentElement.classList.remove('gpue-panning');
        }
        function setEnabled(on) {
            cfg.enabled = !!on;
            save();
            if (cfg.enabled) attach(); else { detach(); reset(false); }
            refreshUi();
        }

        // --------- блок в «Оформлении» ----------
        // --------- the block in "Appearance" ----------
        function refreshStatus() {
            if (!ui || !ui.status) return;
            const z = zoom();
            ui.status.textContent = (z ? 'Увеличение холста ×' + z.toFixed(2) + (z > 1.01 ? '' : ' (не увеличен)') : 'Холст не найден (откройте экран рисования)') +
                ' · сдвиг ' + Math.round(view.x) + ', ' + Math.round(view.y);
        }
        function refreshUi() {
            if (!ui) return;
            ui.en.set(cfg.enabled);
            ui.btn.set(cfg.button);
            ui.hint.textContent = cfg.button === 'space'
                ? 'Холст двигается, только пока одновременно удерживаются пробел и ЛКМ: отпустили любую — сдвиг сразу заканчивается. Работает только при увеличенном холсте (Ctrl+колесо). На время жеста нажатие до игры не доходит, поэтому линия не начнётся.'
                : cfg.button === 'right' && cfg.rightExclusive
                    ? 'Удерживайте правую кнопку на увеличенном холсте и тяните. Игра рисует и правой кнопкой, поэтому, пока холст увеличен, правая кнопка на холсте только двигает вид и до игры не доходит.'
                    : 'Удерживайте ' + (cfg.button === 'right' ? 'правую' : 'среднюю') + ' кнопку на холсте и тяните. Клик без движения работает как в игре. Если игра при этом тоже рисует (см. «Диагностика», п. 5), выберите «Пробел + ЛКМ».';
        }
        function buildSection(sectionFn) {
            load();
            const u = {};
            u.en = uiSwitch('Перемещать холст при увеличении', v => setEnabled(v));
            u.btn = uiSelect('Кнопка', [['right', 'Правая (ПКМ)'], ['middle', 'Средняя'], ['space', 'Пробел + ЛКМ']], v => { cfg.button = v; spaceHeld = false; save(); refreshUi(); });
            // в настройках остались только включение и выбор кнопки.
            // only the toggle and the button choice remain in the settings.
            // Прочее поведение действует по умолчанию и не настраивается:
            // The rest of the behavior works by default and is not configurable:
            // границы окна (bounds=true), цель сдвига core, ПКМ-исключение при зуме, сброс Alt+0.
            // window bounds (bounds=true), the shift target core, the RMB exception when zoomed, the Alt+0 reset.
            u.hint = h('div', { class: 'gpue-hint' });
            const el = sectionFn('Перемещение холста', [
                u.en.row, u.btn.row, u.hint
            ], false);
            el.addEventListener('toggle', () => {
                clearInterval(uiT);
                uiT = el.open ? setInterval(refreshStatus, 1000) : 0;
                refreshStatus();
            });
            ui = u;
            refreshUi();
            return el;
        }

        function init() {
            const root = document.documentElement;
            load();
            if (root.getAttribute('data-gpe-pan') === '1') return;
            root.setAttribute('data-gpe-pan', '1');
            if (!document.getElementById(CURSOR_STYLE_ID)) {
                const st = document.createElement('style');
                st.id = CURSOR_STYLE_ID;
                st.textContent = 'html.gpue-panning, html.gpue-panning *{cursor:grabbing !important}';
                (document.head || document.documentElement).appendChild(st);
            }
            if (cfg.enabled) attach();
            refreshUi();
        }

        return {
            init, buildSection, reset, isZoomed, zoom,
            lastSuppressed: () => lastSuppressed,
            windowRect: () => (cfg.enabled && (view.x || view.y) ? win : null),
            getView: () => ({ x: view.x, y: view.y }),
            getDiag: () => ({ enabled: cfg.enabled, button: cfg.button, target: cfg.target, x: Math.round(view.x), y: Math.round(view.y), zoom: zoom() })
        };
    })();


    // =====================================================
    // GameProbe: исследование игры для «Диагностики» (только чтение).
    // GameProbe: game research for "Diagnostics" (read-only).
    //
    // По кнопке на ограниченное время ставит ПРОЗРАЧНЫЕ обёртки: они считают вызовы и передают аргументы и
    // On a button press, for a limited time, it installs TRANSPARENT wrappers: they count calls and pass arguments and
    // результат без изменений. Обёртки не пересекаются с перехватом кисти (stroke/arc/fill не трогаются).
    // the result through unchanged. The wrappers do not intersect with the brush hook (stroke/arc/fill are not touched).
    // Слушатели событий - passive, ничего не отменяют. Содержимое сетевых сообщений не читается, только размер.
    // Event listeners are passive, nothing is cancelled. The content of network messages is not read, only the size.
    // Отвечает на вопросы: зум/панорама, нажим в игре, способ рисования, отправка рисунка, правая кнопка мыши.
    // It answers the questions: zoom/pan, pressure in the game, the drawing method, drawing submission, the right mouse button.
    // =====================================================
    const GameProbe = (() => {
        const PW = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
        const wraps = [];
        const handlers = [];
        const subs = [];
        let on = false, internal = 0, stopT = 0, endsAt = 0, startedAt = 0;
        let d = fresh();
        let acc = null;

        function fresh() {
            return {
                gestures: [], cur: null, idle: {}, dataUrl: [], blob: [], getImage: 0, ws: 0, wsBytes: 0, wsIdle: 0, wsAfterDone: 0,
                doneClicks: 0, lastDone: 0, menu: 0, menuPrevented: 0, wheel: 0, wheelPrevented: 0, wheelCtrl: 0, wheelCtrlPrevented: 0,
                sizes: new Set(), styles: new Map()
            };
        }
        const isDrawCanvas = c => !!(c && c.closest && c.closest('.draw .drawingContainer'));
        const now = () => performance.now();
        const notify = () => subs.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });

        // --------- прозрачные обёртки ----------
        // --------- transparent wrappers ----------
        function wrap(proto, key, fn) {
            if (!proto || typeof proto[key] !== 'function') return;
            const rec = wraps.find(w => w.proto === proto && w.key === key);
            if (rec && rec.installed) return; // наша обёртка всё ещё в цепочке - она снова активна при on = true | our wrapper is still in the chain - it becomes active again when on = true
            const orig = proto[key];
            const w = function () {
                if (on && !internal) { try { fn(this, arguments); } catch (e) { /* зонд не должен мешать игре */ } }
                return orig.apply(this, arguments);
            };
            try { proto[key] = w; } catch (e) { return; }
            if (rec) Object.assign(rec, { orig, w, installed: true }); else wraps.push({ proto, key, orig, w, installed: true });
        }
        function unwrapAll() {
            for (const rec of wraps) {
                if (!rec.installed) continue;
                // если поверх нас уже стоит чужая обёртка, свою не снимаем: при on = false она прозрачна
                // if a foreign wrapper is already on top of us, we do not remove ours: with on = false it is transparent
                if (rec.proto[rec.key] === rec.w) { rec.proto[rec.key] = rec.orig; rec.installed = false; }
            }
        }
        function onCtx(name) {
            return (ctx, args) => {
                if (!isDrawCanvas(ctx.canvas)) return;
                const g = d.cur;
                const bucket = g ? g.calls : d.idle;
                bucket[name] = (bucket[name] || 0) + 1;
                if (name === 'getImageData') d.getImage++;
                if (g && (name === 'moveTo' || name === 'lineTo')) {
                    g.lw.add(Math.round(ctx.lineWidth * 100) / 100);
                    try {
                        const m = ctx.getTransform();
                        if (Math.abs(m.a - 1) > 1e-3 || Math.abs(m.d - 1) > 1e-3 || Math.abs(m.e) > 0.5 || Math.abs(m.f) > 0.5) {
                            d.ctxTf = 'масштаб ' + m.a.toFixed(2) + '×' + m.d.toFixed(2) + ', сдвиг ' + Math.round(m.e) + ',' + Math.round(m.f);
                        }
                    } catch (e) { /* getTransform недоступен */ }
                }
                if (acc && acc.active && (name === 'moveTo' || name === 'lineTo' || name === 'quadraticCurveTo')) {
                    const x = Number(args[name === 'quadraticCurveTo' ? 2 : 0]), y = Number(args[name === 'quadraticCurveTo' ? 3 : 1]);
                    let px = x, py = y;
                    try { const m = ctx.getTransform(); px = m.a * x + m.c * y + m.e; py = m.b * x + m.d * y + m.f; } catch (e) { /* без трансформации */ }
                    if (isFinite(px) && isFinite(py) && acc.drawn.length < 4000) acc.drawn.push([px, py]);
                }
            };
        }
        function install() {
            const C2 = PW.CanvasRenderingContext2D && PW.CanvasRenderingContext2D.prototype;
            ['beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'drawImage', 'putImageData', 'getImageData', 'clearRect'].forEach(k => wrap(C2, k, onCtx(k)));
            const CE = PW.HTMLCanvasElement && PW.HTMLCanvasElement.prototype;
            wrap(CE, 'toDataURL', c => { if (isDrawCanvas(c)) d.dataUrl.push(Math.round(now() - startedAt)); });
            wrap(CE, 'toBlob', c => { if (isDrawCanvas(c)) d.blob.push(Math.round(now() - startedAt)); });
            const WS = PW.WebSocket && PW.WebSocket.prototype;
            wrap(WS, 'send', (sock, args) => {
                const m = args[0];
                const size = typeof m === 'string' ? m.length : (m && (m.byteLength || m.size)) || 0;
                d.ws++;
                d.wsBytes += size;
                if (d.cur) d.cur.ws += size; else d.wsIdle += size;
                if (now() - d.lastDone < 3000) d.wsAfterDone += size;
            });
        }

        // --------- passive-слушатели ----------
        // --------- passive listeners ----------
        function snapStyles() {
            const cv = drawCanvasEl();
            if (cv) d.sizes.add(cv.width + '×' + cv.height);
            [['.draw .core', document.querySelector('.draw .core')], ['.draw .drawingContainer', document.querySelector('.draw .drawingContainer')], ['canvas', cv]].forEach(p => {
                if (!p[1]) return;
                const cs = getComputedStyle(p[1]);
                const info = 'transform=' + cs.transform + (cs.translate && cs.translate !== 'none' ? ', translate=' + cs.translate : '') +
                    (cs.scale && cs.scale !== 'none' ? ', scale=' + cs.scale : '') + ', overflow=' + cs.overflow +
                    (p[1].scrollLeft || p[1].scrollTop ? ', прокрутка=' + p[1].scrollLeft + ',' + p[1].scrollTop : '');
                d.styles.set(p[0], info);
            });
        }
        function finish(g) {
            if (!g || g.done) return;
            g.done = true;
            if (d.cur === g) d.cur = null;
            d.gestures.push(g);
            if (d.gestures.length > 40) d.gestures.shift();
            notify();
        }
        function onDown(e) {
            const p = rawXY(e);
            const cv = drawCanvasEl();
            const inside = !!cv && inRect(p[0], p[1], cv.getBoundingClientRect());
            if (acc && acc.armed && !acc.active && inside && (e.button === 0 || e.pointerType !== 'mouse')) {
                const r = cv.getBoundingClientRect();
                Object.assign(acc, { active: true, r, sx: cv.width / r.width, sy: cv.height / r.height, pts: [], drawn: [], id: e.pointerId });
                accPoint(e);
            }
            if (!inside) return;
            if (d.cur) finish(d.cur);
            snapStyles();
            d.cur = { t: Math.round(now() - startedAt), button: e.button, type: e.pointerType || 'mouse', moves: 0, pressures: [], calls: {}, lw: new Set(), ws: 0, done: false, id: e.pointerId };
            if (e.pressure > 0) d.cur.pressures.push(e.pressure);
        }
        function accPoint(ev) {
            for (const x of coalescedOf(ev)) {
                const p = rawXY(x);
                acc.pts.push([(p[0] - acc.r.left) * acc.sx, (p[1] - acc.r.top) * acc.sy]);
            }
        }
        function onMove(e) {
            if (acc && acc.active && e.pointerId === acc.id) accPoint(e);
            const g = d.cur;
            if (!g || e.pointerId !== g.id) return;
            g.moves++;
            if (e.pressure > 0 && g.pressures.length < 400) g.pressures.push(e.pressure);
        }
        function onUp(e) {
            if (acc && acc.active && e.pointerId === acc.id) { acc.active = false; setTimeout(accFinish, 200); acc.collecting = true; }
            const g = d.cur;
            if (!g || e.pointerId !== g.id) return;
            setTimeout(() => finish(g), 150); // игра может дорисовать в ближайшем кадре | the game may finish drawing in the next frame
        }
        function onMenu(e) {
            const p = rawXY(e);
            const cv = drawCanvasEl();
            if (!cv || !inRect(p[0], p[1], cv.getBoundingClientRect())) return;
            d.menu++;
            let ours = false;
            try { ours = CanvasPan.lastSuppressed() === e; } catch (err) { ours = false; }
            if (e.defaultPrevented && !ours) d.menuPrevented++;
        }
        function onWheel(e) {
            const p = rawXY(e);
            const cv = drawCanvasEl();
            if (!cv || !inRect(p[0], p[1], cv.getBoundingClientRect())) return;
            if (e.ctrlKey) { d.wheelCtrl++; if (e.defaultPrevented) d.wheelCtrlPrevented++; } else { d.wheel++; if (e.defaultPrevented) d.wheelPrevented++; }
            setTimeout(snapStyles, 120);
        }
        function onClick(e) {
            let done = null;
            try { done = e.target && e.target.closest && e.target.closest(ELEMENTS.done.selector); } catch (err) { done = null; }
            if (done) { d.doneClicks++; d.lastDone = now(); }
        }
        function attach() {
            if (handlers.length) return;
            const add = (t, type, fn, o) => { t.addEventListener(type, fn, o); handlers.push([t, type, fn, o]); };
            const cap = { capture: true, passive: true };
            add(window, 'pointerdown', onDown, cap);
            add(window, 'pointermove', onMove, cap);
            add(window, 'pointerup', onUp, cap);
            add(window, 'pointercancel', onUp, cap);
            add(window, 'click', onClick, cap);
            // фаза всплытия на window: обработчики игры уже отработали, defaultPrevented показывает их решение
            // the bubbling phase on window: the game's handlers have already run, defaultPrevented shows their decision
            add(window, 'contextmenu', onMenu, { passive: true });
            add(window, 'wheel', onWheel, { passive: true });
        }
        function detach() { while (handlers.length) { const x = handlers.pop(); x[0].removeEventListener(x[1], x[2], x[3]); } }

        function start(sec) {
            if (!on) { d = fresh(); startedAt = now(); }
            install();
            attach();
            on = true;
            snapStyles();
            clearTimeout(stopT);
            endsAt = now() + sec * 1000;
            stopT = setTimeout(stop, sec * 1000);
            notify();
        }
        function stop() {
            clearTimeout(stopT);
            if (on) d.stoppedAt = now();
            on = false;
            if (d.cur) finish(d.cur);
            detach();
            unwrapAll();
            if (acc && !acc.result) acc = null;
            notify();
        }

        // --------- проверка точности: линия игры против точки под курсором ----------
        // --------- accuracy check: the game's line versus the point under the cursor ----------
        function startAccuracy() {
            if (!on || endsAt - now() < 30000) start(90);
            acc = { armed: true, active: false, pts: [], drawn: [], result: null };
            notify();
        }
        function distToPolyline(p, pts) {
            let best = Infinity;
            for (let i = 0; i < pts.length; i++) {
                const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
                const dx = b[0] - a[0], dy = b[1] - a[1];
                const len = dx * dx + dy * dy;
                const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
                const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
                best = Math.min(best, Math.hypot(x, y));
            }
            return best;
        }
        function accFinish() {
            if (!acc) return;
            const res = { pts: acc.pts.length, drawn: acc.drawn.length, median: 0, p90: 0, max: 0, screen: 1 };
            if (acc.pts.length && acc.drawn.length) {
                const ds = acc.drawn.map(p => distToPolyline(p, acc.pts)).sort((a, b) => a - b);
                res.median = ds[Math.floor(ds.length / 2)];
                res.p90 = ds[Math.floor(ds.length * 0.9)];
                res.max = ds[ds.length - 1];
            }
            res.screen = acc.sx ? 1 / acc.sx : 1;
            acc.result = res;
            acc.armed = false;
            acc.collecting = false;
            notify();
            if (res.drawn) uiToast('Проверка точности: ошибка ≈ ' + res.median.toFixed(1) + ' px холста (медиана)', res.median <= 2 ? 'ok' : 'warn', 6000);
            else uiToast('Игра не рисовала через moveTo/lineTo - точность этим способом проверить нельзя.', 'warn', 6000);
        }

        // --------- отчёт ----------
        // --------- the report ----------
        function avg(list, key) { if (!list.length) return 0; return list.reduce((s, g) => s + (g.calls[key] || 0), 0) / list.length; }
        function report() {
            const L = [];
            const sec = Math.round((on ? now() : (d.stoppedAt || now())) - startedAt) / 1000;
            L.push('Исследование игры (зонд, только чтение): ' + (startedAt ? (on ? 'идёт' : 'остановлено') + ', собрано за ~' + Math.round(sec) + ' с, штрихов на холсте: ' + d.gestures.length : 'не запускалось - нажмите «Исследовать игру» и порисуйте'));
            if (!startedAt) return L;
            const left = d.gestures.filter(g => g.button === 0 || g.type !== 'mouse');
            const right = d.gestures.filter(g => g.type === 'mouse' && g.button === 2);
            const draws = g => ['beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'drawImage', 'putImageData'].reduce((s, k) => s + (g.calls[k] || 0), 0);
            // 1. зум / панорама
            // 1. zoom / pan
            L.push('1) Зум и панорама:');
            d.styles.forEach((v, k) => L.push('   ' + k + ': ' + v));
            L.push('   размеры canvas за время наблюдения: ' + (Array.from(d.sizes).join(', ') || '—') + (d.sizes.size > 1 ? ' (менялись: зум меняет размер canvas)' : ''));
            L.push('   трансформация контекста при рисовании: ' + (d.ctxTf ? d.ctxTf + ' - игра зумит/двигает рисунок ВНУТРИ canvas (перерисовкой); слои скрипта такой зум не повторяют' : 'нет (зум игры - через CSS, слои за ним следуют)'));
            L.push('   Ctrl+колесо над холстом: ' + d.wheelCtrl + ', отменено игрой: ' + d.wheelCtrlPrevented + '; колесо без Ctrl: ' + d.wheel + ', отменено: ' + d.wheelPrevented);
            L.push('   вывод: ' + (d.wheelCtrlPrevented ? 'игра обрабатывает Ctrl+колесо сама (свой зум)' : d.wheelCtrl ? 'Ctrl+колесо игрой не отменялось' : 'зум не проверялся (покрутите Ctrl+колесо над холстом)') +
                '; своё панорамирование игры ' + (Array.from(d.styles.values()).some(v => /прокрутка=/.test(v)) ? 'возможно через прокрутку контейнера' : 'не обнаружено'));
            // 2. нажим
            // 2. pressure
            const pen = d.gestures.filter(g => g.type === 'pen');
            const varies = pen.filter(g => g.lw.size > 1).length;
            L.push('2) Нажим в игре: штрихов пером ' + pen.length + (pen.length ? ', ширина линии менялась внутри штриха в ' + varies + ' из них' : ''));
            L.push('   вывод: ' + (!pen.length ? 'не проверено (нарисуйте пером)' : varies ? 'похоже, игра сама меняет ширину по нажиму' : 'игра ширину по нажиму не меняет'));
            // 3. способ рисования
            // 3. the drawing method
            let ctxType = 'не проверено';
            const cv = drawCanvasEl();
            if (cv && d.gestures.length) {
                try { ctxType = cv.getContext('2d') ? '2D-контекст' : 'не 2D (WebGL или другой)'; } catch (e) { ctxType = 'недоступен (вероятно, OffscreenCanvas)'; }
            }
            L.push('3) Рисование: ' + ctxType + '; в среднем на штрих ЛКМ/пером (' + left.length + '): движений ' + (left.length ? (left.reduce((s, g) => s + g.moves, 0) / left.length).toFixed(1) : 0) +
                ', beginPath ' + avg(left, 'beginPath').toFixed(1) + ', moveTo ' + avg(left, 'moveTo').toFixed(1) + ', lineTo ' + avg(left, 'lineTo').toFixed(1) +
                ', кривых ' + (avg(left, 'quadraticCurveTo') + avg(left, 'bezierCurveTo')).toFixed(1) + ', drawImage ' + avg(left, 'drawImage').toFixed(1) + ', putImageData ' + avg(left, 'putImageData').toFixed(1));
            let b = null;
            try { b = BrushSettings.getDiag(); } catch (e) { b = null; }
            if (b && b.hookOn) L.push('   stroke() на холсте (перехват кисти): ' + b.seen);
            const bp = avg(left, 'beginPath'), mv = left.length ? left.reduce((s, g) => s + g.moves, 0) / left.length : 0;
            L.push('   вывод: ' + (!left.length ? 'не проверено (нарисуйте линию)' : bp >= mv * 0.5 && bp > 2 ? 'сегментами: новый путь почти на каждое движение' :
                avg(left, 'lineTo') + avg(left, 'quadraticCurveTo') > 2 ? 'одним или несколькими длинными путями' : 'без moveTo/lineTo (штампы arc или drawImage/putImageData)'));
            // 4. отправка
            // 4. submission
            L.push('4) Отправка: toDataURL у холста ' + d.dataUrl.length + (d.dataUrl.length ? ' (на ' + d.dataUrl.slice(0, 5).join(', ') + ' мс)' : '') + ', toBlob ' + d.blob.length +
                ', чтение пикселей игрой (getImageData) ' + d.getImage + '; нажатий «Готово» ' + d.doneClicks);
            const wsDraw = d.gestures.reduce((s, g) => s + g.ws, 0);
            L.push('   WebSocket: отправок ' + d.ws + ', байт всего ' + d.wsBytes + ', во время штрихов ' + wsDraw + ', после «Готово» (3 с) ' + d.wsAfterDone);
            L.push('   вывод: ' + (d.dataUrl.length || d.blob.length ? 'игра снимает картинку с холста - влитые слои могут попасть в рисунок' :
                wsDraw > 0 ? 'данные уходят во время рисования, картинку с холста игра не снимала: вероятно, рисунок отправляется ШТРИХАМИ, и влитые в холст слои в отправку не попадут' :
                    'не определено (порисуйте и нажмите «Готово», пока идёт исследование)'));
            // 5. правая кнопка
            // 5. the right button
            L.push('5) Правая кнопка: контекстных меню над холстом ' + d.menu + ', отменено игрой ' + d.menuPrevented + '; штрихов ПКМ ' + right.length + ', вызовов рисования в них ' + right.reduce((s, g) => s + draws(g), 0));
            L.push('   вывод: ' + (!right.length && !d.menu ? 'не проверено (нажмите и протяните ПКМ по холсту)' :
                (right.reduce((s, g) => s + draws(g), 0) > 0 ? 'игра РИСУЕТ правой кнопкой - для перемещения холста выберите среднюю кнопку или «Пробел + ЛКМ»' : 'правой кнопкой игра не рисует') +
                (d.menuPrevented ? ', контекстное меню игра отменяет сама' : '')));
            // проверка точности
            // accuracy check
            if (acc && acc.result) {
                const r = acc.result;
                L.push('Проверка точности: точек курсора ' + r.pts + ', точек линии игры ' + r.drawn + (r.drawn ? ', отклонение медиана ' + r.median.toFixed(2) + ' / 90% ' + r.p90.toFixed(2) + ' / макс ' + r.max.toFixed(2) + ' px холста (' + (r.median * r.screen).toFixed(2) + ' px экрана)' : ' - игра рисует без moveTo/lineTo, проверить нельзя'));
            } else if (acc) {
                L.push('Проверка точности: ждёт линию на холсте');
            }
            return L;
        }
        function status() {
            if (acc && acc.armed) return 'Проверка точности: проведите линию на холсте игры…';
            if (on) return 'Исследование идёт ещё ' + Math.max(0, Math.round((endsAt - now()) / 1000)) + ' с: порисуйте мышью и пером, покрутите Ctrl+колесо, протяните ПКМ, нажмите «Готово».';
            return startedAt ? 'Исследование остановлено. Нажмите «Собрать отчёт».' : 'Зонд только считает вызовы и ничего не меняет.';
        }

        return {
            start, stop, startAccuracy, report, status,
            isOn: () => on,
            onUpdate: fn => subs.push(fn),
            // внутренние действия скрипта (слив слоёв) не считаются действиями игры
            // the script's internal actions (layer merging) are not counted as the game's actions
            internal: fn => { internal++; try { return fn(); } finally { internal--; } }
        };
    })();

    // =====================================================
    // PlayersPanel — плавающее окно «Игроки» (в стиле окна референса).
    // PlayersPanel - the floating "Players" window (in the style of the reference window).
    //
    // Кнопка 👥 открывает список игроков лобби. Игроки берутся из DOM игры
    // The 👥 button opens the list of lobby players. Players are taken from the game's DOM
    // (каскад селекторов), пересканирование — по мутациям страницы и по таймеру.
    // (a selector cascade), rescanning - by page mutations and by a timer.
    // Статусы ников:
    // Nick statuses:
    // белый — уже играли со мной минимум один раунд;
    // white - have already played with me for at least one round;
    // жёлтый — новый: ещё не сыграли со мной ни одного раунда; снимается после
    // yellow - new: have not played a single round with me yet; removed after
    // первого сыгранного хода/раунда (счётчик раунда .draw > .step, экран .draw);
    // the first played turn/round (the round counter .draw > .step, the .draw screen);
    // синий — подключился во время игры: раздел «Ожидание» внизу списка;
    // blue - joined during the game: the "Waiting" section at the bottom of the list;
    // красный — у игрока включён блюр рисунка.
    // red - the player has the drawing blur enabled.
    // Блюр — красный крестик ✕ рядом с ником: CSS-фильтр blur ПОВЕРХ canvas рисования
    // Blur - a red cross ✕ next to the nick: a CSS blur filter OVER the drawing canvas
    // (только визуальный фильтр: пиксели холста, сеть и отправка рисунка не затрагиваются).
    // (a purely visual filter: the canvas pixels, the network and the drawing submission are not touched).
    // Повторное нажатие снимает блюр. Пока есть хотя бы один заблюренный игрок, холст размыт.
    // Pressing again removes the blur. While at least one player is blurred, the canvas is blurred.
    // =====================================================
    // =====================================================
    // NetWatch: перехват ВХОДЯЩИХ сообщений WebSocket игры (page realm, тот же паттерн, что и раньше).
    // NetWatch: interception of the game's INCOMING WebSocket messages (the page realm, the same pattern as before).
    // Даёт окну «Игроки» реальное время: кадры сети приходят мгновенно при входе/выходе игроков,
    // It gives the "Players" window real time: network frames arrive instantly when players join/leave,
    // без опроса по таймеру. Перехват ПАССИВНЫЙ: трафик не меняется, читаются только текстовые
    // without timer polling. The interception is PASSIVE: the traffic is not changed, only text
    // кадры socket.io («42["событие", ...]»), из аргументов извлекаются ники игроков.
    // socket.io frames are read ("42[\"event\", ...]"), player nicks are extracted from the arguments.
    // =====================================================
    const NetWatch = (() => {
        const PW = typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
        let installed = false, installErr = '', msgCount = 0, lastMsgAt = 0;
        const listeners = [];
        const samples = [];
        const page = fn => {
            try { if (typeof exportFunction === 'function') return exportFunction(fn, PW); } catch (e) { /* Tampermonkey: не нужен */ }
            return fn;
        };

        function subscribe(fn) { if (typeof fn === 'function') listeners.push(fn); }
        function emit(info) { for (const f of listeners) { try { f(info); } catch (e) { } } }

        function isNick(s) {
            if (typeof s !== 'string') return false;
            const t = s.replace(/\s+/g, ' ').trim();
            if (!t || t.length > 24) return false;
            if (/^[-—–.,:;!?()\[\]{}"'`~@#$%^&*+=|\\/<>_]*$/.test(t)) return false;
            if (/^\d+$/.test(t)) return false;
            if (/^(https?:|data:|blob:|ws:|wss:|www\.)/i.test(t)) return false;
            if (/^(players?|lobby|waiting|online|offline|users?|guest|ok|true|false|null|undefined|name|nick|nickname|id|message|msg)$/i.test(t)) return false;
            return true;
        }
        function collect(v, out, depth) {
            if (depth > 6 || out.length > 40) return;
            if (typeof v === 'string') { if (isNick(v)) out.push(v.replace(/\s+/g, ' ').trim()); return; }
            if (Array.isArray(v)) { for (const x of v) collect(x, out, depth + 1); return; }
            if (v && typeof v === 'object') {
                for (const k of Object.keys(v)) {
                    const val = v[k];
                    if (typeof val === 'string' && /^(name|nick|nickname|username|user|player)$/i.test(k) && isNick(val)) out.push(val.replace(/\s+/g, ' ').trim());
                    else if (val && typeof val === 'object') collect(val, out, depth + 1);
                }
            }
        }

        function handleText(raw) {
            // один кадр может нести несколько пакетов socket.io через разделитель \u001e
            // one frame can carry several socket.io packets separated by \u001e
            const parts = String(raw).split('\u001e');
            for (let p of parts) {
                // engine.io «4» (message): срезаем ТОЛЬКО если дальше не уже готовый «42[...]» (socket.io v2 шлёт без префикса)
                // engine.io "4" (message): we cut it off ONLY if what follows is not already a ready "42[...]" (socket.io v2 sends without the prefix)
                if (p.length > 1 && p.charCodeAt(0) === 52 && p.slice(0, 3) !== '42[') p = p.slice(1);
                if (p.length < 3 || p.slice(0, 2) !== '42' || p.charAt(2) !== '[') continue; // только EVENT-пакеты | only EVENT packets
                let arr;
                try { arr = JSON.parse(p.slice(2)); } catch (e) { continue; }
                if (!Array.isArray(arr) || typeof arr[0] !== 'string') continue;
                msgCount++; lastMsgAt = Date.now();
                if (!samples.some(x => x.e === arr[0])) {
                    samples.push({ e: arr[0], s: p.slice(0, 220) });
                    if (samples.length > 60) samples.shift();
                }
                const names = [];
                for (let i = 1; i < arr.length; i++) collect(arr[i], names, 0);
                emit({ event: arr[0], args: arr.slice(1), names: names });
            }
        }
        function handleData(data) { if (typeof data === 'string' && data) { try { handleText(data); } catch (e) { } } }

        function tapInstance(ws) {
            if (!ws || ws.__gpueTap) return;
            try { ws.__gpueTap = true; } catch (e) { }
            try { ws.addEventListener('message', ev => { try { handleData(ev && ev.data); } catch (e) { } }); } catch (e) { }
        }

        function install() {
            const WSP = PW.WebSocket && PW.WebSocket.prototype;
            if (!WSP) { installErr = 'прототип WebSocket страницы недоступен'; return; }
            if (WSP.__gpueNet) { installed = true; return; }
            try { WSP.__gpueNet = true; } catch (e) { }
            // 1) addEventListener('message', ...) — так слушает часть клиентов socket.io
            // 1) addEventListener('message', ...) - this is how some socket.io clients listen
            const oAdd = WSP.addEventListener;
            if (typeof oAdd === 'function' && !oAdd.__gpueNet) {
                const nAdd = page(function (type, fn, opts) {
                    if (type === 'message' && typeof fn === 'function') {
                        // тап внутри обёртки: отдельный слушатель не добавляем, иначе кадр придёт дважды
                        // the tap inside the wrapper: we do not add a separate listener, otherwise the frame would arrive twice
                        const wrapped = page(function (ev) { try { handleData(ev && ev.data); } catch (e) { } return fn.call(this, ev); });
                        return oAdd.call(this, type, wrapped, opts);
                    }
                    return oAdd.call(this, type, fn, opts);
                });
                try { nAdd.__gpueNet = true; } catch (e) { }
                try { WSP.addEventListener = nAdd; } catch (e) { installErr = 'не удалось заменить addEventListener: ' + (e && e.message ? e.message : e); }
            }
            // 2) ws.onmessage = ... — так слушает engine.io. ВАЖНО: подменяем только доступор,
            // 2) ws.onmessage = ... - this is how engine.io listens. IMPORTANT: we replace only the accessor,
            // внутри вызываем ОРИГИНАЛЬНЫЙ сеттер, иначе игра перестанет получать сообщения.
            // inside it we call the ORIGINAL setter, otherwise the game will stop receiving messages.
            const desc = Object.getOwnPropertyDescriptor(WSP, 'onmessage');
            if (desc && desc.set) {
                Object.defineProperty(WSP, 'onmessage', {
                    configurable: true,
                    get: page(function () { return desc.get.call(this); }),
                    set: page(function (fn) { try { tapInstance(this); } catch (e) { } return desc.set.call(this, fn); })
                });
            }
            installed = !installErr;
        }
        install(); // document-start: раньше сокета игры | document-start: earlier than the game socket
        if (!installed) {
            let tries = 0;
            const retry = () => { if (installed || tries++ >= 10) return; install(); if (!installed) setTimeout(retry, 1000); };
            setTimeout(retry, 500);
        }

        return {
            subscribe, install,
            getDiag: () => ({ installed, installErr, msgCount, lastMsgAt, events: samples.length, samples: samples.slice(-12) })
        };
    })();

    // =====================================================
    // PlayersPanel — список игроков «как в студии», но вместо картинки-закрытия — БЛЮР.
    // PlayersPanel - the player list "like in the studio", but instead of a covering picture - BLUR.
    //
    // Источник данных — ТОЛЬКО реальный DOM игры (тот же проверенный сканер лобби, что в студии:
    // The data source is ONLY the game's real DOM (the same proven lobby scanner as in the studio:
    // элементы ".user" в списке лобби, имя — первый непустой текст внутри, пустые слоты
    // ".user" elements in the lobby list, the name is the first non-empty text inside, empty slots
    // отфильтрованы). Список строится ЗАНОВО на каждом скане (0.5 с) — вышедшие исчезают сразу,
    // are filtered out). The list is rebuilt anew on every scan (0.5 s) - those who left disappear immediately,
    // дубликатов нет, аватар — первая <img> внутри элемента игрока.
    // no duplicates, the avatar is the first <img> inside the player element.
    // NetWatch остаётся: кадры сети не заменяют скан, а УСКОРЯЮТ его (мгновенное
    // NetWatch remains: network frames do not replace the scan, they SPEED it up (instant
    // обновление при входе/выходе, индикатор ⚡ в футере).
    // updates on join/leave, the ⚡ indicator in the footer).
    // Статусы: белый — уже играли, жёлтый «нов» — новые (снимается после первого сыгранного
    // Statuses: white - have already played, yellow "new" - new ones (removed after the first played
    // хода/раунда), синий — подключились во время игры (раздел «Ожидание» внизу списка),
    // turn/round), blue - joined during the game (the "Waiting" section at the bottom of the list),
    // красный «блюр» — у игрока включён блюр.
    // red "blur" - the player has the blur enabled.
    // БЛЮР вместо картинки (в студии рисунки закрывались закреплённой картинкой): CSS-фильтр
    // BLUR instead of the picture (in the studio drawings were covered with a pinned picture): a CSS filter
    // blur(14px) ТОЛЬКО визуально, поверх canvas — в игре на холсте рисования, в альбоме на
    // blur(14px) ONLY visually, over the canvas - in the game on the drawing canvas, in the album on
    // рисунках конкретного игрока (ник автора остаётся чётким). Пиксели холста, сеть и отправка
    // the drawings of a specific player (the author's nick stays sharp). The canvas pixels, the network and the drawing
    // рисунка не затрагиваются. Красный крестик ✕ рядом с ником включает/снимает блюр — и в окне,
    // submission are not touched. The red cross ✕ next to the nick enables/disables the blur - both in the window
    // и прямо в лобби у каждого ника.
    // and right in the lobby next to every nick.
    // =====================================================
    const PlayersPanel = (() => {
        const BLUR_PX = 14;
        const BLUR_VAL = 'blur(' + BLUR_PX + 'px)';
        const CANVAS_SEL = '.draw .drawingContainer canvas, .draw .core canvas';
        const MINE_SEL = '[id^="gpue-"],[class^="gpue-"]';
        const INVIS_RE = /[\s\u00a0\u1680\u2000-\u200f\u2028\u2029\u202f\u205f\u3000\ufeff\u200b\u200c\u200d\u2060\u180e]/g;
        const PLACEHOLDER_RE = /^(пусто|пустой|empty|free|свободно|ожидание|-+|—|_+)$/i;

        function cleanName(s) { return String(s || '').replace(INVIS_RE, ''); }
        function isRealName(s) { const c = cleanName(s); return c.length >= 1 && !PLACEHOLDER_RE.test(c); }
        function isMine(el) { try { return !!(el && el.closest && el.closest(MINE_SEL)); } catch (e) { return false; } }
        function visible(el) { try { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; } catch (e) { return false; } }
        function nameOf(entry) {
            let n = null;
            try { n = entry.querySelector('.nick, [class*="nick"]'); } catch (e) { n = null; }
            if (n) { const s = cleanName(n.textContent).trim(); if (s && isRealName(s)) return s.replace(/\s+/g, ' ').slice(0, 40); }
            let s = '';
            try {
                const w = document.createTreeWalker(entry, NodeFilter.SHOW_TEXT, null);
                let t;
                while ((t = w.nextNode())) { const v = cleanName(t.textContent).trim(); if (v && isRealName(v)) { s = v; break; } }
            } catch (e) { s = cleanName(entry.textContent).trim(); }
            return s.replace(/\s+/g, ' ').slice(0, 40);
        }
        function entryOf(nick) {
            let e = null;
            try { e = nick.closest('[class*="player"]:not([class*="players"])'); } catch (err) { e = null; }
            return e || nick.parentElement || nick;
        }
        function lobbyNicksOld() {
            let list = [];
            let root = null;
            try { root = document.querySelector('.lobby') || document.querySelector('.room .players') || document.querySelector('.players'); } catch (e) { root = null; }
            if (root) {
                list = Array.from(root.querySelectorAll('.nick')).filter(el => !isMine(el) && visible(el));
                if (!list.length) list = Array.from(root.querySelectorAll('[class*="nick"],[class*="name"]')).filter(el => !isMine(el) && visible(el));
            }
            if (!list.length) {
                let cand = [];
                try { cand = Array.from(document.querySelectorAll('.nick, [class*="nick"]'))
                    .filter(el => !isMine(el) && !el.closest('.draw') && !el.closest('.item') && visible(el)); } catch (e) { cand = []; }
                const uniq = new Map();
                for (const el of cand) { const nm = cleanName(el.textContent).trim(); if (nm && !uniq.has(nm)) uniq.set(nm, el); }
                if (uniq.size >= 2 && uniq.size <= 40) list = Array.from(uniq.values());
            }
            return list;
        }
        function lobbyTargets() {
            let list = [];
            // явный селектор элемента игрока (jsx-… jsx-… user) — один и тот же компонент показывается
            // an explicit selector of the player element (jsx-… jsx-… user) - the same component is shown
            // в лобби, на экране подключения и в выборе режима; альбом (.item) не трогаем — там своя разметка
            // in the lobby, on the connection screen and in the mode selection; the album (.item) is not touched - it has its own markup
            try { list = Array.from(document.querySelectorAll('.users .user, .lobby .user, .room .user, [class*="jsx-"].user'))
                .filter(el => !isMine(el) && !el.closest('.item') && !el.closest('.draw')); } catch (e) { list = []; }
            if (!list.length) {
                let all = [];
                try { all = Array.from(document.querySelectorAll('.user')).filter(el => !isMine(el) && !el.closest('.item') && !el.closest('.draw') && visible(el)); } catch (e) { all = []; }
                if (all.length >= 2) list = all;
            }
            if (!list.length) {
                const seen = new Set(); list = [];
                lobbyNicksOld().forEach(nk => { const e = entryOf(nk); if (e && !isMine(e) && !seen.has(e)) { seen.add(e); list.push(e); } });
            }
            const out = new Set();
            list.forEach(el => { if (!isMine(el) && visible(el)) out.add(el); });
            return Array.from(out);
        }

        // --------- состояние ----------
        // --------- state ----------
        function cfg() {
            if (!state.players || typeof state.players !== 'object') state.players = {};
            const c = state.players;
            if (!Array.isArray(c.regular)) c.regular = [];
            if (!Array.isArray(c.blurred)) c.blurred = [];
            return c;
        }
        function save() {
            const c = cfg();
            c.regular = Array.from(regular).slice(0, 500);
            c.blurred = Array.from(blurred).slice(0, 500);
            scheduleSave();
        }

        const regular = new Set(); // уже играли со мной (сохраняется) | already played with me (persisted)
        const blurred = new Set(); // блюр рисунка включён (сохраняется) | drawing blur enabled (persisted)
        const waiting = new Set(); // подключились во время игры (сессия) | joined during the game (session)
        const roster = new Set();  // активный состав лобби (сессия) | the active lobby roster (session)
        const netNames = new Set(); // имена из кадров сети (реальное время), расходятся в tick | names from network frames (real time), consumed in tick
        const avatars = new Map(); // имя → URL аватарки (запоминаем из лобби) | name -> avatar URL (remembered from the lobby)
        let known = null;          // имена на момент первого скана лобби («старые») | names at the moment of the first lobby scan ("old")
        let players = [];          // свежие данные скана — источник окна «Игроки» | fresh scan data - the source of the "Players" window
        const missCount = new Map(); // сколько проверок подряд ник не виден в DOM | how many checks in a row a nick has not been seen in the DOM
        let netSubscribed = false, lastNetAt = 0, netEvents = 0;
        let pl = null, mo = null, moT = 0, iv = 0, scanT = 0;
        let lastSig = '\u0000', wasInGame = false, lastStep = null;

        function drawVisible() { return !!findVisible('.draw'); }
        function stepText() {
            const el = findVisible('.draw > .step');
            return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null;
        }

        // --------- блюр вместо картинки (только визуальный CSS-фильтр) ----------
        // --------- blur instead of the picture (a purely visual CSS filter) ----------
        function applyBlur() {
            const want = blurred.size ? BLUR_VAL : '';
            let list;
            try { list = document.querySelectorAll(CANVAS_SEL); } catch (e) { list = []; }
            for (const cv of list) if (cv.style.filter !== want) cv.style.filter = want;
            // альбом: блюр только рисунков заблюренных игроков — ник автора остаётся чётким
            // the album: only the drawings of blurred players are blurred - the author's nick stays sharp
            let items;
            try { items = document.querySelectorAll('.item'); } catch (e) { items = []; }
            for (const item of items) {
                let drawing = null, nick = null;
                try { drawing = item.querySelector('.drawing'); nick = item.querySelector('.nick'); } catch (e) { continue; }
                if (!drawing || !nick) continue;
                const name = cleanName(nick.textContent).trim();
                const want2 = name && blurred.has(name) ? BLUR_VAL : '';
                let cvs = [];
                try { cvs = drawing.querySelectorAll('canvas'); } catch (e) { cvs = []; }
                for (const cv of cvs) if (cv.style.filter !== want2) cv.style.filter = want2;
            }
        }
        function toggleBlur(name) {
            if (blurred.has(name)) {
                blurred.delete(name);
                uiToast('🖼 «' + name + '»: блюр снят — рисунок снова виден');
            } else {
                blurred.add(name);
                uiToast('✕ «' + name + '»: рисунок размыт (блюр)');
            }
            save();
            applyBlur();
            try { scanLobby(); } catch (e) { /* разметка изменилась */ }
            lastSig = '\u0000';
            render();
        }

        // --------- лобби: скан + украшение ников (крестик ✕ и подсветка, как в студии) ----------
        // --------- lobby: scan + decorating nicks (the cross ✕ and the highlight, as in the studio) ----------
        function decorate(entry, name) {
            let b = null;
            try { b = entry.querySelector(':scope > .gpue-pl-plus'); } catch (e) { b = null; }
            if (!b) {
                b = document.createElement('button');
                b.type = 'button';
                b.className = 'gpue-pl-plus';
                b.textContent = '✕';
                b.addEventListener('click', ev => {
                    ev.stopPropagation();
                    if (ev.preventDefault) ev.preventDefault();
                    toggleBlur(name);
                });
                try { entry.appendChild(b); } catch (e) { return; }
            }
            const isBlk = blurred.has(name);
            const isNew = !!known && !known.has(name) && !regular.has(name);
            entry.classList.toggle('gpue-pl-new', isNew && !isBlk);
            entry.classList.toggle('gpue-pl-blk', isBlk);
            // оверлею ::after нужна позиция-якорь; трогаем только если элемент статичен
            // the ::after overlay needs a positioning anchor; we touch it only if the element is static
            try { if (isBlk || isNew) { if (getComputedStyle(entry).position === 'static') entry.classList.add('gpue-pl-rel'); } else entry.classList.remove('gpue-pl-rel'); } catch (e) { /* не критично */ }
            b.classList.toggle('on', isBlk);
        }
        function scanLobby() {
            let entries = [];
            try { entries = lobbyTargets(); } catch (e) { entries = []; }
            players = []; // список строится ЗАНОВО от реального DOM — вышедшие исчезают сразу | the list is rebuilt ANEW from the real DOM - those who left disappear immediately
            if (!entries.length) return;
            if (!known) {
                known = new Set();
                entries.forEach(el => { const nm = nameOf(el); if (nm) known.add(nm); });
            }
            const seen = new Set();
            for (const entry of entries) {
                if (isMine(entry)) continue;
                const name = nameOf(entry);
                if (!name || !isRealName(name) || seen.has(name)) continue;
                seen.add(name);
                let av = '';
                try { const img = entry.querySelector('img'); if (img) av = img.getAttribute('src') || img.src || ''; } catch (e) { av = ''; }
                if (av) avatars.set(name, String(av).slice(0, 500)); // помним аватарки и на время игры | we remember avatars also for the duration of the game
                players.push({ name: name, avatar: av && String(av).slice(0, 500), isNew: !known.has(name) && !regular.has(name), isBlk: blurred.has(name) });
                try { decorate(entry, name); } catch (e) { /* разметка изменилась — не мешаем игре */ }
            }
        }

        // --------- осмотр рисунков (альбом) — метки на нике автора ----------
        // --------- viewing drawings (the album) - marks on the author's nick ----------
        // Жёлтый — «нов», красный — «блюр», синий — подключился посреди игры («Ожидание»).
        // Yellow - "new", red - "blur", blue - joined in the middle of the game ("Waiting").
        // Красим ТОЛЬКО ник автора; в состав игроков эти элементы не попадают.
        // We paint ONLY the author's nick; these elements do not get into the player roster.
        function decorateAlbum() {
            let items;
            try { items = document.querySelectorAll('.item'); } catch (e) { items = []; }
            for (const item of items) {
                let nick = null;
                try { nick = item.querySelector('.nick'); } catch (e) { nick = null; }
                if (!nick || isMine(nick)) continue;
                const name = cleanName(nick.textContent).trim();
                if (!name || !isRealName(name)) { try { nick.classList.remove('gpue-pl-new', 'gpue-pl-blk', 'gpue-pl-wait', 'gpue-pl-rel', 'gpue-pl-sm'); } catch (e) {} continue; }
                const isBlk = blurred.has(name);
                const isW = waiting.has(name);
                const isNew = !!known && !known.has(name) && !regular.has(name);
                try {
                    nick.classList.toggle('gpue-pl-blk', isBlk);
                    nick.classList.toggle('gpue-pl-wait', !isBlk && isW);
                    nick.classList.toggle('gpue-pl-new', !isBlk && !isW && isNew);
                    nick.classList.toggle('gpue-pl-sm', isBlk || isW || isNew);
                    if (isBlk || isW || isNew) { if (getComputedStyle(nick).position === 'static') nick.classList.add('gpue-pl-rel'); }
                    else nick.classList.remove('gpue-pl-rel');
                } catch (e) { /* не критично */ }
            }
        }

        // --------- состав, раунды и ожидание ----------
        // --------- roster, rounds and waiting ----------
        function roundPlayed() {
            let ch = false;
            for (const n of roster) {
                if (!regular.has(n)) { regular.add(n); ch = true; }
                if (known && !known.has(n)) known.add(n); // жёлтая метка снимается после сыгранного хода | the yellow mark is removed after a played turn
            }
            if (ch) save();
        }
        function tick() {
            const inGame = drawVisible();
            const step = inGame ? stepText() : null;
            // смена счётчика раунда = предыдущий ход сыгран; конец игры — то же самое.
            // a change of the round counter = the previous turn has been played; the end of the game - the same thing.
            // Снимаем жёлтые метки ДО скана, чтобы список сразу показал актуальные статусы
            // We remove the yellow marks BEFORE the scan so that the list immediately shows the current statuses
            if (inGame && lastStep !== null && step !== null && step !== lastStep) roundPlayed();
            if (wasInGame && !inGame) { roundPlayed(); lastStep = null; } // игра закончилась | the game has ended
            scanLobby();
            try { decorateAlbum(); } catch (e) { /* 2.19: метки в альбоме */ }
            const names = players.map(p => p.name);

            if (!wasInGame && inGame) {
                // старт игры: ожидающие переходят в состав
                // the start of the game: those waiting move into the roster
                for (const n of Array.from(waiting)) { roster.add(n); waiting.delete(n); }
            } else if (inGame) {
                // во время игры: новые имена (DOM + кадры сети) — в список ожидания (синие, внизу)
                // during the game: new names (DOM + network frames) go into the waiting list (blue, at the bottom)
                const fresh = names.slice();
                for (const n of netNames) { if (isRealName(n) && !fresh.includes(n)) fresh.push(n); }
                netNames.clear();
                for (const n of fresh) if (!roster.has(n) && !regular.has(n)) waiting.add(n);
                // список работает и ВО ВРЕМЯ ИГРЫ — строим из состава + ожидающих,
                // the list works DURING THE GAME too - we build it from the roster + those waiting,
                // статусы те же: белый — уже играли, жёлтый — новый, красный — блюр, синий — ожидание
                // the same statuses: white - have already played, yellow - new, red - blur, blue - waiting
                if (!known) known = new Set(roster); // скрипт включился посреди игры — текущие «старые» | the script was enabled in the middle of a game - the current ones are "old"
                const all = new Set(Array.from(roster).concat(Array.from(waiting)));
                players = Array.from(all).map(n => ({
                    name: n,
                    avatar: avatars.get(n) || '',
                    isNew: !known.has(n) && !regular.has(n),
                    isBlk: blurred.has(n)
                }));
            } else {
                // лобби: состав = кто сейчас в списке; выход подтверждаем 3 проверками подряд,
                // lobby: the roster = who is currently in the list; a leave is confirmed by 3 checks in a row,
                // чтобы частичное сканирование (анимации, прокрутка) не вычищало состав
                // so that a partial scan (animations, scrolling) does not purge the roster
                for (const n of names) { roster.add(n); missCount.delete(n); }
                for (const n of Array.from(waiting)) if (!names.includes(n)) waiting.delete(n);
                if (names.length) {
                    for (const n of Array.from(roster)) {
                        if (names.includes(n)) { missCount.delete(n); continue; }
                        const m = (missCount.get(n) || 0) + 1;
                        if (m >= 3) { roster.delete(n); missCount.delete(n); } else missCount.set(n, m);
                    }
                }
            }
            lastStep = step;
            wasInGame = inGame;
        }

        // --------- реальное время: кадры сети лишь ускоряют скан ----------
        // --------- real time: network frames only speed up the scan ----------
        function scheduleTick(ms) {
            if (scanT) return;
            scanT = setTimeout(() => {
                scanT = 0;
                if (!document.hidden) { tick(); applyBlur(); render(); }
            }, ms || 60);
        }
        function onNet(info) {
            lastNetAt = Date.now(); netEvents++;
            // имена из кадров сети — чтобы подключившиеся ВО ВРЕМЯ игры попадали в «Ожидание»
            // names from network frames - so that those who join DURING the game get into "Waiting"
            try {
                const ns = (info && info.names) || [];
                for (const n of ns) { if (isRealName(n)) netNames.add(cleanName(n)); }
            } catch (e) { /* не критично */ }
            scheduleTick(60);
        }
        function netBadge() {
            if (!pl || !pl.net) return;
            const live = lastNetAt && (Date.now() - lastNetAt < 60000);
            pl.net.textContent = live ? '⚡' : '·';
            pl.net.style.color = live ? '#7ee787' : '#667';
        }

        // --------- окно «👥 Игроки» (разметка и стили студии) ----------
        // --------- the "👥 Players" window (the studio's markup and styles) ----------
        const PP_CSS = `
#gpue-players-btn{position:fixed;top:8px;right:56px;z-index:2147483646;padding:6px 9px;background:#2b2b3d;color:#fff;font:13px "Segoe UI",system-ui,Arial,sans-serif;border-radius:10px;cursor:pointer;user-select:none;opacity:.85}
#gpue-players-btn:hover{opacity:1}
#gpue-players{position:fixed;top:52px;left:16px;z-index:2147482000;width:280px;background:#111318;color:#F4F5FA;border:1px solid #383D4A;border-radius:14px;font:13.5px/1.5 "Segoe UI",system-ui,sans-serif;user-select:none;box-shadow:0 18px 50px rgba(0,0,0,.55),0 2px 6px rgba(0,0,0,.35);display:none;flex-direction:column;max-height:70vh}
#gpue-players.open{display:flex}
#gpue-players-head{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#1B1E26;border-bottom:1px solid #2A2E39;font-weight:650;font-size:13.5px;border-radius:14px 14px 0 0;cursor:grab;flex:none;touch-action:none}
#gpue-players-head:active{cursor:grabbing}
#gpue-players-title{flex:none;color:#e8ebf4}
#gpue-players-info{flex:1;font-weight:400;color:#A3A8B8;font-size:10.5px;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#gpue-players-x{cursor:pointer;color:#A3A8B8;padding:2px 6px;border-radius:8px;font-size:13px;transition:background .15s,color .15s}
#gpue-players-x:hover{background:#2A2E39;color:#fff}
#gpue-players-rows{flex:1;min-height:0;overflow-y:auto;padding:5px 0}
#gpue-players-rows::-webkit-scrollbar{width:9px}
#gpue-players-rows::-webkit-scrollbar-thumb{background:#2A2E39;border-radius:8px;border:2px solid #111318}
#gpue-players-rows::-webkit-scrollbar-track{background:transparent}
.gpue-players-row{display:flex;align-items:center;gap:10px;padding:7px 12px;font-size:13px;color:#e6e6e6;border-radius:9px;margin:0 5px;transition:background .12s}
.gpue-players-row:hover{background:#1B1E26}
.gpue-players-av{width:28px;height:28px;flex:none;border-radius:50%;background:#1B1E26;border:1px solid #2A2E39;object-fit:cover;overflow:hidden;display:flex;align-items:center;justify-content:center;font:600 12px/1 system-ui,sans-serif;color:#7C5CFC}
.gpue-players-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gpue-players-name.gpue-pl-yellow{color:#ffd400}
.gpue-players-name.gpue-pl-blue{color:#6ab0ff}
.gpue-players-name.gpue-pl-red{color:#ff5a5a;font-weight:700}
.gpue-players-badge{font-size:10px;padding:2px 8px;border-radius:9px;background:rgba(255,209,0,.2);color:#ffd100;flex:none;font-weight:600}
.gpue-players-badge.blk{background:rgba(231,76,60,.25);color:#ff6f61}
.gpue-players-row.blk{background:rgba(231,76,60,.12)}
.gpue-players-row.blk:hover{background:rgba(231,76,60,.2)}
.gpue-players-xbtn{width:24px;height:24px;flex:none;border:none;border-radius:50%;background:rgba(48,42,72,.9);color:#ff5f5f;font:700 13px/1 system-ui,sans-serif;cursor:pointer;transition:background .15s,color .15s,transform .1s}
.gpue-players-xbtn:hover{background:#3b4356;color:#ff9b9b;transform:scale(1.08)}
.gpue-players-xbtn.on{background:#c0392b;color:#fff}
.gpue-pl-sec{padding:5px 12px 3px;font-size:11px;font-weight:700;color:#6ab0ff;text-transform:uppercase;border-top:1px solid #2A2E39;margin-top:3px}
#gpue-players-foot{display:flex;align-items:center;gap:6px;padding:8px 14px;border-top:1px solid #2A2E39;color:#A3A8B8;font-size:12px;flex:none}
#gpue-pl-net{flex:none;width:16px;text-align:center;font-size:13px;color:#667}
.gpue-players-hint{padding:12px 14px;color:#8b8f9e;font-size:12px}
.gpue-pl-plus{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:22px;height:22px;margin-left:7px;padding:0;border:none;border-radius:50%;background:rgba(30,34,46,.85);color:#ff5f5f;font:700 15px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.45);vertical-align:middle;position:relative;z-index:6}
.gpue-pl-plus:hover{background:#3b4356;color:#ff9b9b}
.gpue-pl-plus.on{background:#c0392b;color:#fff}
/* 2.16.1: закрашивание элемента игрока в лобби (.jsx-… .jsx-… user) ЦЕЛИКОМ.
   Фон jsx-классов на самом элементе и его детях перекрывает простой background,
   поэтому красим оверлеем ::after ПОВЕРХ содержимого: жёлтый — новый, красный — заблюрен. */
.gpue-pl-rel{position:relative !important}
.gpue-pl-new::after{content:'';position:absolute;inset:0;z-index:5;pointer-events:none;background:rgba(255,209,0,.5);border-radius:12px;box-shadow:inset 0 0 0 2px rgba(255,209,0,.95)}
.gpue-pl-blk::after{content:'';position:absolute;inset:0;z-index:5;pointer-events:none;background:rgba(231,76,60,.55);border-radius:12px;box-shadow:inset 0 0 0 2px rgba(231,76,60,.95)}
.gpue-pl-wait::after{content:'';position:absolute;inset:0;z-index:5;pointer-events:none;background:rgba(108,176,255,.5);border-radius:12px;box-shadow:inset 0 0 0 2px rgba(108,176,255,.95)}
/* 2.19: в альбоме красим ник автора — оверлей с меньшим радиусом */
.gpue-pl-sm::after{border-radius:6px}
`;

        function placePl(left, top) {
            const r = pl.root;
            const w = r.offsetWidth || 280;
            left = Math.min(Math.max(0, left), Math.max(0, window.innerWidth - w));
            top = Math.min(Math.max(0, top), Math.max(0, window.innerHeight - 60));
            r.style.left = left + 'px';
            r.style.top = top + 'px';
        }
        function saveGeom() {
            const r = pl.root.getBoundingClientRect();
            cfg().left = Math.round(r.left);
            cfg().top = Math.round(r.top);
            scheduleSave();
        }
        function togglePl(force) {
            const open = typeof force === 'boolean' ? force : !pl.root.classList.contains('open');
            pl.root.classList.toggle('open', open);
            // активная кнопка светится фиолетовым
            // the active button glows purple
            const pb = document.getElementById('gpue-players-btn');
            if (pb) pb.classList.toggle('gpue-on', open);
            if (open) { tick(); render(); }
        }
        function row(p) {
            const isW = waiting.has(p.name);
            const kind = p.isBlk ? 'red' : (isW ? 'blue' : (p.isNew ? 'yellow' : ''));
            // у ожидающих синяя метка; бейдж «нов» не дублируем поверх синего
            // those waiting have a blue mark; we do not duplicate the "new" badge over the blue one
            const rowEl = h('div', { class: 'gpue-players-row' + (p.isBlk ? ' blk' : '') });
            const av = h('div', { class: 'gpue-players-av' });
            if (p.avatar) {
                const img = document.createElement('img');
                img.src = p.avatar;
                img.alt = '';
                img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
                img.addEventListener('error', () => { try { img.remove(); } catch (e) { /* уже снят */ } av.textContent = (p.name || '?').slice(0, 1).toUpperCase(); });
                av.appendChild(img);
            } else av.textContent = (p.name || '?').slice(0, 1).toUpperCase();
            rowEl.appendChild(av);
            rowEl.appendChild(h('span', { class: 'gpue-players-name' + (kind ? ' gpue-pl-' + kind : ''), text: p.name }));
            if (p.isBlk || (p.isNew && !isW)) rowEl.appendChild(h('span', { class: 'gpue-players-badge' + (p.isBlk ? ' blk' : ''), text: p.isBlk ? 'блюр' : 'нов' }));
            const xb = h('button', {
                type: 'button', class: 'gpue-players-xbtn' + (p.isBlk ? ' on' : ''), text: '✕',
                title: p.isBlk ? 'Снять блюр с «' + p.name + '»' : 'Заблюрить рисунки «' + p.name + '»'
            });
            xb.addEventListener('click', ev => { ev.stopPropagation(); toggleBlur(p.name); });
            rowEl.appendChild(xb);
            return rowEl;
        }
        function render() {
            if (!pl) return;
            const act = players.filter(p => !waiting.has(p.name));
            const waitAll = players.filter(p => waiting.has(p.name));
            const sig = players.map(p => p.name + (p.isBlk ? '!' : '') + (p.isNew ? '+' : '')).join('|') +
                '//' + waitAll.map(p => p.name).join('|');
            if (sig === lastSig) { netBadge(); return; }
            lastSig = sig;
            pl.rows.textContent = '';
            for (const p of act) pl.rows.appendChild(row(p));
            if (waitAll.length) {
                pl.rows.appendChild(h('div', { class: 'gpue-pl-sec', text: 'Ожидание' }));
                for (const p of waitAll) pl.rows.appendChild(row(p));
            }
            if (!players.length) {
                pl.rows.appendChild(h('div', { class: 'gpue-players-hint', text: 'Сейчас никого не видно — список появится в лобби или во время игры' }));
            }
            pl.count.textContent = String(players.length);
            netBadge();
        }

        function init() {
            if (document.getElementById('gpue-players-btn')) return;
            const c = cfg();
            regular.clear(); (c.regular || []).forEach(n => regular.add(String(n)));
            blurred.clear(); (c.blurred || []).forEach(n => blurred.add(String(n)));

            const style = document.createElement('style');
            style.textContent = PP_CSS;
            document.head.appendChild(style);

            const count = h('span', { id: 'gpue-players-count', text: '0' });
            const closeBtn = h('span', { id: 'gpue-players-x', text: '✕', title: 'Закрыть окно' });
            const head = h('div', { id: 'gpue-players-head', title: 'Перетащите шапку, чтобы переместить окно' }, [
                h('span', { id: 'gpue-players-title', text: '👥 Игроки' }),
                h('span', { id: 'gpue-players-info', text: 'обновляется автоматически' }),
                closeBtn
            ]);
            const rows = h('div', { id: 'gpue-players-rows' });
            const net = h('span', { id: 'gpue-pl-net', text: '·', title: 'Реальное время (сеть)' });
            const foot = h('div', { id: 'gpue-players-foot' }, [
                h('span', { text: 'Всего игроков: ' }), count, h('span', { text: '· ✕ — блюр/разблюр' }), net
            ]);
            const root = h('div', { id: 'gpue-players', tabindex: '-1' }, [head, rows, foot]);
            const btn = h('div', { id: 'gpue-players-btn', text: '👥', title: 'Игроки — список игроков комнаты' });
            document.body.appendChild(btn);
            document.body.appendChild(root);
            pl = { root, head, rows, foot, count, net };

            if (!netSubscribed) { netSubscribed = true; NetWatch.subscribe(onNet); }

            placePl(clampNum(c.left, 0, 99999, 16), clampNum(c.top, 0, 99999, 52));

            // события окна не должны доходить до игры
            // the window's events must not reach the game
            ['pointerdown', 'mousedown', 'touchstart', 'wheel', 'keydown', 'keyup', 'keypress'].forEach(type =>
                root.addEventListener(type, e => e.stopPropagation(), { passive: true }));
            btn.addEventListener('click', () => togglePl());
            closeBtn.addEventListener('click', () => togglePl(false));

            // перемещение окна за шапку
            // moving the window by its header
            let drag = null;
            head.addEventListener('pointerdown', e => {
                if (e.target === closeBtn || e.button !== 0) return;
                const r = root.getBoundingClientRect();
                drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
                try { head.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
                e.preventDefault();
            });
            head.addEventListener('pointermove', e => { if (drag) placePl(e.clientX - drag.dx, e.clientY - drag.dy); });
            const endDrag = () => { if (!drag) return; drag = null; saveGeom(); };
            head.addEventListener('pointerup', endDrag);
            head.addEventListener('pointercancel', endDrag);

            // живое обновление: мутации страницы + опрос 0.5 с (как в студии) + мгновенные кадры сети
            // live updating: page mutations + a 0.5 s poll (as in the studio) + instant network frames
            mo = new MutationObserver(() => {
                if (moT) return;
                moT = setTimeout(() => { moT = 0; if (!document.hidden) { tick(); applyBlur(); render(); } }, 400);
            });
            mo.observe(document.body, { childList: true, subtree: true });
            iv = setInterval(() => { if (!document.hidden) { tick(); applyBlur(); render(); } }, 500);
            tick(); applyBlur(); render();
        }

        return { init, tick, render, applyBlur };
    })();

    // =====================================================
    // ToolLayout — одинаковый размер и равный зазор между кнопками верхнего ряда
    // ToolLayout - the same size and an equal gap between the top-row buttons
    // (🖼 Референс, 🎨 Цветовой круг, 👥 Игроки, ⚙ UI). Порт из студии: ⚙ UI — якорь у правого
    // (🖼 Reference, 🎨 Color wheel, 👥 Players, ⚙ UI). A port from the studio: ⚙ UI is anchored at the right
    // края (8 px, как было), остальные пристраиваются справа налево с одним и тем же зазором.
    // edge (8 px, as it was), the others are lined up from right to left with the same gap.
    // Зазор настраивается во вкладке «Раскладка» (0–40 px) и хранится отдельно (gpUiToolGap.v1).
    // The gap is configured in the "Layout" tab (0-40 px) and stored separately (gpUiToolGap.v1).
    // =====================================================
    const ToolLayout = (() => {
        const KEY = 'gpUiToolGap.v1';
        const DEF = { gap: 5 };
        let cfg = Object.assign({}, DEF), loaded = false;
        // порядок справа налево: ⚙ UI — якорь у края, далее новые кнопки рядом с ним
        // the order from right to left: ⚙ UI is anchored at the edge, then new buttons next to it
        const ORDER = ['gpue-btn', 'gpue-players-btn', 'gpue-wheel-btn', 'gpue-ref-btn'];
        function load() {
            if (loaded) return;
            loaded = true;
            try {
                const raw = typeof GM_getValue === 'function' ? GM_getValue(KEY, null) : localStorage.getItem(KEY);
                const o = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
                if (o && typeof o === 'object' && isFinite(Number(o.gap))) cfg.gap = Math.min(40, Math.max(0, Math.round(Number(o.gap))));
            } catch (e) { /* хранилище недоступно — работаем со значением по умолчанию */ }
        }
        function save() {
            try {
                const raw = JSON.stringify(cfg);
                if (typeof GM_setValue === 'function') GM_setValue(KEY, raw); else localStorage.setItem(KEY, raw);
            } catch (e) { /* хранилище недоступно — работаем в памяти */ }
        }
        function apply() {
            try {
                load();
                let right = 8; // ⚙ UI всегда прижат к правому краю (8 px, как было) | the ⚙ UI button is always pinned to the right edge (8 px, as before)
                for (const id of ORDER) {
                    const el = document.getElementById(id);
                    if (!el) continue;
                    // все кнопки строго одного размера (30×30) и не так заметны
                    // all buttons are strictly one size (30×30) and less prominent
                    el.style.width = '30px';
                    el.style.minWidth = '30px';
                    el.style.height = '30px';
                    el.style.padding = '0';
                    el.style.display = 'flex';
                    el.style.alignItems = 'center';
                    el.style.justifyContent = 'center';
                    el.style.boxSizing = 'border-box';
                    el.style.fontSize = '15px';
                    const w = el.offsetWidth;
                    if (!w) continue; // скрытая кнопка не участвует в раскладке и не создаёт зазор | a hidden button does not participate in the layout and does not create a gap
                    el.style.right = right + 'px';
                    right += w + cfg.gap; // одинаковый зазор между всеми соседями | the same gap between all neighbours
                }
            } catch (e) { /* раскладка не критична */ }
        }
        function setGap(px) {
            cfg.gap = Math.min(40, Math.max(0, Math.round(Number(px) || 0)));
            save();
            apply();
        }
        function row() {
            load();
            const cur = cfg.gap;
            const mk = v => (v === cur ? ' selected' : '');
            const sel = h('select', { title: 'Расстояние между кнопками инструментов (верхний ряд)' });
            sel.innerHTML = '<option value="3"' + mk(3) + '>3 px</option>' +
                '<option value="5"' + mk(5) + '>5 px</option>' +
                '<option value="8"' + mk(8) + '>8 px</option>' +
                '<option value="10"' + mk(10) + '>10 px</option>' +
                '<option value="custom"' + (cur !== 3 && cur !== 5 && cur !== 8 && cur !== 10 ? ' selected' : '') + '>Своё…</option>';
            const num = h('input', { type: 'number', min: '0', max: '40', step: '1', value: String(cur), title: 'Своё значение 0–40 px' });
            num.style.cssText = 'width:56px;padding:4px 6px;border-radius:8px;border:1px solid #383D4A;background:#20232D;color:#F4F5FA';
            const applyCustom = () => { const v = parseInt(num.value, 10); if (!isNaN(v)) setGap(v); };
            num.addEventListener('change', applyCustom);
            num.addEventListener('input', () => { sel.value = 'custom'; });
            sel.addEventListener('change', () => {
                if (sel.value === 'custom') { num.focus(); return; }
                num.value = sel.value;
                setGap(parseInt(sel.value, 10));
            });
            const val = h('span', { class: 'gpue-ui-muted', text: cfg.gap + ' px' });
            const sync = () => { val.textContent = cfg.gap + ' px'; };
            num.addEventListener('change', sync);
            sel.addEventListener('change', sync);
            return h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, [
                h('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' }, [
                    h('span', { text: 'Расстояние между кнопками:' }),
                    sel, num, val
                ]),
                h('div', { class: 'gpue-hint', text: 'Одинаковый зазор между всеми кнопками верхнего ряда (🖼, 🎨, 👥, ⚙ UI). Скрытые кнопки зазор не создают. Применяется к обоим режимам и сохраняется.' })
            ]);
        }
        function init() {
            load();
            apply();
            setInterval(apply, 1000);   // кнопки создаются в разное время и меняют видимость | the buttons are created at different times and change visibility
            window.addEventListener('resize', apply);
        }
        return { init, row, apply, setGap };
    })();

    function init() {
        applyLayout();
        try { GPAppearance.init(); } catch (e) { console.warn('[UI Layout Editor] внешний вид недоступен:', e); }
        buildUI();
        try { buildWheel(); } catch (e) { console.warn('[UI Layout Editor] цветовой круг недоступен:', e); }
        try { buildRef(); } catch (e) { console.warn('[UI Layout Editor] окно референса недоступно:', e); }
        try { PlayersPanel.init(); } catch (e) { console.warn('[UI Layout Editor] окно «Игроки» недоступно:', e); }
        // одинаковые кнопки верхнего ряда с равным зазором (порт ToolLayout из студии)
        // uniform top-row buttons with an equal gap (a port of ToolLayout from the studio)
        try { ToolLayout.init(); } catch (e) { console.warn('[UI Layout Editor] раскладка кнопок инструментов недоступна:', e); }
        try { BrushSettings.init(); } catch (e) { console.warn('[UI Layout Editor] настройки кисти недоступны:', e); }
        // модули включаются и выключаются независимо; по умолчанию все выключены (поведение )
        // modules are enabled and disabled independently; by default all are disabled (the previous behavior)
        try { PressureSettings.init(); } catch (e) { console.warn('[UI Layout Editor] нажим кисти недоступен:', e); }
        try { PressureBake.init(); } catch (e) { console.warn('[UI Layout Editor] запекание нажима недоступно:', e); }
        try { CanvasPan.init(); } catch (e) { console.warn('[UI Layout Editor] перемещение холста недоступно:', e); }
        try { Lang.init(); } catch (e) { console.warn('[UI Layout Editor] язык интерфейса недоступен:', e); }
        setInterval(tick, 400);
    }

    if (document.body) init();
    else document.addEventListener('DOMContentLoaded', init);
})();