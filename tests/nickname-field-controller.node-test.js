import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/nickname-field-controller.js', import.meta.url), 'utf8');

class InputStub {
  constructor(value = '') {
    this.value = value;
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.customValidity = '';
  }

  addEventListener(type, callback) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(callback);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, callback) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((listener) => listener !== callback));
  }

  emit(type) {
    for (const listener of this.listeners.get(type) ?? []) listener({ type, target: this });
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  setCustomValidity(value) {
    this.customValidity = String(value);
  }
}

function policy() {
  return {
    validateNickname(value) {
      const normalized = String(value ?? '').trim();
      if (!normalized) return { valid: false, reason: 'required', normalized: '' };
      if (normalized.length < 3) return { valid: false, reason: 'too_short', normalized };
      return { valid: true, reason: null, normalized };
    },
    nicknameErrorMessage(reason) {
      return `error:${reason}`;
    },
  };
}

function loadController({ withPolicy = true, withAvailability = true } = {}) {
  const lookups = [];
  const context = {
    HTMLInputElement: InputStub,
    Object,
    String,
  };
  if (withPolicy) context.Minuto106NicknamePolicy = policy();
  if (withAvailability) {
    context.Minuto106NicknameAvailability = {
      createDebouncedLookup(options) {
        const record = {
          options,
          cancellations: 0,
          scheduled: [],
          cancel() { record.cancellations += 1; },
          schedule(payload, callbacks) { record.scheduled.push({ payload, callbacks }); },
        };
        lookups.push(record);
        return record;
      },
    };
  }
  vm.runInNewContext(source, context, { filename: 'public/nickname-field-controller.js' });
  return { api: context.Minuto106NicknameFieldController, context, lookups };
}

function statusNode() {
  return { textContent: '', dataset: {} };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('does not publish a controller without the canonical nickname policy', () => {
  const { api } = loadController({ withPolicy: false });
  assert.equal(api, undefined);
});

test('maps every availability state to one consistent message and tone', () => {
  const { api } = loadController();
  assert.deepEqual(plain(api.defaultAvailabilityMessage('available')), { message: 'Nick disponible.', tone: 'success' });
  assert.deepEqual(plain(api.defaultAvailabilityMessage('owned')), { message: 'Ese es el nick actual de este jugador.', tone: 'warning' });
  assert.deepEqual(plain(api.defaultAvailabilityMessage('occupied')), { message: 'Ese nick ya está ocupado.', tone: 'error' });
  assert.deepEqual(plain(api.defaultAvailabilityMessage('invalid-too_short')), { message: 'error:too_short', tone: 'error' });
  assert.deepEqual(plain(api.defaultAvailabilityMessage('unknown')), { message: 'No se pudo confirmar la disponibilidad.', tone: 'error' });
});

test('structural binding validates, reports state and tears down idempotently', () => {
  const { api } = loadController();
  assert.throws(() => api.bindStructural(), /requires an input/);

  const input = new InputStub('');
  const status = statusNode();
  status.dataset.tone = 'stale';
  const states = [];
  const controller = api.bindStructural({
    input,
    status,
    idleMessage: 'Escribe un nick.',
    onStateChange: (state) => states.push(state),
  });

  assert.equal(status.textContent, 'Escribe un nick.');
  assert.equal(status.dataset.tone, undefined);
  assert.equal(input.customValidity, 'error:required');
  assert.equal(input.attributes.get('aria-invalid'), 'true');

  input.value = 'ab';
  input.emit('input');
  assert.equal(status.textContent, 'error:too_short');
  assert.equal(status.dataset.tone, 'error');
  assert.equal(controller.getValidation().valid, false);

  input.value = '  Ana  ';
  input.emit('change');
  assert.equal(input.customValidity, '');
  assert.equal(input.attributes.get('aria-invalid'), 'false');
  assert.equal(controller.refresh().normalized, 'Ana');
  assert.ok(states.length >= 4);

  controller.destroy();
  const stateCount = states.length;
  input.value = 'x';
  input.emit('input');
  assert.equal(states.length, stateCount);
  assert.equal(controller.refresh().reason, 'too_short');
  controller.destroy();
  assert.ok(Object.isFrozen(controller));

  const noStatusInput = new InputStub('ValidNick');
  const noStatus = api.bindStructural({ input: noStatusInput });
  assert.equal(noStatus.refresh().valid, true);
  noStatus.destroy();
});

test('availability binding drives pending, success, occupied, invalid and error states', () => {
  const { api, lookups } = loadController();
  assert.throws(() => api.create(), /requires an input/);
  assert.throws(() => api.create({ input: new InputStub('Ana') }), /requires an input/);

  const missingAvailability = loadController({ withAvailability: false });
  assert.throws(
    () => missingAvailability.api.create({ input: new InputStub('Ana'), checkFn: async () => ({}) }),
    /requires an input, availability owner and checkFn/,
  );

  const input = new InputStub('');
  const status = statusNode();
  const submitButton = { disabled: false };
  const observed = [];
  const checkFn = async () => ({ availability: 'available' });
  const controller = api.create({ input, status, submitButton, checkFn, delay: 7, onStateChange: (state) => observed.push(state) });
  const lookup = lookups[0];

  assert.equal(lookup.options.delay, 7);
  assert.equal(lookup.options.checkFn, checkFn);
  assert.equal(status.textContent, 'Escribe un nick para comprobarlo.');
  assert.equal(submitButton.disabled, true);
  assert.equal(controller.isReady(), false);
  assert.equal(controller.normalizedValue(), '');

  input.value = 'ab';
  input.emit('input');
  assert.equal(status.textContent, 'error:too_short');
  assert.equal(status.dataset.tone, 'error');
  assert.equal(input.attributes.get('aria-invalid'), 'true');

  input.value = ' Ana ';
  input.emit('input');
  assert.equal(status.textContent, 'Comprobando disponibilidad y contenido…');
  assert.equal(controller.getState().pending, true);
  assert.deepEqual(plain(lookup.scheduled.at(-1).payload), { nick: 'Ana' });
  assert.equal(controller.normalizedValue(), 'Ana');

  lookup.scheduled.at(-1).callbacks.onResult({ availability: 'available' });
  assert.equal(status.textContent, 'Nick disponible.');
  assert.equal(status.dataset.tone, 'success');
  assert.equal(submitButton.disabled, false);
  assert.equal(controller.isReady(), true);

  for (const [availability, message, tone] of [
    ['owned', 'Ese es el nick actual de este jugador.', 'warning'],
    ['occupied', 'Ese nick ya está ocupado.', 'error'],
    ['invalid-too_short', 'error:too_short', 'error'],
    ['unavailable', 'No se pudo confirmar la disponibilidad.', 'error'],
  ]) {
    input.value = `Nick${availability.length}`;
    input.emit('input');
    lookup.scheduled.at(-1).callbacks.onResult({ availability });
    assert.equal(status.textContent, message);
    assert.equal(status.dataset.tone, tone);
  }

  input.value = 'Resultless';
  input.emit('input');
  lookup.scheduled.at(-1).callbacks.onResult(null);
  assert.equal(controller.getState().availability, 'unknown');
  assert.equal(submitButton.disabled, true);

  input.value = 'NetworkA';
  input.emit('input');
  lookup.scheduled.at(-1).callbacks.onError(new Error('Red no disponible'));
  assert.equal(status.textContent, 'Red no disponible');
  assert.equal(status.dataset.tone, 'error');

  input.value = 'NetworkB';
  input.emit('input');
  lookup.scheduled.at(-1).callbacks.onError('failure');
  assert.equal(status.textContent, 'No se pudo comprobar el nick.');
  assert.equal(status.dataset.tone, 'error');

  controller.destroy();
  const cancellations = lookup.cancellations;
  input.value = 'AfterDestroy';
  input.emit('input');
  assert.equal(lookup.cancellations, cancellations);
  assert.equal(controller.refresh().pending, false);
  controller.destroy();
  assert.ok(observed.length > 0);
  assert.ok(Object.isFrozen(controller.getState()));
  assert.ok(Object.isFrozen(controller));
});

test('supports custom copy and optional presentation elements without changing validation semantics', () => {
  const { api, lookups } = loadController();
  const input = new InputStub('CustomNick');
  const customMessages = [];
  const controller = api.create({
    input,
    checkFn: () => ({}),
    status: null,
    submitButton: null,
    pendingMessage: 'Pendiente',
    readyMessage: 'Preparado',
    idleMessage: 'Vacío',
    availabilityMessage(availability) {
      customMessages.push(availability);
      return { message: `custom:${availability}`, tone: '' };
    },
  });
  const lookup = lookups[0];
  controller.refresh();
  lookup.scheduled.at(-1).callbacks.onResult({ availability: 'owned' });
  assert.deepEqual(customMessages, ['owned']);
  assert.equal(controller.getState().ready, false);
  controller.destroy();
});
