import assert from 'node:assert/strict';
import test from 'node:test';

import { passwordVisibilityState } from '../public/password-visibility-state.js';

test('describes hidden and visible password controls accessibly', () => {
  const hidden = passwordVisibilityState(false);
  assert.deepEqual({ ...hidden }, {
    visible: false,
    inputType: 'password',
    label: 'Mostrar contraseña',
    pressed: 'false',
  });
  assert.ok(Object.isFrozen(hidden));

  assert.deepEqual({ ...passwordVisibilityState(true) }, {
    visible: true,
    inputType: 'text',
    label: 'Ocultar contraseña',
    pressed: 'true',
  });
  assert.deepEqual({ ...passwordVisibilityState('true') }, { ...hidden });
});
