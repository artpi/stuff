export function element(tagName, options = {}, children = []) {
  const node = document.createElement(tagName);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = String(options.text);
  if (options.id) node.id = options.id;
  if (options.name) node.name = options.name;
  if (options.type) node.type = options.type;
  if (options.value !== undefined) node.value = String(options.value);
  if (options.placeholder) node.placeholder = options.placeholder;
  if (options.required) node.required = true;
  if (options.disabled) node.disabled = true;
  if (options.checked !== undefined) node.checked = Boolean(options.checked);
  if (options.href) node.href = options.href;
  if (options.target) node.target = options.target;
  if (options.rel) node.rel = options.rel;
  if (options.src) node.src = options.src;
  if (options.alt !== undefined) node.alt = options.alt;
  if (options.loading) node.loading = options.loading;
  if (options.accept) node.accept = options.accept;
  if (options.multiple) node.multiple = true;
  if (options.capture) node.setAttribute('capture', options.capture);
  if (options.min !== undefined) node.min = String(options.min);
  if (options.step !== undefined) node.step = String(options.step);
  if (options.rows !== undefined) node.rows = options.rows;
  Object.entries(options.attributes || {}).forEach(([name, value]) => {
    if (value === false || value === null || value === undefined) return;
    node.setAttribute(name, value === true ? '' : String(value));
  });
  Object.entries(options.dataset || {}).forEach(([name, value]) => { node.dataset[name] = String(value); });
  Object.entries(options.on || {}).forEach(([name, listener]) => node.addEventListener(name, listener));
  appendChildren(node, children);
  return node;
}

export function appendChildren(parent, children) {
  const values = Array.isArray(children) ? children : [children];
  values.flat(Infinity).forEach((child) => {
    if (child === null || child === undefined || child === false) return;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return parent;
}

export function button(text, { className = 'button', type = 'button', onClick, disabled = false, label = '' } = {}) {
  return element('button', {
    className,
    text,
    type,
    disabled,
    attributes: label ? { 'aria-label': label } : {},
    on: onClick ? { click: onClick } : {},
  });
}

export function fieldLabel(text, control, hint = '') {
  const label = element('label', { className: 'field-label' });
  label.append(element('span', { text }), control);
  if (hint) label.append(element('span', { className: 'field-hint', text: hint }));
  return label;
}

export function option(value, text, selected = false) {
  return element('option', { value, text, attributes: selected ? { selected: true } : {} });
}

export function externalLink(text, href, className = 'button secondary') {
  return element('a', { text, href, className, target: '_blank', rel: 'noopener noreferrer' });
}
