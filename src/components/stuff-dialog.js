import { button, element } from './dom.js';

export class StuffDialog extends HTMLElement {
  constructor() {
    super();
    this.returnFocus = null;
  }

  connectedCallback() {
    if (this.dialog) return;
    this.dialog = element('dialog', { className: 'stuff-dialog' });
    this.titleElement = element('h2', { className: 'dialog-title', id: 'stuff-dialog-title' });
    this.closeButton = button('×', { className: 'dialog-close', label: 'Close dialog', onClick: () => this.close() });
    this.header = element('header', { className: 'dialog-header' }, [this.titleElement, this.closeButton]);
    this.body = element('div', { className: 'dialog-body' });
    this.dialog.append(this.header, this.body);
    this.dialog.setAttribute('aria-labelledby', this.titleElement.id);
    this.dialog.addEventListener('close', () => {
      const focusTarget = this.returnFocus;
      this.returnFocus = null;
      globalThis.setTimeout(() => focusTarget?.focus?.(), 0);
    });
    this.append(this.dialog);
  }

  show(title, content, { closeLabel = 'Close dialog' } = {}) {
    this.connectedCallback();
    this.returnFocus = document.activeElement;
    this.titleElement.textContent = String(title);
    this.closeButton.setAttribute('aria-label', closeLabel);
    this.body.replaceChildren(content);
    if (!this.dialog.open) this.dialog.showModal();
    const first = this.body.querySelector('input, select, textarea, button, a[href]');
    globalThis.setTimeout(() => first?.focus?.(), 0);
  }

  close() {
    if (this.dialog?.open) this.dialog.close();
  }

  setBusy(busy) {
    this.closeButton.disabled = Boolean(busy);
    this.body.querySelectorAll('button, input, select, textarea').forEach((control) => { control.disabled = Boolean(busy); });
    this.dialog.setAttribute('aria-busy', String(Boolean(busy)));
  }
}

customElements.define('stuff-dialog', StuffDialog);
