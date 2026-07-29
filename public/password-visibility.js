import { passwordVisibilityState } from './password-visibility-state.js';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
let generatedInputId = 0;

function createSvgElement(documentValue, name, attributes = {}) {
  const element = documentValue.createElementNS(SVG_NAMESPACE, name);
  for (const [attribute, value] of Object.entries(attributes)) element.setAttribute(attribute, value);
  return element;
}

function createEyeIcon(documentValue) {
  const icon = createSvgElement(documentValue, 'svg', {
    viewBox: '0 0 24 24',
    width: '20',
    height: '20',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.8',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  icon.append(
    createSvgElement(documentValue, 'path', { d: 'M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z' }),
    createSvgElement(documentValue, 'circle', { cx: '12', cy: '12', r: '2.7' }),
    createSvgElement(documentValue, 'path', { class: 'password-eye-slash', d: 'm4 4 16 16' }),
  );
  return icon;
}

function applyVisibility(input, button, visible) {
  const state = passwordVisibilityState(visible);
  input.type = state.inputType;
  button.setAttribute('aria-label', state.label);
  button.setAttribute('aria-pressed', state.pressed);
  button.title = state.label;
  button.dataset.visible = state.pressed;
  return state;
}

function inputSelection(input) {
  return {
    start: input.selectionStart,
    end: input.selectionEnd,
    direction: input.selectionDirection,
  };
}

function restoreInputFocus(input, selection) {
  input.focus({ preventScroll: true });
  if (!Number.isInteger(selection.start) || !Number.isInteger(selection.end)) return;
  input.setSelectionRange(selection.start, selection.end, selection.direction || 'none');
}

export function togglePasswordVisibility(input, button) {
  const selection = inputSelection(input);
  const state = applyVisibility(input, button, input.type === 'password');
  restoreInputFocus(input, selection);
  return state.visible;
}

export function enhancePasswordInput(input) {
  if (!input || input.dataset.passwordVisibilityReady === 'true') return null;
  const documentValue = input.ownerDocument;
  if (!input.id) {
    generatedInputId += 1;
    input.id = `password-field-${generatedInputId}`;
  }

  const wrapper = documentValue.createElement('span');
  wrapper.className = 'password-field';
  const button = documentValue.createElement('button');
  button.className = 'password-visibility-toggle';
  button.type = 'button';
  button.setAttribute('aria-controls', input.id);
  button.append(createEyeIcon(documentValue));
  applyVisibility(input, button, false);
  button.addEventListener('click', () => togglePasswordVisibility(input, button));

  input.before(wrapper);
  wrapper.append(input, button);
  input.dataset.passwordVisibilityReady = 'true';
  return button;
}

export function enhancePasswordFields(root = document) {
  return [...root.querySelectorAll('input[type="password"]')]
    .map((input) => enhancePasswordInput(input))
    .filter(Boolean);
}

enhancePasswordFields();
