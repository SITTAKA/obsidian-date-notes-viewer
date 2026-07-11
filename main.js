'use strict';

const obsidian = require('obsidian');

const VIEW_TYPE = 'date-notes-viewer';

const DEFAULT_SETTINGS = {
  frontmatterKey: 'date-created',
  useFileCreationDate: false, // true = use file.stat.ctime instead of frontmatter
  colorPreset: 'purple',
  colors: {
    level0: '#45475a',
    level1: '#4a3d5c',
    level2: '#7a5aa8',
    level3: '#a586d8',
    level4: '#cba6f7',
    selectedOutline: '#f5c2e7',
    selectedOutlineDark: '#cba6f7',   // dark mode = light purple
    selectedOutlineLight: '#7a5aa8',  // light mode = dark purple
  },
  thresholds: {
    level1: 1,
    level2: 500,
    level3: 1500,
    level4: 3000,
  },
  visibility: {
    contrib: true,
    calendar: true,
    notes: true,
  },
};

const PRESETS = {
  purple:  ['#45475a', '#4a3d5c', '#7a5aa8', '#a586d8', '#cba6f7'],
  green:   ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'],
  blue:    ['#2a2f3d', '#1e3a5f', '#2d5a9e', '#4a8fdc', '#7cb8ff'],
  pink:    ['#45475a', '#5c3d55', '#a85a8f', '#d886b8', '#f7a6d3'],
  orange:  ['#45475a', '#5c4a3d', '#a8785a', '#d8a586', '#f7c6a6'],
  mono:    ['#3a3a3a', '#606060', '#909090', '#c0c0c0', '#f0f0f0'],
};

class DateNotesPlugin extends obsidian.Plugin {
  async onload() {
    await this.loadSettings();
    this.applyColorVars();
    this.registerView(VIEW_TYPE, (leaf) => new DateNotesView(leaf, this));
    this.addRibbonIcon('calendar-days', 'Date Notes Viewer', () => this.activateView());
    this.addCommand({ id: 'open-date-notes-viewer', name: 'Date Notes Viewer を開く', callback: () => this.activateView() });
    this.addSettingTab(new DateNotesSettingTab(this.app, this));
    this.registerEvent(this.app.vault.on('modify', () => this.refreshViews()));
    this.registerEvent(this.app.vault.on('create', () => this.refreshViews()));
    this.registerEvent(this.app.vault.on('delete', () => this.refreshViews()));
    this.registerEvent(this.app.metadataCache.on('changed', () => this.refreshViews()));
    // Re-apply outline color when theme switches (dark <-> light)
    this.registerEvent(this.app.workspace.on('css-change', () => this.applyColorVars()));
    // On mobile, metadata cache may not be ready when the view first opens
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.refreshViews()));
  }

  onunload() {
    // Clean up CSS variables we set on document.body
    ['--dnv-level-0','--dnv-level-1','--dnv-level-2','--dnv-level-3','--dnv-level-4','--dnv-selected-outline']
      .forEach(v => document.body.style.removeProperty(v));
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async loadSettings() {
    const loaded = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
    this.settings.colors = Object.assign({}, DEFAULT_SETTINGS.colors, this.settings.colors || {});
    this.settings.thresholds = Object.assign({}, DEFAULT_SETTINGS.thresholds, this.settings.thresholds || {});
    this.settings.visibility = Object.assign({}, DEFAULT_SETTINGS.visibility, this.settings.visibility || {});
    if (!this.settings.colors.selectedOutline) this.settings.colors.selectedOutline = '#f5c2e7';
    if (!this.settings.colors.selectedOutlineDark) this.settings.colors.selectedOutlineDark = '#cba6f7';
    if (!this.settings.colors.selectedOutlineLight) this.settings.colors.selectedOutlineLight = '#7a5aa8';
  }

  isDarkMode() {
    return document.body.classList.contains('theme-dark');
  }

  // Format a Date object or timestamp to YYYY-MM-DD
  formatDate(d) {
    if (typeof d === 'number') d = new Date(d);
    if (!(d instanceof Date) || isNaN(d)) return null;
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }

  // Resolve a note's date: prefer file.stat.ctime if useFileCreationDate is on, else frontmatter
  async resolveNoteDate(file, cache) {
    if (this.settings.useFileCreationDate) {
      // Use filesystem creation time
      if (file.stat && file.stat.ctime) {
        return this.formatDate(file.stat.ctime);
      }
      return null;
    }
    // Use frontmatter key
    const key = this.settings.frontmatterKey || 'date-created';
    let fm = cache && cache.frontmatter;
    let date = fm ? fm[key] : undefined;
    if (date === undefined) {
      // Manual parse fallback (mobile safety)
      try {
        const raw = await this.app.vault.cachedRead(file);
        const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (m) {
          const keyRe = new RegExp('^\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*"?([\\d\\-]+)"?', 'm');
          const km = m[1].match(keyRe);
          if (km) date = km[1];
        }
      } catch(e) {}
    }
    if (date === undefined || date === null) return null;
    if (date instanceof Date) return this.formatDate(date);
    const s = String(date).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.applyColorVars();
    this.refreshViews();
  }

  applyColorVars() {
    const c = this.settings.colors;
    document.body.style.setProperty('--dnv-level-0', c.level0);
    document.body.style.setProperty('--dnv-level-1', c.level1);
    document.body.style.setProperty('--dnv-level-2', c.level2);
    document.body.style.setProperty('--dnv-level-3', c.level3);
    document.body.style.setProperty('--dnv-level-4', c.level4);
    // Pick outline color based on current theme (dark/light)
    const isDark = this.isDarkMode();
    const outline = isDark ? (c.selectedOutlineDark || '#cba6f7') : (c.selectedOutlineLight || '#7a5aa8');
    document.body.style.setProperty('--dnv-selected-outline', outline);
  }

  applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    this.settings.colorPreset = name;
    const prevOutline = this.settings.colors && this.settings.colors.selectedOutline;
    this.settings.colors = { level0: p[0], level1: p[1], level2: p[2], level3: p[3], level4: p[4], selectedOutline: prevOutline || p[4] };
  }

  refreshViews() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach(leaf => {
      if (leaf.view instanceof DateNotesView) leaf.view.refresh();
    });
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  // Per-day average over the last 7 days: total chars / 7
  async computeWeeklyStats() {
    const key = this.settings.frontmatterKey || 'date-created';
    const files = this.app.vault.getMarkdownFiles();
    const today = new Date();
    today.setHours(0,0,0,0);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 6);
    let count = 0, total = 0, activeDays = 0;
    const perDay = {};
    for (const f of files) {
      const cache = this.app.metadataCache.getFileCache(f);
      const date = await this.resolveNoteDate(f, cache);
      if (!date) continue;
      const d = new Date(date);
      if (d < weekAgo || d > today) continue;
      try {
        const raw = await this.app.vault.cachedRead(f);
        const stripped = raw.replace(/^---\n[\s\S]*?\n---\n?/, '');
        total += stripped.length;
        count++;
        perDay[date] = (perDay[date] || 0) + stripped.length;
      } catch(e) {}
    }
    activeDays = Object.keys(perDay).length;
    return {
      avgPerDay: Math.round(total / 7),   // 7日で割った平均
      total,
      count,
      activeDays,
    };
  }
}

class DateNotesView extends obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.currentMonth = new Date();
    this.currentMonth.setDate(1);
    this.selectedDate = null;
    this.currentFilter = 'all';
    this.searchQuery = '';
    this.notes = [];
    this.charByDate = {};
    this.contribScrollLeft = null;
    this.showHelp = false;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Date Notes Viewer'; }
  getIcon() { return 'calendar-days'; }

  async onOpen() { this.refresh(); }
  async onClose() {}

  async collectNotes() {
    const files = this.app.vault.getMarkdownFiles();
    const notes = [];
    for (const f of files) {
      const cache = this.app.metadataCache.getFileCache(f);
      const date = await this.plugin.resolveNoteDate(f, cache);
      if (!date) continue;
      const fm = cache && cache.frontmatter;
      notes.push({ file: f, date, tags: (fm && fm.tags) || [] });
    }
    return notes;
  }

  async getCharCount(file) {
    try {
      const raw = await this.app.vault.cachedRead(file);
      const stripped = raw.replace(/^---\n[\s\S]*?\n---\n?/, '');
      return stripped.length;
    } catch(e) { return 0; }
  }

  async refresh() {
    this.notes = await this.collectNotes();
    this.charByDate = {};
    for (const n of this.notes) {
      const cc = await this.getCharCount(n.file);
      n.chars = cc;
      this.charByDate[n.date] = (this.charByDate[n.date] || 0) + cc;
    }
    this.render();
  }

  render() {
    const oldWrapper = this.contentEl.querySelector('.dnv-contrib-wrapper');
    if (oldWrapper) this.contribScrollLeft = oldWrapper.scrollLeft;
    const container = this.contentEl;
    container.empty();
    container.addClass('dnv-container');
    const vis = this.plugin.settings.visibility;
    if (vis.contrib) this.renderContrib(container);
    if (vis.calendar) this.renderCalendar(container);
    this.renderSearchAndFilters(container);
    if (vis.notes) this.renderList(container);
    if (this.contribScrollLeft !== null) {
      const nw = this.contentEl.querySelector('.dnv-contrib-wrapper');
      if (nw) nw.scrollLeft = this.contribScrollLeft;
    } else {
      const w = this.contentEl.querySelector('.dnv-contrib-wrapper');
      if (w) w.scrollLeft = w.scrollWidth;
    }
  }

  renderHeader(parent) {
    const bar = parent.createDiv({ cls: 'dnv-topbar' });
    bar.createDiv({ cls: 'dnv-topbar-title', text: 'Date Notes Viewer' });
    const help = bar.createEl('button', { cls: 'dnv-help-btn', text: '?' });
    help.setAttr('title', '使い方を表示');
    help.onclick = () => {
      this.showHelp = !this.showHelp;
      this.render();
    };
  }

  renderHelp(parent) {
    const box = parent.createDiv({ cls: 'dnv-section dnv-help' });
    box.createEl('h3', { text: '使い方' });
    const list = box.createEl('ul');
    const items = [
      'ノートのフロントマターに date-created: YYYY-MM-DD を追加すると、その日付でノートを集計します。',
      'コントリビューショングラフ: 直近53週の1日あたり合計文字数を色で表示。セルクリックでその日を絞り込みできます。',
      'カレンダー: 月ごとにノートのある日をハイライト。日付クリックで絞り込み。',
      'クイックフィルター: 今日 / 今週 / 今月 でリスト絞り込み。',
      '検索欄: ファイル名で絞り込み。',
      '設定タブ: 色/しきい値/セクションの表示切替/フロントマターキー変更などが可能。',
      'フロントマター例: ---\\ndate-created: 2026-07-08\\n---',
    ];
    items.forEach(t => {
      const li = list.createEl('li');
      // Preserve newlines in example lines
      t.split('\\n').forEach((line, i) => {
        if (i > 0) li.createEl('br');
        li.appendText(line);
      });
    });
  }
}

DateNotesView.prototype.rerenderCalendarAndList = function() {
  // Full re-render is safer for section-visibility toggling
  this.render();
};

DateNotesView.prototype.renderContrib = function(parent) {
  const section = parent.createDiv({ cls: 'dnv-section' });
  const head = section.createDiv({ cls: 'dnv-contrib-header' });
  head.createEl('h3', { text: 'コントリビューショングラフ' });
  const stats = head.createDiv({ cls: 'dnv-contrib-stats' });
  const wrapper = section.createDiv({ cls: 'dnv-contrib-wrapper' });
  const grid = wrapper.createDiv({ cls: 'dnv-contrib-grid' });

  const t = this.plugin.settings.thresholds;
  const levelFn = v => {
    if (!v || v < t.level1) return 0;
    if (v >= t.level4) return 4;
    if (v >= t.level3) return 3;
    if (v >= t.level2) return 2;
    return 1;
  };

  const today = new Date();
  today.setHours(0,0,0,0);
  const end = new Date(today);
  end.setDate(end.getDate() + (6 - end.getDay()));
  const start = new Date(end);
  start.setDate(start.getDate() - (53 * 7 - 1));

  let totalChars = 0, activeDays = 0;
  const cellByDate = {};

  for (let w = 0; w < 53; w++) {
    for (let d = 0; d < 7; d++) {
      const cellDate = new Date(start);
      cellDate.setDate(cellDate.getDate() + w * 7 + d);
      const cell = grid.createDiv({ cls: 'dnv-contrib-cell' });
      cell.style.gridColumn = (w + 1);
      cell.style.gridRow = (d + 1);
      if (cellDate > today) { cell.style.visibility = 'hidden'; continue; }
      const dateStr = cellDate.getFullYear() + '-' + String(cellDate.getMonth()+1).padStart(2,'0') + '-' + String(cellDate.getDate()).padStart(2,'0');
      cellByDate[dateStr] = cell;
      const chars = this.charByDate[dateStr] || 0;
      const lv = levelFn(chars);
      if (lv > 0) cell.addClass('l' + lv);
      if (dateStr === this.selectedDate) cell.addClass('selected');
      if (chars > 0) { totalChars += chars; activeDays++; }
      const notesForDay = this.notes.filter(n => n.date === dateStr).length;
      cell.setAttr('title', dateStr + '\n' + chars.toLocaleString() + ' 文字 / ' + notesForDay + ' 件');
      cell.addEventListener('click', () => {
        const prev = this.selectedDate;
        this.selectedDate = this.selectedDate === dateStr ? null : dateStr;
        if (prev && cellByDate[prev]) cellByDate[prev].removeClass('selected');
        if (this.selectedDate && cellByDate[this.selectedDate]) cellByDate[this.selectedDate].addClass('selected');
        if (this.selectedDate) this.currentMonth = new Date(cellDate.getFullYear(), cellDate.getMonth(), 1);
        this.currentFilter = 'all';
        this.render();
      });
    }
  }
  stats.textContent = '直近53週 · ' + activeDays + '日 · 合計 ' + totalChars.toLocaleString() + '文字';

  const legend = section.createDiv({ cls: 'dnv-contrib-legend' });
  legend.appendText('少ない');
  for (let i = 0; i <= 4; i++) {
    const c = legend.createDiv({ cls: 'dnv-contrib-cell' + (i ? ' l' + i : '') });
    c.style.cursor = 'default';
  }
  legend.appendText('多い');
};

DateNotesView.prototype.renderCalendar = function(parent) {
  const section = parent.createDiv({ cls: 'dnv-section' });
  const head = section.createDiv({ cls: 'dnv-cal-header' });
  const prev = head.createEl('button', { text: '‹' });
  prev.onclick = () => { this.currentMonth = new Date(this.currentMonth.getFullYear(), this.currentMonth.getMonth() - 1, 1); this.render(); };
  const label = head.createDiv({ cls: 'dnv-month-label' });
  label.textContent = this.currentMonth.getFullYear() + '年 ' + (this.currentMonth.getMonth()+1) + '月';
  const next = head.createEl('button', { text: '›' });
  next.onclick = () => { this.currentMonth = new Date(this.currentMonth.getFullYear(), this.currentMonth.getMonth() + 1, 1); this.render(); };

  const cal = section.createDiv({ cls: 'dnv-calendar' });
  ['日','月','火','水','木','金','土'].forEach(d => cal.createDiv({ cls: 'dnv-cal-day-name', text: d }));

  const t = this.plugin.settings.thresholds;
  const levelFn = v => {
    if (!v || v < t.level1) return 0;
    if (v >= t.level4) return 4;
    if (v >= t.level3) return 3;
    if (v >= t.level2) return 2;
    return 1;
  };

  const y = this.currentMonth.getFullYear();
  const m = this.currentMonth.getMonth();
  const first = new Date(y, m, 1);
  const startDay = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prevDays = new Date(y, m, 0).getDate();
  const today = new Date();
  const todayStr = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');

  for (let i = startDay - 1; i >= 0; i--) {
    cal.createDiv({ cls: 'dnv-cal-day other-month', text: String(prevDays - i) });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = y + '-' + String(m+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    const el = cal.createDiv({ cls: 'dnv-cal-day', text: String(d) });
    // Color the calendar day by that day's total chars (uses same level as contrib)
    const chars = this.charByDate[dateStr] || 0;
    const lv = levelFn(chars);
    if (lv > 0) el.addClass('l' + lv);
    if (dateStr === todayStr) el.addClass('today');
    if (dateStr === this.selectedDate) el.addClass('selected');
    el.onclick = () => {
      this.selectedDate = this.selectedDate === dateStr ? null : dateStr;
      this.currentFilter = 'all';
      this.render();
    };
  }
  const trailing = (7 - ((startDay + daysInMonth) % 7)) % 7;
  for (let i = 1; i <= trailing; i++) {
    cal.createDiv({ cls: 'dnv-cal-day other-month', text: String(i) });
  }
};

DateNotesView.prototype.renderSearchAndFilters = function(parent) {
  const section = parent.createDiv({ cls: 'dnv-section' });
  const search = section.createEl('input', { cls: 'dnv-search', type: 'text', placeholder: 'ノート名で検索...' });
  search.value = this.searchQuery;
  search.addEventListener('input', (e) => {
    this.searchQuery = e.target.value;
    this.renderListOnly();
  });
  const filters = section.createDiv({ cls: 'dnv-filters' });
  const opts = [['all','全て'],['today','今日'],['week','今週'],['month','今月']];
  opts.forEach(([k,l]) => {
    const b = filters.createEl('button', { cls: 'dnv-filter' + (this.currentFilter === k ? ' active' : ''), text: l });
    b.onclick = () => {
      this.currentFilter = k;
      this.selectedDate = null;
      this.render();
    };
  });
};

DateNotesView.prototype.filteredNotes = function() {
  const q = (this.searchQuery || '').toLowerCase();
  const today = new Date();
  const todayStr = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
  return this.notes.filter(n => {
    if (this.selectedDate && n.date !== this.selectedDate) return false;
    if (this.currentFilter === 'today' && n.date !== todayStr) return false;
    if (this.currentFilter === 'week') {
      const d = new Date(n.date);
      const diff = (today - d) / (1000*60*60*24);
      if (diff < 0 || diff > 7) return false;
    }
    if (this.currentFilter === 'month') {
      const d = new Date(n.date);
      if (d.getFullYear() !== today.getFullYear() || d.getMonth() !== today.getMonth()) return false;
    }
    if (q && !n.file.basename.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a,b) => b.date.localeCompare(a.date));
};

DateNotesView.prototype.renderList = function(parent) {
  this.listSection = parent.createDiv({ cls: 'dnv-section' });
  this.renderListOnly();
};

DateNotesView.prototype.renderListOnly = function() {
  if (!this.listSection) return;
  this.listSection.empty();
  const head = this.listSection.createDiv({ cls: 'dnv-list-header' });
  const title = head.createDiv({ cls: 'dnv-list-title' });
  if (this.selectedDate) title.textContent = this.selectedDate + ' のノート';
  else if (this.currentFilter === 'today') title.textContent = '今日のノート';
  else if (this.currentFilter === 'week') title.textContent = '今週のノート';
  else if (this.currentFilter === 'month') title.textContent = '今月のノート';
  else title.textContent = '全てのノート';
  const filtered = this.filteredNotes();
  head.createDiv({ cls: 'dnv-count', text: filtered.length + '件' });
  if (!filtered.length) {
    this.listSection.createDiv({ cls: 'dnv-empty', text: '該当するノートがありません' });
    return;
  }
  for (const n of filtered) {
    const card = this.listSection.createDiv({ cls: 'dnv-note' });
    const h = card.createDiv({ cls: 'dnv-note-head' });
    h.createDiv({ cls: 'dnv-note-title', text: n.file.basename });
    h.createDiv({ cls: 'dnv-note-date', text: n.date });
    card.onclick = (ev) => this.app.workspace.getLeaf(ev.ctrlKey || ev.metaKey ? 'tab' : false).openFile(n.file);
  }
};

class DateNotesSettingTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const containerEl = this.containerEl;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Date Notes Viewer 設定' });

    // ---- Help (collapsible) ----
    const helpDetails = containerEl.createEl('details', { cls: 'dnv-help-details' });
    helpDetails.createEl('summary', { text: '使い方 (?)' });
    const helpUl = helpDetails.createEl('ul', { cls: 'dnv-help-list' });
    [
      'ノートのフロントマターに date-created: YYYY-MM-DD を追加すると、その日付でノートが集計されます。',
      'コントリビューショングラフ: 直近53週の1日あたり合計文字数を色で表示。セルクリックでその日のノートに絞り込みます。',
      'カレンダー: 月ごとに文字数レベルで色付け。日付クリックで絞り込み、選択日は枠線で表示されます。',
      'クイックフィルター: 今日 / 今週 / 今月 でノートを絞り込みます。',
      '検索欄: ファイル名で絞り込みます。',
      'セクションの表示: 下の設定でコントリビューショングラフ・カレンダー・ノートリストを個別に非表示にできます。',
      '色: プリセット選択、またはレベル0〜4を個別に指定できます。選択日のアウトライン色も変更可能。',
      'しきい値: 各レベルに到達する最低文字数を1日単位で指定します。',
    ].forEach(t => helpUl.createEl('li', { text: t }));
    const example = helpDetails.createEl('pre', { cls: 'dnv-help-example' });
    example.textContent = '---\ndate-created: 2026-07-08\ntags: [journal]\n---\n\n本文...';

    // ---- Weekly stats (rendered sync with placeholders, populated async) ----
    containerEl.createEl('h3', { text: '直近1週間の統計' });
    const statsRow = containerEl.createDiv({ cls: 'dnv-settings-stats' });
    const b1 = statsRow.createDiv({ cls: 'dnv-settings-stat-box' });
    const v1 = b1.createDiv({ cls: 'dnv-settings-stat-value', text: '...' });
    b1.createDiv({ cls: 'dnv-settings-stat-label', text: '1日あたりの平均文字数' });
    const b2 = statsRow.createDiv({ cls: 'dnv-settings-stat-box' });
    const v2 = b2.createDiv({ cls: 'dnv-settings-stat-value', text: '...' });
    b2.createDiv({ cls: 'dnv-settings-stat-label', text: 'アクティブ日数' });
    const b3 = statsRow.createDiv({ cls: 'dnv-settings-stat-box' });
    const v3 = b3.createDiv({ cls: 'dnv-settings-stat-value', text: '...' });
    b3.createDiv({ cls: 'dnv-settings-stat-label', text: '合計文字数' });
    // Populate asynchronously so failure doesn't break the rest of the settings tab (mobile safe)
    this.plugin.computeWeeklyStats().then(stats => {
      v1.textContent = stats.avgPerDay.toLocaleString();
      v2.textContent = String(stats.activeDays);
      v3.textContent = stats.total.toLocaleString();
    }).catch(() => {
      v1.textContent = '—';
      v2.textContent = '—';
      v3.textContent = '—';
    });

    // ---- Section visibility ----
    containerEl.createEl('h3', { text: 'セクションの表示' });
    const visLabels = { contrib: 'コントリビューショングラフ', calendar: 'カレンダー', notes: 'ノートリスト' };
    ['contrib', 'calendar', 'notes'].forEach(key => {
      new obsidian.Setting(containerEl)
        .setName(visLabels[key])
        .addToggle(t => t
          .setValue(this.plugin.settings.visibility[key])
          .onChange(async (v) => {
            this.plugin.settings.visibility[key] = v;
            await this.plugin.saveSettings();
          }));
    });

    // ---- Date source ----
    containerEl.createEl('h3', { text: '日付のソース' });

    new obsidian.Setting(containerEl)
      .setName('ファイルの作成日を使う')
      .setDesc('ON: OSのファイル作成日時 (file.stat.ctime) を使う / OFF: フロントマターのキーを使う')
      .addToggle(t => t
        .setValue(this.plugin.settings.useFileCreationDate)
        .onChange(async (v) => {
          this.plugin.settings.useFileCreationDate = v;
          await this.plugin.saveSettings();
          this.display();
        }));

    const fmSetting = new obsidian.Setting(containerEl)
      .setName('フロントマターのキー名')
      .setDesc('「ファイルの作成日を使う」がOFFのときに参照されます (デフォルト: date-created)')
      .addText(t => t
        .setPlaceholder('date-created')
        .setValue(this.plugin.settings.frontmatterKey)
        .setDisabled(this.plugin.settings.useFileCreationDate)
        .onChange(async (v) => {
          this.plugin.settings.frontmatterKey = v || 'date-created';
          await this.plugin.saveSettings();
        }));
    if (this.plugin.settings.useFileCreationDate) {
      fmSetting.settingEl.style.opacity = '0.5';
    }

    // ---- Colors ----
    containerEl.createEl('h3', { text: 'コントリビューショングラフの色' });

    new obsidian.Setting(containerEl)
      .setName('カラープリセット')
      .setDesc('選択するとレベル0-4の色が一括変更されます')
      .addDropdown(d => {
        Object.keys(PRESETS).forEach(k => d.addOption(k, k));
        d.setValue(this.plugin.settings.colorPreset || 'purple');
        d.onChange(async (v) => {
          this.plugin.applyPreset(v);
          await this.plugin.saveSettings();
          this.display();
        });
      });

    const previewSetting = new obsidian.Setting(containerEl)
      .setName('プレビュー')
      .setDesc('現在の色設定 (レベル0 → レベル4)');
    const strip = previewSetting.settingEl.createDiv({ cls: 'dnv-preview-strip' });
    const c = this.plugin.settings.colors;
    [c.level0, c.level1, c.level2, c.level3, c.level4].forEach(col => {
      const box = strip.createDiv();
      box.style.background = col;
    });

    const colorLabels = ['レベル0 (データなし)', 'レベル1 (少ない)', 'レベル2', 'レベル3', 'レベル4 (多い)'];
    ['level0','level1','level2','level3','level4'].forEach((key, i) => {
      new obsidian.Setting(containerEl)
        .setName(colorLabels[i])
        .addColorPicker(cp => cp
          .setValue(this.plugin.settings.colors[key])
          .onChange(async (v) => {
            this.plugin.settings.colors[key] = v;
            this.plugin.settings.colorPreset = 'custom';
            await this.plugin.saveSettings();
            strip.children[i].style.background = v;
          }));
    });

    new obsidian.Setting(containerEl)
      .setName('選択日アウトライン色 (ダークモード)')
      .setDesc('カレンダー・コントリビューショングラフ共通。デフォルト: 紫')
      .addColorPicker(cp => cp
        .setValue(this.plugin.settings.colors.selectedOutlineDark || '#cba6f7')
        .onChange(async (v) => {
          this.plugin.settings.colors.selectedOutlineDark = v;
          this.plugin.settings.colorPreset = 'custom';
          await this.plugin.saveSettings();
        }));

    new obsidian.Setting(containerEl)
      .setName('選択日アウトライン色 (ライトモード)')
      .setDesc('カレンダー・コントリビューショングラフ共通。デフォルト: 紫')
      .addColorPicker(cp => cp
        .setValue(this.plugin.settings.colors.selectedOutlineLight || '#7a5aa8')
        .onChange(async (v) => {
          this.plugin.settings.colors.selectedOutlineLight = v;
          this.plugin.settings.colorPreset = 'custom';
          await this.plugin.saveSettings();
        }));

    new obsidian.Setting(containerEl)
      .setName('色をデフォルトに戻す')
      .addButton(b => b
        .setButtonText('リセット')
        .setWarning()
        .onClick(async () => {
          this.plugin.settings.colors = Object.assign({}, DEFAULT_SETTINGS.colors);
          this.plugin.settings.colorPreset = 'purple';
          await this.plugin.saveSettings();
          this.display();
        }));

    // ---- Thresholds ----
    containerEl.createEl('h3', { text: '文字数のしきい値' });
    const desc = containerEl.createEl('p', {
      text: '各レベルに到達するために必要な最低文字数(1日あたりの合計)。',
    });
    desc.style.fontSize = '12px';
    desc.style.color = 'var(--text-muted)';

    const thresholdLabels = {
      level1: 'レベル1 (少ない) 最低文字数',
      level2: 'レベル2 最低文字数',
      level3: 'レベル3 最低文字数',
      level4: 'レベル4 (多い) 最低文字数',
    };

    ['level1', 'level2', 'level3', 'level4'].forEach(key => {
      new obsidian.Setting(containerEl)
        .setName(thresholdLabels[key])
        .addText(t => t
          .setValue(String(this.plugin.settings.thresholds[key]))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n) && n >= 0) {
              this.plugin.settings.thresholds[key] = n;
              await this.plugin.saveSettings();
            }
          }));
    });

    new obsidian.Setting(containerEl)
      .setName('しきい値をデフォルトに戻す')
      .setDesc('1 / 500 / 1500 / 3000')
      .addButton(b => b
        .setButtonText('リセット')
        .setWarning()
        .onClick(async () => {
          this.plugin.settings.thresholds = Object.assign({}, DEFAULT_SETTINGS.thresholds);
          await this.plugin.saveSettings();
          this.display();
        }));
  }
}

module.exports = DateNotesPlugin;
