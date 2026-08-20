import './stuff-dialog.js';
import './stuff-item-card.js';
import './stuff-toast-region.js';

import { APP_VERSION, GOOGLE_CONFIG, isGoogleConfigured } from '../config.js';
import { DemoDatabase, DemoMediaService } from '../data/demo-database.js';
import { EditConflictError, StuffSheetDatabase } from '../data/sheet-database.js';
import { SearchIndex } from '../search/search-index.js';
import { DriveClient } from '../services/drive-client.js';
import { GoogleApiClient, GoogleApiError, friendlyGoogleError } from '../services/google-api.js';
import { GoogleAuthService } from '../services/google-auth.js';
import { GooglePickerService } from '../services/google-picker.js';
import { MediaService } from '../services/media-service.js';
import { SheetsClient } from '../services/sheets-client.js';
import { preferences, tokenVault } from '../services/storage.js';
import { debounce, humanFileSize, isIos, parseTags } from '../utils.js';
import { button, element, externalLink, fieldLabel, option } from './dom.js';

const NAVIGATION = Object.freeze([
  { route: 'search', label: 'Find', icon: '⌕' },
  { route: 'places', label: 'Places', icon: '⌂' },
  { route: 'add', label: 'Add', icon: '+' },
  { route: 'settings', label: 'Settings', icon: '⚙' },
]);

function currentRoute() {
  const route = globalThis.location.hash.replace(/^#\/?/, '').split('/')[0];
  return ['search', 'places', 'settings'].includes(route) ? route : 'search';
}

function localDemoAvailable() {
  return ['localhost', '127.0.0.1', '::1'].includes(globalThis.location.hostname);
}

function entityTitle(entity, type) {
  return type === 'Place' ? (entity.path || entity.name) : entity.name;
}

export class StuffApp extends HTMLElement {
  constructor() {
    super();
    this.auth = new GoogleAuthService();
    this.api = null;
    this.drive = null;
    this.sheets = null;
    this.picker = null;
    this.database = null;
    this.media = null;
    this.profile = null;
    this.searchIndex = new SearchIndex();
    this.searchQuery = '';
    this.placeFilter = '';
    this.photoFilter = 'all';
    this.installPrompt = null;
    this.pendingUpdateWorker = null;
    this.demo = false;
    this.reconnectNeeded = false;
    this.boundHashChange = () => this.renderApplication();
    this.boundOnlineChange = () => this.updateConnectivityBanner();
  }

  connectedCallback() {
    this.renderLoading('Opening stuff…');
    globalThis.addEventListener('hashchange', this.boundHashChange);
    globalThis.addEventListener('online', this.boundOnlineChange);
    globalThis.addEventListener('offline', this.boundOnlineChange);
    globalThis.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.installPrompt = event;
      this.updateInstallButtons();
    });
    this.setupServiceWorker();
    this.boot();
  }

  disconnectedCallback() {
    globalThis.removeEventListener('hashchange', this.boundHashChange);
    globalThis.removeEventListener('online', this.boundOnlineChange);
    globalThis.removeEventListener('offline', this.boundOnlineChange);
    this.media?.destroy?.();
  }

  async boot() {
    try {
      const demoRequested = localDemoAvailable() && new URL(globalThis.location.href).searchParams.get('demo') === '1';
      if (demoRequested) {
        await this.useDemo();
        return;
      }
      if (!isGoogleConfigured()) {
        this.renderConnection({ configurationMissing: true });
        return;
      }
      if (!tokenVault.get()) {
        this.renderConnection();
        return;
      }
      await this.prepareGoogleServices();
      await this.resumeAfterAuthorization();
    } catch (error) {
      this.handleError(error);
      this.renderConnection();
    }
  }

  async prepareGoogleServices() {
    this.api = new GoogleApiClient({
      getAccessToken: () => tokenVault.get(),
      onAuthorizationError: () => this.requireReconnect(),
    });
    this.drive = new DriveClient(this.api, {
      getAccessToken: () => tokenVault.get(),
      onAuthorizationError: () => this.requireReconnect(),
    });
    this.sheets = new SheetsClient(this.api);
    this.picker = new GooglePickerService({ getAccessToken: () => tokenVault.get() });
    const about = await this.drive.getAbout();
    this.profile = about.user || null;
  }

  async resumeAfterAuthorization() {
    const spreadsheetId = preferences.spreadsheetId;
    if (!spreadsheetId) {
      this.renderOnboarding();
      return;
    }
    await this.connectInventory(spreadsheetId);
  }

  async useDemo() {
    this.demo = true;
    this.profile = { displayName: 'Demo household', emailAddress: 'Local preview' };
    this.database = new DemoDatabase();
    this.media = new DemoMediaService(this.database);
    this.refreshSearchIndex();
    if (!globalThis.location.hash) globalThis.location.hash = '#/search';
    this.renderApplication();
  }

  renderLoading(message) {
    this.replaceChildren(element('main', { className: 'app-loading', attributes: { 'aria-live': 'polite' } }, [
      element('div', {}, [element('div', { className: 'spinner', attributes: { 'aria-hidden': 'true' } }), element('p', { text: message })]),
    ]));
  }

  connectionFrame(panelContent) {
    const brand = element('div', { className: 'brand' }, [
      element('img', { src: 'assets/icons/icon.svg', alt: '', attributes: { width: '38', height: '38' } }),
      element('span', { text: 'stuff' }),
    ]);
    return element('main', { className: 'connection-layout' }, [
      element('section', { className: 'connection-visual' }, [
        brand,
        element('div', { className: 'connection-copy' }, [
          element('h1', { text: 'Everything has a place.' }),
          element('p', { text: 'A visual home inventory that helps you find the map, charger, winter jacket, or mysterious box—without turning your home into a database project.' }),
        ]),
        element('p', { className: 'connection-note', text: 'Your Sheet. Your Drive. No stuff server in between.' }),
      ]),
      element('section', { className: 'connection-panel' }, panelContent),
    ]);
  }

  renderConnection({ configurationMissing = false } = {}) {
    const card = element('div', { className: 'connection-card' });
    card.append(
      element('p', { className: 'eyebrow', text: configurationMissing ? 'One-time setup needed' : 'Private by design' }),
      element('h2', { text: configurationMissing ? 'Connect the Google project' : 'Open your inventory' }),
      element('p', {
        className: 'lede',
        text: configurationMissing
          ? 'The application is ready, but its public Google OAuth identifiers have not been added to src/config.js yet.'
          : 'Authorize the Google account that owns—or has access to—the stuff inventory.',
      }),
    );
    if (configurationMissing) {
      card.append(element('div', { className: 'notice warning' }, [
        element('strong', { text: 'Missing public configuration' }),
        element('p', { text: 'Add the OAuth client ID, restricted Picker API key, and Cloud project number. No client secret belongs in this app.' }),
      ]));
      if (localDemoAvailable()) {
        card.append(button('Preview with local demo data', {
          className: 'button terracotta',
          onClick: async () => {
            const url = new URL(globalThis.location.href);
            url.searchParams.set('demo', '1');
            globalThis.history.replaceState({}, '', url);
            await this.useDemo();
          },
        }));
      }
      card.append(element('p', { className: 'field-hint', text: 'Google Cloud setup instructions are in README.md.' }));
    } else {
      const remember = element('input', { type: 'checkbox', checked: preferences.rememberAccess, attributes: { id: 'remember-access' } });
      remember.addEventListener('change', () => { preferences.rememberAccess = remember.checked; });
      card.append(element('div', { className: 'remember-box' }, [
        element('label', { className: 'remember-line' }, [remember, element('span', { text: 'Remember access on this device' })]),
        element('p', { text: 'This stores Google’s short-lived token until just before it expires. Any script running on this origin could use it during that time. Disable this on shared devices.' }),
      ]));
      const connectButton = button('Continue with Google', {
        className: 'button terracotta',
        onClick: async () => {
          connectButton.disabled = true;
          try {
            await this.auth.connect({ remember: remember.checked, prompt: 'consent' });
            await this.prepareGoogleServices();
            await this.resumeAfterAuthorization();
          } catch (error) {
            connectButton.disabled = false;
            this.handleError(error);
          }
        },
      });
      card.append(connectButton, element('p', { className: 'field-hint' }, [
        'stuff requests only ', element('code', { text: 'drive.file' }), ' access to files it creates or you explicitly select. ',
        element('a', { text: 'Privacy details', href: 'privacy.html' }),
      ]));
    }
    this.replaceChildren(this.connectionFrame(card));
  }

  renderOnboarding() {
    const card = element('div', { className: 'connection-card' }, [
      element('p', { className: 'eyebrow', text: 'Google connected' }),
      element('h2', { text: 'Where is your stuff?' }),
      element('p', { className: 'lede', text: 'Create a fresh inventory or choose a stuff Sheet that was shared with this Google account.' }),
    ]);
    const create = button('Create inventory in My Drive', { className: 'button terracotta', onClick: () => this.createInventory('') });
    const chooseLocation = button('Choose location…', {
      className: 'button secondary',
      onClick: async () => {
        try {
          const parent = await this.picker.pickFolder();
          if (parent) await this.createInventory(parent.id);
        } catch (error) { this.handleError(error); }
      },
    });
    const chooseExisting = button('Choose existing inventory', {
      className: 'button secondary',
      onClick: async () => {
        try {
          const file = await this.picker.pickSpreadsheet();
          if (!file) return;
          preferences.spreadsheetId = file.id;
          await this.connectInventory(file.id);
        } catch (error) { this.handleError(error); }
      },
    });
    card.append(element('div', { className: 'button-stack' }, [create, chooseLocation, chooseExisting]));
    card.append(element('div', { className: 'notice' }, [
      element('strong', { text: 'The default is intentionally one click.' }),
      element('p', { text: 'stuff creates its own “stuff” folder. You can move or rename that folder later in Drive; the app follows stable file IDs.' }),
    ]));
    this.replaceChildren(this.connectionFrame(card), this.createToastRegion());
  }

  async createInventory(parentFolderId) {
    this.renderLoading('Creating folders and your Sheet…');
    try {
      if (parentFolderId) {
        const parent = await this.drive.getFile(parentFolderId);
        if (parent.driveId) throw new Error('Choose a folder in My Drive. Shared Drives are not supported in V1.');
      }
      const { database } = await StuffSheetDatabase.create({
        sheets: this.sheets,
        drive: this.drive,
        parentFolderId,
        appVersion: APP_VERSION,
      });
      preferences.spreadsheetId = database.spreadsheetId;
      await this.activateDatabase(database);
    } catch (error) {
      this.renderOnboarding();
      this.handleError(error);
    }
  }

  async connectInventory(spreadsheetId) {
    this.renderLoading('Inspecting the inventory…');
    try {
      const database = await StuffSheetDatabase.connect({ spreadsheetId, sheets: this.sheets, drive: this.drive, appVersion: APP_VERSION });
      preferences.spreadsheetId = spreadsheetId;
      if (database.inspection.state === 'current') {
        await this.activateDatabase(database);
      } else {
        this.database = database;
        this.renderSchemaState();
      }
    } catch (error) {
      preferences.spreadsheetId = '';
      this.renderOnboarding();
      this.handleError(error);
    }
  }

  async activateDatabase(database, { readOnly = false } = {}) {
    this.media?.destroy?.();
    this.database = database;
    this.media = new MediaService({ drive: this.drive, database, picker: this.picker });
    this.refreshSearchIndex();
    if (!globalThis.location.hash) globalThis.location.hash = '#/search';
    this.readOnly = readOnly || !database.writeEnabled;
    this.renderApplication();
  }

  renderSchemaState() {
    const state = this.database.inspection.state;
    const card = element('div', { className: 'connection-card' }, [
      element('p', { className: 'eyebrow', text: `Schema: ${state}` }),
      element('h2', { text: state === 'newer' ? 'This Sheet is ahead of the app' : state === 'repairable' ? 'The Sheet needs a safe repair' : state === 'upgradeable' || state === 'interrupted' ? 'The Sheet needs an upgrade' : 'This is not a compatible stuff Sheet' }),
    ]);
    this.database.inspection.messages.forEach((message) => card.append(element('div', { className: 'notice warning' }, element('p', { text: message }))));
    const actions = element('div', { className: 'button-stack' });
    if (state === 'repairable') {
      actions.append(button('Preview and repair generated columns', {
        className: 'button terracotta',
        onClick: () => this.confirmRepair(),
      }));
    }
    if (state === 'upgradeable' || state === 'interrupted') {
      actions.append(button(state === 'interrupted' ? 'Resume migration' : 'Back up and migrate', {
        className: 'button terracotta',
        onClick: async () => {
          this.renderLoading('Backing up and upgrading the Sheet…');
          try {
            await this.database.migrate();
            await this.activateDatabase(this.database);
          } catch (error) {
            this.renderSchemaState();
            this.handleError(error);
          }
        },
      }));
    }
    if (this.database.data.items.length || this.database.data.places.length) {
      actions.append(button('Browse read-only', { className: 'button secondary', onClick: () => this.activateDatabase(this.database, { readOnly: true }) }));
    }
    if (this.database.inspection.resourceIssues?.some((issue) => issue.code === 'unavailable')) {
      actions.append(button('Authorize the existing stuff folder…', {
        className: 'button secondary',
        onClick: async () => {
          try {
            const selected = await this.picker.pickFolder();
            if (!selected) return;
            if (selected.id !== this.database.settings.get('root_folder_id')) throw new Error('Choose the existing stuff root folder referenced by this inventory, not a new parent folder.');
            await this.connectInventory(this.database.spreadsheetId);
          } catch (error) { this.handleError(error); }
        },
      }));
    }
    actions.append(button('Choose another inventory', {
      className: 'button secondary',
      onClick: () => { preferences.spreadsheetId = ''; this.renderOnboarding(); },
    }));
    card.append(actions);
    this.dialog = document.createElement('stuff-dialog');
    this.replaceChildren(this.connectionFrame(card), this.dialog, this.createToastRegion());
  }

  createToastRegion() {
    const region = document.createElement('stuff-toast-region');
    this.toastRegion = region;
    return region;
  }

  showToast(message, options) {
    if (!this.toastRegion?.isConnected) {
      const region = this.createToastRegion();
      this.append(region);
    }
    this.toastRegion.show(String(message), options);
  }

  renderApplication() {
    if (!this.database) return;
    const route = currentRoute();
    const sidebar = element('aside', { className: 'sidebar' }, [
      element('a', { className: 'brand', href: '#/search' }, [
        element('img', { src: 'assets/icons/icon.svg', alt: '', attributes: { width: '38', height: '38' } }),
        element('span', { text: 'stuff' }),
      ]),
      this.buildNavigation(route, false),
      element('div', { className: 'sidebar-bottom' }, [
        element('div', { text: this.profile?.displayName || 'Google connected' }),
        element('div', { text: this.demo ? 'Local demo' : `Schema v${this.database.settings.get('schema_version') || '?'}` }),
      ]),
    ]);
    const mobileHeader = element('header', { className: 'mobile-header' }, [
      element('a', { className: 'brand', href: '#/search' }, [element('img', { src: 'assets/icons/icon.svg', alt: '' }), element('span', { text: 'stuff' })]),
      button('+ Add', { className: 'button terracotta', disabled: this.readOnly, onClick: () => this.openItemForm() }),
    ]);
    this.main = element('main', { className: 'app-main' });
    const shell = element('div', { className: 'app-shell' }, [sidebar, mobileHeader, this.main, this.buildNavigation(route, true)]);
    const children = [];
    if (!globalThis.navigator.onLine) children.push(element('div', { className: 'offline-banner', text: 'You are offline. Browsing loaded data is safe; Google reads and writes are unavailable.' }));
    if (this.reconnectNeeded) children.push(this.createReconnectBanner());
    if (this.readOnly) children.push(element('div', { className: 'schema-banner', text: `Read-only: schema state is ${this.database.inspection.state}.` }));
    this.dialog = document.createElement('stuff-dialog');
    children.push(shell, this.dialog, this.createToastRegion());
    this.replaceChildren(...children);
    this.renderRoute(route);
    if (this.pendingUpdateWorker) {
      const worker = this.pendingUpdateWorker;
      this.pendingUpdateWorker = null;
      this.offerUpdate(worker);
    }
  }

  buildNavigation(route, mobile) {
    const container = element('nav', { className: mobile ? 'mobile-nav' : 'nav-list', attributes: { 'aria-label': 'Primary' } });
    NAVIGATION.forEach((item) => {
      const navButton = element('button', {
        className: 'nav-button',
        type: 'button',
        attributes: item.route === route ? { 'aria-current': 'page' } : {},
        on: {
          click: () => {
            if (item.route === 'add') this.openItemForm();
            else globalThis.location.hash = `#/${item.route}`;
          },
        },
      }, [element('span', { className: 'nav-icon', text: item.icon, attributes: { 'aria-hidden': 'true' } }), element('span', { text: item.label })]);
      if (item.route === 'add' && this.readOnly) navButton.disabled = true;
      container.append(navButton);
    });
    return container;
  }

  renderRoute(route) {
    if (!this.main) return;
    if (route === 'places') this.renderPlaces();
    else if (route === 'settings') this.renderSettings();
    else this.renderSearch();
  }

  refreshSearchIndex() {
    const placesById = new Map(this.database.data.places.map((place) => [place.id, place]));
    this.searchIndex.rebuild(this.database.data.items, placesById);
  }

  renderSearch() {
    const add = button('+ Add item', { className: 'button terracotta', disabled: this.readOnly, onClick: () => this.openItemForm() });
    const header = element('header', { className: 'page-header' }, [
      element('div', { className: 'page-header-copy' }, [element('p', { className: 'eyebrow', text: 'Home inventory' }), element('h1', { className: 'page-title', text: 'Find anything' }), element('p', { text: 'Search names, descriptions, tags, and every level of location.' })]),
      add,
    ]);
    const search = element('input', { type: 'search', value: this.searchQuery, placeholder: 'Try “maps”, “charger”, or “basement”…', attributes: { 'aria-label': 'Search inventory', autocomplete: 'off' } });
    const searchWrap = element('div', { className: 'search-field' }, [element('span', { className: 'search-symbol', text: '⌕', attributes: { 'aria-hidden': 'true' } }), search]);
    const location = element('select', { className: 'select', attributes: { 'aria-label': 'Filter by place' } }, [option('', 'Everywhere', !this.placeFilter)]);
    [...this.database.data.places].sort((a, b) => String(a.path).localeCompare(String(b.path))).forEach((place) => location.append(option(place.id, place.path || place.name, place.id === this.placeFilter)));
    const photo = element('select', { className: 'select', attributes: { 'aria-label': 'Filter by photos' } }, [
      option('all', 'All photos', this.photoFilter === 'all'), option('with', 'With photos', this.photoFilter === 'with'), option('without', 'Without photos', this.photoFilter === 'without'),
    ]);
    const view = element('div', { className: 'segmented', attributes: { role: 'group', 'aria-label': 'Result view' } }, [
      element('button', { text: '▦', type: 'button', attributes: { 'aria-label': 'Masonry grid', 'aria-pressed': String(preferences.viewMode === 'grid') }, on: { click: () => { preferences.viewMode = 'grid'; this.renderSearchResults(); } } }),
      element('button', { text: '☷', type: 'button', attributes: { 'aria-label': 'Compact list', 'aria-pressed': String(preferences.viewMode === 'list') }, on: { click: () => { preferences.viewMode = 'list'; this.renderSearchResults(); } } }),
    ]);
    const toolbar = element('div', { className: 'search-toolbar' }, [searchWrap, location, photo, view]);
    this.resultsSummary = element('div', { className: 'results-summary', attributes: { 'aria-live': 'polite' } });
    this.results = element('div');
    this.main.replaceChildren(header, toolbar, this.resultsSummary, this.results);
    search.addEventListener('input', debounce(() => { this.searchQuery = search.value; this.renderSearchResults(); }, 80));
    location.addEventListener('change', () => { this.placeFilter = location.value; this.renderSearchResults(); });
    photo.addEventListener('change', () => { this.photoFilter = photo.value; this.renderSearchResults(); });
    this.renderSearchResults();
  }

  renderSearchResults() {
    if (!this.results) return;
    const placeIds = this.placeFilter ? this.database.descendantPlaceIds(this.placeFilter) : null;
    const items = this.searchIndex.search(this.searchQuery, { placeIds, photo: this.photoFilter });
    this.resultsSummary.replaceChildren(
      element('span', { text: `${items.length} ${items.length === 1 ? 'item' : 'items'}` }),
      this.searchQuery || this.placeFilter || this.photoFilter !== 'all'
        ? button('Clear filters', { className: 'button quiet', onClick: () => { this.searchQuery = ''; this.placeFilter = ''; this.photoFilter = 'all'; this.renderSearch(); } })
        : element('span', { text: 'Search updates instantly' }),
    );
    if (!items.length) {
      this.results.className = '';
      this.results.replaceChildren(element('div', { className: 'empty-state' }, [
        element('div', { className: 'empty-state-symbol', text: '⌕', attributes: { 'aria-hidden': 'true' } }),
        element('h2', { text: this.database.data.items.length ? 'Nothing matches yet' : 'Your first item belongs here' }),
        element('p', { text: this.database.data.items.length ? 'Try a shorter phrase, another place, or clear a filter.' : 'A name is enough. Photos and details can come later.' }),
        this.readOnly ? null : button('+ Add item', { className: 'button terracotta', onClick: () => this.openItemForm() }),
      ]));
      return;
    }
    this.results.className = `inventory-grid${preferences.viewMode === 'list' ? ' list' : ''}`;
    const cards = items.map((item) => {
      const card = document.createElement('stuff-item-card');
      card.item = item;
      card.addEventListener('openitem', () => this.openEntityDetail(item.id, 'Item'));
      return card;
    });
    this.results.replaceChildren(...cards);
    cards.forEach((card) => this.hydrateCardPhoto(card));
  }

  async hydrateCardPhoto(card) {
    const photo = this.database.photosFor(card.item.id)[0];
    if (!photo) return;
    try {
      const url = await this.media.resolvePhotoUrl(photo, { thumbnail: true });
      if (card.isConnected) card.setPhotoUrl(url);
    } catch {
      // The card retains a stable placeholder and the detail view offers repair actions.
    }
  }

  renderPlaces() {
    const header = element('header', { className: 'page-header' }, [
      element('div', { className: 'page-header-copy' }, [element('p', { className: 'eyebrow', text: 'Location tree' }), element('h1', { className: 'page-title', text: 'Places' }), element('p', { text: 'Rooms, furniture, and containers all use one simple hierarchy.' })]),
      button('+ Add place', { className: 'button terracotta', disabled: this.readOnly, onClick: () => this.openPlaceForm() }),
    ]);
    const roots = this.database.data.places.filter((place) => !place.parentId);
    const content = roots.length
      ? element('div', { className: 'place-list' }, roots.sort((a, b) => String(a.name).localeCompare(String(b.name))).map((place) => this.buildPlaceBranch(place)))
      : element('div', { className: 'empty-state' }, [element('div', { className: 'empty-state-symbol', text: '⌂' }), element('h2', { text: 'Start with a place' }), element('p', { text: '“Home”, “Garage”, or “Mom’s house” can be a root. Add rooms and boxes underneath.' }), this.readOnly ? null : button('+ Add place', { className: 'button terracotta', onClick: () => this.openPlaceForm() })]);
    this.main.replaceChildren(header, content);
  }

  buildPlaceBranch(place) {
    const directItems = this.database.data.items.filter((item) => item.placeId === place.id).length;
    const children = this.database.data.places.filter((candidate) => candidate.parentId === place.id).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const row = element('div', { className: 'place-row' }, [
      element('span', { className: 'nav-icon', text: children.length ? '▣' : '□', attributes: { 'aria-hidden': 'true' } }),
      element('button', { className: 'place-row-main', type: 'button', on: { click: () => this.openEntityDetail(place.id, 'Place') } }, [
        element('span', { className: 'place-row-name', text: place.name }),
        element('span', { className: 'place-row-path', text: place.path || place.name }),
      ]),
      element('span', { className: 'place-count', text: `${directItems} ${directItems === 1 ? 'item' : 'items'}` }),
    ]);
    const branch = element('div', { className: 'place-branch' }, row);
    if (children.length) branch.append(element('div', { className: 'place-children' }, children.map((child) => this.buildPlaceBranch(child))));
    return branch;
  }

  placeSelect(selectedId = '', { exclude = new Set(), blankLabel = 'Unassigned' } = {}) {
    const select = element('select', { className: 'select', name: 'placeId' }, option('', blankLabel, !selectedId));
    [...this.database.data.places]
      .filter((place) => !exclude.has(place.id))
      .sort((a, b) => String(a.path).localeCompare(String(b.path)))
      .forEach((place) => select.append(option(place.id, place.path || place.name, place.id === selectedId)));
    return select;
  }

  openItemForm(item = null) {
    if (this.readOnly) return;
    const form = element('form');
    const name = element('input', { className: 'field', name: 'name', value: item?.name || '', required: true, placeholder: 'What is it?' });
    const location = this.placeSelect(item?.placeId || '');
    const description = element('textarea', { className: 'field', name: 'description', value: item?.description || '', rows: 4, placeholder: 'Details that will help you recognize or search for it' });
    description.value = item?.description || '';
    const tags = element('input', { className: 'field', name: 'tags', value: item?.tags || '', placeholder: 'maps, school, paper' });
    const quantity = element('input', { className: 'field', type: 'number', name: 'quantity', value: item?.quantity || 1, min: 0.01, step: 'any' });
    const camera = element('input', { className: 'field', type: 'file', accept: 'image/*', capture: 'environment', multiple: true });
    const gallery = element('input', { className: 'field', type: 'file', accept: 'image/*', multiple: true });
    const publicUrl = element('input', { className: 'field', type: 'url', placeholder: 'https://…', attributes: { inputmode: 'url' } });
    const progress = this.createProgress();
    const grid = element('div', { className: 'form-grid' }, [
      fieldLabel('Name', name),
      fieldLabel('Location', location, 'Optional; places can be added separately.'),
      element('div', { className: 'full' }, fieldLabel('Description', description)),
      fieldLabel('Tags', tags, 'Comma-separated'),
      fieldLabel('Quantity', quantity),
    ]);
    if (!item) {
      grid.append(
        element('div', { className: 'full detail-section' }, [element('h3', { text: 'Photos (optional)' }), element('div', { className: 'form-grid' }, [fieldLabel('Take photos', camera), fieldLabel('Choose photos', gallery), element('div', { className: 'full' }, fieldLabel('Or add a public image URL', publicUrl, 'Public HTTPS image or public Google Drive image'))]), progress.wrapper]),
      );
    }
    const cancel = button('Cancel', { className: 'button secondary', onClick: () => this.dialog.close() });
    const submit = button(item ? 'Save changes' : 'Save item', { className: 'button terracotta', type: 'submit' });
    form.append(grid, element('div', { className: 'form-actions' }, [cancel, submit]));
    let persistedItem = item;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      const values = {
        name: name.value,
        placeId: location.value,
        location: this.database.data.places.find((place) => place.id === location.value)?.path || '',
        description: description.value,
        tags: tags.value,
        quantity: quantity.value,
      };
      try {
        let saved;
        if (item) saved = await this.database.updateItem(item.id, values, { snapshot: item });
        else if (persistedItem) saved = persistedItem;
        else saved = await this.database.createItem(values);
        persistedItem = saved;
        saved.entityType = 'Item';
        const files = [...(camera.files || []), ...(gallery.files || [])];
        if (files.length) await this.media.uploadFiles(files, saved, (state) => this.updateProgress(progress, state));
        if (publicUrl.value.trim()) {
          this.updateProgress(progress, { stage: 'validating URL', progress: 0.25, file: { name: 'Public image' }, index: 0, total: 1 });
          await this.media.addPublicUrl(saved, publicUrl.value.trim());
        }
        this.dialog.close();
        await this.refreshAfterWrite();
        this.showToast(item ? 'Item updated.' : 'Item added.');
      } catch (error) {
        submit.disabled = false;
        if (error instanceof EditConflictError) this.showConflict(error, values, () => this.database.updateItem(item.id, values, { snapshot: item, overwrite: true }));
        else if (!item && persistedItem) {
          this.dialog.close();
          await this.refreshAfterWrite();
          this.handleError(error);
          this.showToast('The item was saved. Add or retry failed photos from its detail view.', { timeout: 8000 });
        } else this.handleError(error);
      }
    });
    this.dialog.show(item ? `Edit ${item.name}` : 'Add an item', form);
  }

  openPlaceForm(place = null) {
    if (this.readOnly) return;
    const exclude = place ? this.database.descendantPlaceIds(place.id) : new Set();
    const form = element('form');
    const name = element('input', { className: 'field', value: place?.name || '', required: true, placeholder: 'e.g. Basement shelf' });
    const parent = this.placeSelect(place?.parentId || '', { exclude, blankLabel: 'Root place' });
    const description = element('textarea', { className: 'field', rows: 4, placeholder: 'Optional notes about this place' });
    description.value = place?.description || '';
    form.append(element('div', { className: 'form-grid' }, [fieldLabel('Name', name), fieldLabel('Parent', parent), element('div', { className: 'full' }, fieldLabel('Description', description))]));
    const submit = button(place ? 'Save changes' : 'Add place', { className: 'button terracotta', type: 'submit' });
    form.append(element('div', { className: 'form-actions' }, [button('Cancel', { className: 'button secondary', onClick: () => this.dialog.close() }), submit]));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      const parentPlace = this.database.data.places.find((candidate) => candidate.id === parent.value);
      const values = { name: name.value, parentId: parent.value, parent: parentPlace?.path || '', description: description.value };
      try {
        if (place) await this.database.updatePlace(place.id, values, { snapshot: place });
        else await this.database.createPlace(values);
        this.dialog.close();
        await this.refreshAfterWrite();
        this.showToast(place ? 'Place updated.' : 'Place added.');
      } catch (error) {
        submit.disabled = false;
        if (error instanceof EditConflictError) this.showConflict(error, values, () => this.database.updatePlace(place.id, values, { snapshot: place, overwrite: true }));
        else this.handleError(error);
      }
    });
    this.dialog.show(place ? `Edit ${place.name}` : 'Add a place', form);
  }

  async openEntityDetail(entityId, type) {
    const collection = type === 'Place' ? this.database.data.places : this.database.data.items;
    const entity = collection.find((candidate) => candidate.id === entityId);
    if (!entity) return;
    entity.entityType = type;
    const content = element('div');
    const gallery = element('div', { className: 'gallery', attributes: { 'aria-label': `${entityTitle(entity, type)} photos` } });
    content.append(gallery);
    const location = type === 'Place' ? entity.path : (entity.location || 'Unassigned');
    content.append(element('div', { className: 'detail-meta' }, [
      element('p', { className: 'breadcrumb', text: location }),
      entity.description ? element('p', { text: entity.description }) : null,
      type === 'Item' && entity.tags ? element('div', { className: 'tag-row' }, parseTags(entity.tags).map((tag) => element('span', { className: 'tag', text: tag }))) : null,
      type === 'Item' ? element('p', { text: `Quantity: ${entity.quantity || 1}` }) : null,
    ]));
    if (type === 'Place') {
      const childPlaces = this.database.data.places.filter((place) => place.parentId === entity.id);
      const childItems = this.database.data.items.filter((item) => item.placeId === entity.id);
      content.append(element('section', { className: 'detail-section' }, [
        element('h3', { text: 'Direct contents' }),
        element('p', { text: `${childPlaces.length} child ${childPlaces.length === 1 ? 'place' : 'places'} · ${childItems.length} ${childItems.length === 1 ? 'item' : 'items'}` }),
        ...childItems.map((item) => button(item.name, { className: 'button quiet', onClick: () => this.openEntityDetail(item.id, 'Item') })),
      ]));
    }
    const actionRow = element('div', { className: 'button-row' });
    if (!this.readOnly) {
      actionRow.append(button(type === 'Place' ? 'Edit place' : 'Edit item', { className: 'button secondary', onClick: () => type === 'Place' ? this.openPlaceForm(entity) : this.openItemForm(entity) }));
      content.append(this.buildPhotoActions(entity, gallery));
    }
    content.prepend(actionRow);
    this.dialog.show(entity.name, content);
    await this.renderGallery(entity, gallery);
  }

  buildPhotoActions(entity, gallery) {
    const section = element('section', { className: 'detail-section' }, element('h3', { text: 'Add photos' }));
    const camera = element('input', { className: 'visually-hidden', type: 'file', accept: 'image/*', capture: 'environment', multiple: true, attributes: { id: `camera-${entity.id}` } });
    const galleryInput = element('input', { className: 'visually-hidden', type: 'file', accept: 'image/*', multiple: true, attributes: { id: `gallery-${entity.id}` } });
    const progress = this.createProgress();
    const upload = async (files) => {
      try {
        await this.media.uploadFiles(files, entity, (state) => this.updateProgress(progress, state));
        await this.refreshAfterWrite({ rerender: false });
        await this.renderGallery(entity, gallery);
        this.showToast('Photos added.');
      } catch (error) { this.handleError(error); }
    };
    camera.addEventListener('change', () => upload([...camera.files]));
    galleryInput.addEventListener('change', () => upload([...galleryInput.files]));
    const urlInput = element('input', { className: 'field', type: 'url', placeholder: 'Public HTTPS image URL', attributes: { 'aria-label': 'Public image URL' } });
    const addUrl = button('Add URL', {
      className: 'button secondary',
      onClick: async () => {
        if (!urlInput.value.trim()) return;
        addUrl.disabled = true;
        try {
          await this.media.addPublicUrl(entity, urlInput.value.trim());
          urlInput.value = '';
          await this.refreshAfterWrite({ rerender: false });
          await this.renderGallery(entity, gallery);
          this.showToast('Public image linked.');
        } catch (error) { this.handleError(error); }
        finally { addUrl.disabled = false; }
      },
    });
    const buttons = element('div', { className: 'button-row' }, [
      camera,
      galleryInput,
      button('Take photo', { className: 'button secondary', onClick: () => camera.click() }),
      button('Choose photos', { className: 'button secondary', onClick: () => galleryInput.click() }),
      this.demo ? null : button('Choose from Drive', {
        className: 'button secondary',
        onClick: async () => {
          try {
            await this.media.importPickerImage(entity, (state) => this.updateProgress(progress, { ...state, file: { name: 'Drive image' }, index: 0, total: 1 }));
            await this.refreshAfterWrite({ rerender: false });
            await this.renderGallery(entity, gallery);
          } catch (error) { this.handleError(error); }
        },
      }),
    ]);
    section.append(buttons, element('div', { className: 'button-row' }, [urlInput, addUrl]), progress.wrapper);
    return section;
  }

  async renderGallery(entity, container) {
    const photos = this.database.photosFor(entity.id);
    if (!photos.length) {
      container.replaceChildren(element('div', { className: 'item-placeholder', text: 'No photos yet' }));
      return;
    }
    const figures = photos.map((photo, index) => {
      const image = element('img', { alt: photo.description || `${entity.name} photo ${index + 1}`, loading: 'lazy' });
      const controls = element('div', { className: 'photo-controls' });
      if (!this.readOnly) {
        const move = async (direction) => {
          const ordered = [...photos];
          const target = index + direction;
          if (target < 0 || target >= ordered.length) return;
          [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
          try {
            await this.database.reorderPhotos(entity.id, ordered.map((candidate) => candidate.id));
            await this.refreshAfterWrite({ rerender: false });
            await this.renderGallery(entity, container);
          } catch (error) { this.handleError(error); }
        };
        controls.append(
          button('←', { className: '', label: 'Move photo earlier', disabled: index === 0, onClick: () => move(-1) }),
          button('→', { className: '', label: 'Move photo later', disabled: index === photos.length - 1, onClick: () => move(1) }),
          button('×', {
            className: '', label: 'Remove photo link', onClick: async () => {
              if (!globalThis.confirm('Remove this photo from the item? Drive files will stay untouched.')) return;
              try { await this.database.removePhoto(photo.id); await this.refreshAfterWrite({ rerender: false }); await this.renderGallery(entity, container); } catch (error) { this.handleError(error); }
            },
          }),
        );
        if (String(photo.source).toLocaleLowerCase('en-US') === 'drive' && !this.demo) controls.append(button('🗑', {
          className: '', label: 'Remove and move files to Drive trash', onClick: async () => {
            if (!globalThis.confirm('Remove this photo and move its app-owned full image and thumbnail to Drive trash?')) return;
            try { await this.database.removePhoto(photo.id, { deleteFiles: true }); await this.refreshAfterWrite({ rerender: false }); await this.renderGallery(entity, container); } catch (error) { this.handleError(error); }
          },
        }));
      }
      return element('figure', {}, [image, controls]);
    });
    container.replaceChildren(...figures);
    await Promise.all(figures.map(async (figure, index) => {
      try {
        const url = await this.media.resolvePhotoUrl(photos[index], { thumbnail: false });
        const image = figure.querySelector('img');
        if (image?.isConnected) {
          image.referrerPolicy = 'no-referrer';
          image.src = url;
          image.addEventListener('error', () => image.replaceWith(element('div', { className: 'item-placeholder', text: 'Photo unavailable' })), { once: true });
        }
      } catch {
        figure.querySelector('img')?.replaceWith(element('div', { className: 'item-placeholder', text: 'Photo unavailable' }));
      }
    }));
  }

  createProgress() {
    const label = element('p', { className: 'field-hint', text: '' });
    const value = element('progress', { attributes: { max: '1', value: '0', 'aria-label': 'Photo upload progress' } });
    const wrapper = element('div', { className: 'upload-progress', attributes: { role: 'status', 'aria-live': 'polite' } }, [label, value]);
    wrapper.hidden = true;
    return { wrapper, label, value };
  }

  updateProgress(progress, state) {
    progress.wrapper.hidden = false;
    const overall = Math.max(0, Math.min(1, (Number(state.index || 0) + Number(state.progress || 0)) / Math.max(1, Number(state.total || 1))));
    progress.value.value = overall;
    progress.label.textContent = `${state.stage || 'Uploading'}: ${state.file?.name || 'photo'} · ${Math.round(overall * 100)}%`;
  }

  showConflict(error, proposed, overwriteAction) {
    const content = element('div', {}, [
      element('div', { className: 'notice warning' }, [element('strong', { text: 'The Sheet changed while you were editing.' }), element('p', { text: 'Review the values below. Reload keeps the Sheet version; overwrite applies your form.' })]),
    ]);
    const list = element('dl', { className: 'definition-list' });
    error.changedFields.forEach((key) => {
      list.append(element('dt', { text: `${key} in Sheet` }), element('dd', { text: error.current[key] || '—' }), element('dt', { text: `${key} in form` }), element('dd', { text: proposed[key] || '—' }));
    });
    const overwrite = button('Overwrite with my changes', {
      className: 'button danger',
      onClick: async () => {
        overwrite.disabled = true;
        try {
          await overwriteAction();
          this.dialog.close();
          await this.refreshAfterWrite();
          this.showToast('Changes overwritten after review.');
        } catch (nextError) { overwrite.disabled = false; this.handleError(nextError); }
      },
    });
    content.append(list, element('div', { className: 'form-actions' }, [button('Reload Sheet version', { className: 'button secondary', onClick: () => { this.dialog.close(); this.refreshAfterWrite(); } }), overwrite]));
    this.dialog.show('Resolve edit conflict', content);
  }

  renderSettings() {
    const header = element('header', { className: 'page-header' }, element('div', { className: 'page-header-copy' }, [element('p', { className: 'eyebrow', text: 'Connection & maintenance' }), element('h1', { className: 'page-title', text: 'Settings' }), element('p', { text: 'The Sheet and Drive remain the source of truth.' })]));
    const account = element('section', { className: 'settings-card' }, [
      element('h2', { text: 'Google account' }),
      element('dl', { className: 'definition-list' }, [
        element('dt', { text: 'Name' }), element('dd', { text: this.profile?.displayName || 'Connected' }),
        element('dt', { text: 'Email' }), element('dd', { text: this.profile?.emailAddress || 'Available to Google only' }),
      ]),
    ]);
    const data = element('section', { className: 'settings-card' }, [
      element('h2', { text: 'Your data' }),
      element('p', { text: `Schema v${this.database.settings.get('schema_version') || '?'} · ${this.database.data.items.length} items · ${this.database.data.places.length} places` }),
      element('div', { className: 'button-row' }, this.demo ? [element('span', { className: 'field-hint', text: 'Local demo data' })] : [
        externalLink('Open Google Sheet', `https://docs.google.com/spreadsheets/d/${encodeURIComponent(this.database.spreadsheetId)}/edit`),
        externalLink('Open stuff folder', `https://drive.google.com/drive/folders/${encodeURIComponent(this.database.settings.get('root_folder_id'))}`),
      ]),
    ]);
    const access = element('section', { className: 'settings-card' }, [element('h2', { text: 'Temporary access' })]);
    const remember = element('input', { type: 'checkbox', checked: preferences.rememberAccess, attributes: { id: 'settings-remember' } });
    remember.addEventListener('change', () => {
      preferences.rememberAccess = remember.checked;
      this.showToast(remember.checked ? 'This device will remember the current temporary token.' : 'The persisted token was removed; this tab stays connected until the token expires.');
    });
    access.append(element('label', { className: 'remember-line' }, [remember, element('span', { text: 'Remember access on this device' })]), element('p', { text: 'Disable on shared devices. This does not revoke Google consent.' }));
    const maintenance = element('section', { className: 'settings-card' }, [
      element('h2', { text: 'Sync & diagnostics' }),
      element('p', { text: 'Refresh manual Sheet edits, fill safe generated values, and inspect ambiguous relationships.' }),
      element('div', { className: 'button-row' }, [
        button('Sync now', { className: 'button secondary', onClick: () => this.syncNow() }),
        button('Run diagnostics', { className: 'button secondary', onClick: () => this.showDiagnostics() }),
      ]),
    ]);
    const sharing = element('section', { className: 'settings-card full' }, [element('h2', { text: 'Share the household inventory' }), element('p', { text: 'Grant one Google account editor access to the dedicated stuff folder and everything inside it.' })]);
    if (this.demo) sharing.append(element('p', { className: 'field-hint', text: 'Sharing is disabled in demo mode.' }));
    else {
      const email = element('input', { className: 'field', type: 'email', placeholder: 'person@example.com', attributes: { 'aria-label': 'Email address to share with' } });
      const share = button('Share as editor', { className: 'button terracotta', onClick: async () => {
        if (!email.value.trim()) return;
        share.disabled = true;
        try { await this.drive.shareFolder(this.database.settings.get('root_folder_id'), email.value); email.value = ''; this.showToast('Folder shared. Google sent an invitation.'); }
        catch (error) { this.handleError(error); }
        finally { share.disabled = false; }
      } });
      sharing.append(element('div', { className: 'button-row' }, [email, share]));
    }
    const install = element('section', { className: 'settings-card' }, [element('h2', { text: 'Install stuff' }), element('p', { text: isIos() ? 'On iPhone or iPad: tap Share, then Add to Home Screen.' : 'Install stuff for a full-screen home-screen shortcut.' }), button(this.installPrompt ? 'Install stuff' : isIos() ? 'Show iOS steps' : 'Installation help', { className: 'button secondary install-button', onClick: () => this.installApp() })]);
    const disconnect = element('section', { className: 'settings-card' }, [element('h2', { text: 'Disconnect' }), element('p', { text: 'Neither action deletes the Sheet, folders, or photos.' }), element('div', { className: 'button-row' }, [button('Disconnect inventory', { className: 'button secondary', onClick: () => this.disconnectInventory() }), this.demo ? null : button('Revoke Google access', { className: 'button danger', onClick: () => this.revokeAccess() })])]);
    const grid = element('div', { className: 'settings-grid' }, [account, data, access, maintenance, sharing, install, disconnect]);
    this.main.replaceChildren(header, grid);
  }

  async syncNow() {
    this.showToast('Refreshing the Sheet…', { timeout: 1800 });
    try {
      await this.database.inspect();
      if (this.database.inspection.state === 'repairable') { this.renderSchemaState(); return; }
      if (this.database.inspection.state !== 'current') { this.readOnly = true; this.renderApplication(); return; }
      await this.database.synchronizeManualRows();
      await this.refreshAfterWrite();
      this.showToast('Sheet changes synchronized.');
    } catch (error) { this.handleError(error); }
  }

  async showDiagnostics() {
    const content = element('div', {}, [element('p', { text: 'Inspecting Sheet relationships and app-owned Drive media…' }), element('div', { className: 'spinner' })]);
    this.dialog.show('Diagnostics', content);
    try {
      const issues = await this.database.runDiagnostics({ includeMedia: !this.demo });
      if (!issues.length) {
        content.replaceChildren(element('div', { className: 'notice success' }, [element('strong', { text: 'Everything looks consistent.' }), element('p', { text: 'No duplicate IDs, unresolved relationships, missing entities, invalid values, or orphaned app media were found.' })]));
        return;
      }
      const list = element('ul', { className: 'diagnostic-list' }, issues.map((issue) => element('li', { className: `diagnostic-item ${issue.severity}` }, [element('strong', { text: `${issue.tab}${issue.row ? ` row ${issue.row}` : ''}` }), element('div', { text: issue.message })])));
      content.replaceChildren(element('p', { text: `${issues.length} ${issues.length === 1 ? 'issue' : 'issues'} found. Diagnostics never change data.` }), list);
    } catch (error) { content.replaceChildren(element('div', { className: 'notice error' }, element('p', { text: friendlyGoogleError(error) }))); }
  }

  confirmRepair() {
    const changes = this.database.inspection.repairPlan?.missingGenerated || [];
    const content = element('div', {}, [
      element('p', { text: 'stuff will append only the missing generated columns and recreate validation/formatting on declared columns. Unknown columns and their values stay untouched.' }),
      element('ul', {}, changes.map((change) => element('li', { text: change }))),
    ]);
    const repair = button('Repair Sheet', { className: 'button terracotta', onClick: async () => {
      repair.disabled = true;
      try { await this.database.repairSchema(); this.dialog.close(); await this.activateDatabase(this.database); this.showToast('Sheet repaired.'); }
      catch (error) { repair.disabled = false; this.handleError(error); }
    } });
    content.append(element('div', { className: 'form-actions' }, [button('Cancel', { className: 'button secondary', onClick: () => this.dialog.close() }), repair]));
    this.dialog?.show('Repair preview', content);
  }

  async refreshAfterWrite({ rerender = true } = {}) {
    await this.database.inspect();
    this.refreshSearchIndex();
    if (rerender) this.renderApplication();
  }

  async disconnectInventory() {
    if (!globalThis.confirm('Disconnect this browser from the inventory? No Google Drive files will be deleted.')) return;
    this.media?.destroy?.();
    preferences.clearConnection();
    this.database = null;
    this.profile = null;
    this.demo = false;
    const url = new URL(globalThis.location.href);
    url.searchParams.delete('demo');
    globalThis.history.replaceState({}, '', url.pathname + url.search);
    this.renderConnection({ configurationMissing: !isGoogleConfigured() });
  }

  async revokeAccess() {
    if (!globalThis.confirm('Revoke stuff’s Google access for this account? Your Drive files remain untouched.')) return;
    try {
      await this.auth.revoke();
      preferences.clearConnection();
      this.database = null;
      this.renderConnection();
    } catch (error) { this.handleError(error); }
  }

  async installApp() {
    if (this.installPrompt) {
      await this.installPrompt.prompt();
      await this.installPrompt.userChoice;
      this.installPrompt = null;
      this.updateInstallButtons();
      return;
    }
    const message = isIos() ? 'In Safari, tap the Share button, then “Add to Home Screen”, then “Add”.' : 'Use your browser menu and choose “Install stuff” or “Add to Home screen”. Installation may already be complete.';
    const content = element('div', {}, [element('p', { className: 'lede', text: message }), button('Got it', { className: 'button', onClick: () => this.dialog.close() })]);
    this.dialog.show('Add stuff to your home screen', content);
  }

  updateInstallButtons() {
    this.querySelectorAll('.install-button').forEach((installButton) => { installButton.textContent = this.installPrompt ? 'Install stuff' : isIos() ? 'Show iOS steps' : 'Installation help'; });
  }

  requireReconnect() {
    tokenVault.clear();
    this.reconnectNeeded = true;
    if (this.database && !this.querySelector('.reauth-banner')) {
      const banner = this.createReconnectBanner();
      this.insertBefore(banner, this.firstChild);
    }
  }

  createReconnectBanner() {
    return element('div', { className: 'reauth-banner', attributes: { role: 'alert' } }, [
      element('span', { text: 'Google access expired. Your open form is still here.' }),
      button('Reconnect', { className: '', onClick: async (event) => {
        const reconnect = event.currentTarget;
        reconnect.disabled = true;
        try {
          await this.auth.connect({ prompt: '', remember: preferences.rememberAccess });
          this.reconnectNeeded = false;
          this.querySelector('.reauth-banner')?.remove();
          this.showToast('Google reconnected. You can retry the action.');
        } catch (error) { reconnect.disabled = false; this.handleError(error); }
      } }),
    ]);
  }

  updateConnectivityBanner() {
    if (!this.database) return;
    const existing = this.querySelector('.offline-banner');
    if (!globalThis.navigator.onLine && !existing) this.insertBefore(element('div', { className: 'offline-banner', text: 'You are offline. Browsing loaded data is safe; Google reads and writes are unavailable.' }), this.firstChild);
    else if (globalThis.navigator.onLine) existing?.remove();
  }

  handleError(error) {
    if (error instanceof GoogleApiError && error.reason === 'authorization_expired') this.requireReconnect();
    this.showToast(error instanceof GoogleApiError ? friendlyGoogleError(error) : (error?.message || 'Something went wrong.'), { type: 'error', timeout: 8000 });
  }

  async setupServiceWorker() {
    if (!('serviceWorker' in globalThis.navigator) || localDemoAvailable()) return;
    try {
      const registration = await globalThis.navigator.serviceWorker.register('sw.js');
      if (registration.waiting) this.offerUpdate(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && globalThis.navigator.serviceWorker.controller) this.offerUpdate(worker);
        });
      });
    } catch {
      // The app remains usable without install/offline shell support.
    }
  }

  offerUpdate(worker) {
    if (!this.dialog) {
      this.pendingUpdateWorker = worker;
      return;
    }
    const content = element('div', {}, [
      element('p', { text: 'A new version of stuff is ready. Reload only when you are not editing or uploading photos.' }),
      element('div', { className: 'form-actions' }, [
        button('Later', { className: 'button secondary', onClick: () => this.dialog.close() }),
        button('Reload now', { className: 'button terracotta', disabled: this.media?.uploading, onClick: () => {
          globalThis.navigator.serviceWorker.addEventListener('controllerchange', () => globalThis.location.reload(), { once: true });
          worker.postMessage({ type: 'SKIP_WAITING' });
        } }),
      ]),
    ]);
    this.dialog.show('Update available', content);
  }
}

customElements.define('stuff-app', StuffApp);
