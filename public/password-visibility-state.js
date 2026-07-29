export function passwordVisibilityState(visibleValue) {
  const visible = visibleValue === true;
  return Object.freeze({
    visible,
    inputType: visible ? 'text' : 'password',
    label: visible ? 'Ocultar contraseña' : 'Mostrar contraseña',
    pressed: String(visible),
  });
}
