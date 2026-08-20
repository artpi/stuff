import { element } from './dom.js';
import { parseTags } from '../utils.js';

export class StuffItemCard extends HTMLElement {
  set item(value) {
    this._item = value;
    this.render();
  }

  get item() {
    return this._item;
  }

  connectedCallback() {
    if (this._item) this.render();
  }

  render() {
    if (!this._item) return;
    const item = this._item;
    const open = () => this.dispatchEvent(new CustomEvent('openitem', { bubbles: true, composed: true, detail: { itemId: item.id } }));
    const media = element('div', { className: 'item-placeholder', text: '◇', attributes: { 'aria-hidden': 'true' } });
    this.media = media;
    const content = element('div', { className: 'item-content' }, [
      element('h2', { className: 'item-name', text: item.name || 'Untitled item' }),
      element('p', { className: 'breadcrumb', text: item.location || 'Unassigned' }),
    ]);
    const tags = parseTags(item.tags);
    if (tags.length) content.append(element('div', { className: 'tag-row' }, tags.slice(0, 4).map((tag) => element('span', { className: 'tag', text: tag }))));
    const cardButton = element('button', {
      className: 'item-card-button',
      type: 'button',
      attributes: { 'aria-label': `Open ${item.name || 'item'}` },
      on: { click: open },
    }, [media, content]);
    this.replaceChildren(element('article', { className: 'item-card' }, cardButton));
  }

  setPhotoUrl(url) {
    if (!url || !this.media || !this._item) return;
    const image = element('img', {
      className: `item-image${this._item.id?.charCodeAt(0) % 3 === 0 ? ' tall' : ''}`,
      src: url,
      alt: '',
      loading: 'lazy',
      on: { error: () => image.replaceWith(element('div', { className: 'item-placeholder', text: '◇', attributes: { 'aria-label': 'Photo unavailable' } })) },
    });
    this.media.replaceWith(image);
    this.media = image;
  }
}

customElements.define('stuff-item-card', StuffItemCard);
