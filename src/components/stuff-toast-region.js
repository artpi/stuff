import { button, element } from './dom.js';

export class StuffToastRegion extends HTMLElement {
  connectedCallback() {
    if (this.region) return;
    this.region = element('div', { className: 'toast-region', attributes: { 'aria-live': 'polite', 'aria-atomic': 'false' } });
    this.append(this.region);
  }

  show(message, { type = 'info', timeout = 5000 } = {}) {
    this.connectedCallback();
    const toast = element('div', { className: `toast${type === 'error' ? ' error' : ''}`, attributes: { role: type === 'error' ? 'alert' : 'status' } });
    toast.append(element('span', { text: message }));
    const dismiss = () => toast.remove();
    toast.append(button('×', { className: '', label: 'Dismiss message', onClick: dismiss }));
    this.region.append(toast);
    if (timeout > 0) globalThis.setTimeout(dismiss, timeout);
  }
}

customElements.define('stuff-toast-region', StuffToastRegion);
