export const AUTH_EMAIL_BRAND = Object.freeze({
  accountUrl: 'https://juanjogondev.github.io/106/cuenta.html',
  imageUrl: 'https://juanjogondev.github.io/106/assets/minuto-106-social-preview.jpg?v=20260723-3',
  siteUrl: 'https://juanjogondev.github.io/106/',
});

const AUTH_TEMPLATE_DEFINITIONS = [
  {
    kind: 'authentication',
    type: 'confirmation',
    outputPath: 'supabase/templates/confirmation.html',
    subject: 'Confirma Minuto 106 y gana +1 intento diario',
    preheader: 'Confirma tu cuenta, protege tu progreso y desbloquea un intento diario adicional.',
    eyebrow: 'CUENTA NUEVA',
    title: 'Confirma tu cuenta y gana +1 intento diario',
    introHtml: 'Verifica tu email para proteger tu progreso y desbloquear el logro <strong style="color:#ffe27f">Cuenta confirmada</strong>.',
    otpLabel: 'Tu código de un solo uso',
    actionLabel: 'Verificar y conseguir +1 intento',
    actionUrl: '{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=email',
    detailHtml: 'El enlace y el código caducan en <strong>1 hora</strong> y solo pueden usarse una vez. Puedes solicitar otro desde la pantalla de verificación.',
    footerHtml: 'Si no has creado esta cuenta, ignora este mensaje.',
  },
  {
    kind: 'authentication',
    type: 'recovery',
    outputPath: 'supabase/templates/recovery.html',
    subject: 'Restablece tu clave de Minuto 106',
    preheader: 'Usa este enlace de un solo uso para elegir una nueva contraseña.',
    eyebrow: 'RECUPERACIÓN',
    title: 'Crea una nueva contraseña',
    introHtml: 'Hemos recibido una solicitud para restablecer la contraseña de tu cuenta de Minuto 106.',
    actionLabel: 'Restablecer contraseña',
    actionUrl: '{{ .ConfirmationURL }}',
    detailHtml: 'El enlace es personal, caduca según la política de seguridad de la cuenta y solo debe abrirse desde un dispositivo de confianza.',
    footerHtml: 'Si no has solicitado el cambio, no abras el enlace. Tu contraseña actual seguirá siendo válida.',
  },
  {
    kind: 'authentication',
    type: 'magic_link',
    outputPath: 'supabase/templates/magic-link.html',
    subject: 'Tu acceso a Minuto 106',
    preheader: 'Entra de forma segura con un enlace o código de un solo uso.',
    eyebrow: 'ACCESO SEGURO',
    title: 'Tu acceso de un solo uso',
    introHtml: 'Usa el botón o introduce el código en la pantalla que te lo haya solicitado. Ninguno de los dos debe compartirse.',
    otpLabel: 'Código de acceso',
    actionLabel: 'Entrar en Minuto 106',
    actionUrl: '{{ .ConfirmationURL }}',
    detailHtml: 'El enlace y el código caducan pronto y dejan de funcionar después del primer uso.',
    footerHtml: 'Si no has solicitado este acceso, ignora el mensaje.',
  },
  {
    kind: 'authentication',
    type: 'invite',
    outputPath: 'supabase/templates/invite.html',
    subject: 'Te han invitado a Minuto 106',
    preheader: 'Acepta la invitación y crea tu acceso a Minuto 106.',
    eyebrow: 'INVITACIÓN',
    title: 'Tienes una invitación pendiente',
    introHtml: 'Te han invitado a crear una cuenta y conservar tu progreso, nicks, logros y competiciones en distintos dispositivos.',
    actionLabel: 'Aceptar invitación',
    actionUrl: '{{ .ConfirmationURL }}',
    detailHtml: 'La invitación es personal y caduca según la política de seguridad configurada.',
    footerHtml: 'Si no esperabas esta invitación, puedes ignorarla sin crear una cuenta.',
  },
  {
    kind: 'authentication',
    type: 'email_change',
    outputPath: 'supabase/templates/email-change.html',
    subject: 'Confirma tu nuevo email en Minuto 106',
    preheader: 'Confirma la nueva dirección asociada a tu cuenta.',
    eyebrow: 'CAMBIO DE EMAIL',
    title: 'Confirma tu nueva dirección',
    introHtml: 'Has solicitado usar <strong style="color:#ffe27f">{{ .NewEmail }}</strong> como nuevo email de acceso.',
    actionLabel: 'Confirmar nuevo email',
    actionUrl: '{{ .ConfirmationURL }}',
    detailHtml: 'El cambio no se completa hasta confirmar el enlace. La protección de doble confirmación puede requerir validar también la dirección anterior.',
    footerHtml: 'Si no has solicitado este cambio, no confirmes el enlace y revisa la seguridad de tu cuenta.',
  },
  {
    kind: 'authentication',
    type: 'reauthentication',
    outputPath: 'supabase/templates/reauthentication.html',
    subject: '{{ .Token }} es tu código de seguridad de Minuto 106',
    preheader: 'Confirma una operación sensible con este código temporal.',
    eyebrow: 'VERIFICACIÓN DE SEGURIDAD',
    title: 'Confirma que eres tú',
    introHtml: 'Introduce este código únicamente en la pantalla oficial de Minuto 106 que te lo haya solicitado.',
    otpLabel: 'Código de seguridad',
    detailHtml: 'El código es temporal y solo sirve para autorizar la operación actual.',
    footerHtml: 'No compartas este código. El equipo de Minuto 106 nunca te lo pedirá por mensaje o llamada.',
  },
];

const NOTIFICATION_DEFINITIONS = [
  {
    kind: 'notification',
    type: 'password_changed',
    outputPath: 'supabase/templates/notifications/password-changed.html',
    subject: 'Tu contraseña de Minuto 106 ha cambiado',
    preheader: 'Aviso de seguridad: se ha cambiado la contraseña de tu cuenta.',
    eyebrow: 'AVISO DE SEGURIDAD',
    title: 'Tu contraseña ha cambiado',
    introHtml: 'La contraseña asociada a <strong style="color:#ffe27f">{{ .Email }}</strong> se ha actualizado correctamente.',
    actionLabel: 'Revisar mi cuenta',
    actionUrl: AUTH_EMAIL_BRAND.accountUrl,
    detailHtml: 'Si reconoces el cambio, no necesitas hacer nada más.',
    footerHtml: 'Si no lo has realizado, restablece la contraseña inmediatamente y revisa las identidades vinculadas.',
  },
  {
    kind: 'notification',
    type: 'email_changed',
    outputPath: 'supabase/templates/notifications/email-changed.html',
    subject: 'El email de tu cuenta de Minuto 106 ha cambiado',
    preheader: 'Aviso de seguridad sobre un cambio de dirección de email.',
    eyebrow: 'AVISO DE SEGURIDAD',
    title: 'Tu email ha cambiado',
    introHtml: 'La dirección de acceso ha cambiado de <strong style="color:#ffe27f">{{ .OldEmail }}</strong> a <strong style="color:#ffe27f">{{ .Email }}</strong>.',
    actionLabel: 'Revisar mi cuenta',
    actionUrl: AUTH_EMAIL_BRAND.accountUrl,
    detailHtml: 'Si reconoces el cambio, no necesitas hacer nada más.',
    footerHtml: 'Si no lo has realizado, protege la cuenta y revisa las identidades vinculadas.',
  },
  {
    kind: 'notification',
    type: 'phone_changed',
    outputPath: 'supabase/templates/notifications/phone-changed.html',
    subject: 'El teléfono de tu cuenta de Minuto 106 ha cambiado',
    preheader: 'Aviso de seguridad sobre un cambio de número de teléfono.',
    eyebrow: 'AVISO DE SEGURIDAD',
    title: 'Tu teléfono ha cambiado',
    introHtml: 'El número asociado a la cuenta ha cambiado de <strong style="color:#ffe27f">{{ .OldPhone }}</strong> a <strong style="color:#ffe27f">{{ .Phone }}</strong>.',
    actionLabel: 'Revisar mi cuenta',
    actionUrl: AUTH_EMAIL_BRAND.accountUrl,
    detailHtml: 'Este aviso no contiene credenciales ni solicita información privada.',
    footerHtml: 'Si no lo has realizado, protege la cuenta inmediatamente.',
  },
  {
    kind: 'notification',
    type: 'mfa_factor_enrolled',
    outputPath: 'supabase/templates/notifications/mfa-factor-enrolled.html',
    subject: 'Se ha añadido una verificación a tu cuenta de Minuto 106',
    preheader: 'Aviso de seguridad: se ha añadido un nuevo método de verificación.',
    eyebrow: 'AVISO DE SEGURIDAD',
    title: 'Nuevo método de verificación',
    introHtml: 'Se ha añadido el método <strong style="color:#ffe27f">{{ .FactorType }}</strong> a tu cuenta.',
    actionLabel: 'Revisar mi cuenta',
    actionUrl: AUTH_EMAIL_BRAND.accountUrl,
    detailHtml: 'Los métodos de verificación refuerzan las operaciones sensibles y el acceso a la cuenta.',
    footerHtml: 'Si no lo has añadido, revisa la seguridad de la cuenta inmediatamente.',
  },
  {
    kind: 'notification',
    type: 'mfa_factor_unenrolled',
    outputPath: 'supabase/templates/notifications/mfa-factor-unenrolled.html',
    subject: 'Se ha eliminado una verificación de tu cuenta de Minuto 106',
    preheader: 'Aviso de seguridad: se ha eliminado un método de verificación.',
    eyebrow: 'AVISO DE SEGURIDAD',
    title: 'Método de verificación eliminado',
    introHtml: 'Se ha eliminado el método <strong style="color:#ffe27f">{{ .FactorType }}</strong> de tu cuenta.',
    actionLabel: 'Revisar mi cuenta',
    actionUrl: AUTH_EMAIL_BRAND.accountUrl,
    detailHtml: 'La cuenta puede tener ahora menos protección para operaciones sensibles.',
    footerHtml: 'Si no lo has eliminado, revisa la seguridad de la cuenta inmediatamente.',
  },
  {
    kind: 'notification',
    type: 'identity_linked',
    outputPath: 'supabase/templates/notifications/identity-linked.html',
    subject: 'Se ha vinculado un acceso a tu cuenta de Minuto 106',
    preheader: 'Aviso de seguridad sobre un nuevo método de inicio de sesión.',
    eyebrow: 'AVISO DE SEGURIDAD',
    title: 'Nuevo acceso vinculado',
    introHtml: 'Se ha vinculado el proveedor <strong style="color:#ffe27f">{{ .Provider }}</strong> a tu cuenta.',
    actionLabel: 'Revisar mi cuenta',
    actionUrl: AUTH_EMAIL_BRAND.accountUrl,
    detailHtml: 'Las identidades vinculadas permiten recuperar el mismo progreso desde otros dispositivos.',
    footerHtml: 'Si no reconoces este acceso, revisa la cuenta y cambia la contraseña.',
  },
  {
    kind: 'notification',
    type: 'identity_unlinked',
    outputPath: 'supabase/templates/notifications/identity-unlinked.html',
    subject: 'Se ha desvinculado un acceso de tu cuenta de Minuto 106',
    preheader: 'Aviso de seguridad sobre un método de inicio de sesión eliminado.',
    eyebrow: 'AVISO DE SEGURIDAD',
    title: 'Acceso desvinculado',
    introHtml: 'Se ha desvinculado el proveedor <strong style="color:#ffe27f">{{ .Provider }}</strong> de tu cuenta.',
    actionLabel: 'Revisar mi cuenta',
    actionUrl: AUTH_EMAIL_BRAND.accountUrl,
    detailHtml: 'Comprueba que conservas al menos un método seguro para recuperar tu progreso.',
    footerHtml: 'Si no reconoces este cambio, protege la cuenta inmediatamente.',
  },
];

export const AUTH_EMAIL_TEMPLATES = Object.freeze(
  [...AUTH_TEMPLATE_DEFINITIONS, ...NOTIFICATION_DEFINITIONS].map((template) => Object.freeze(template)),
);

function otpBlock(template) {
  if (!template.otpLabel) return '';
  return `
                  <p style="margin:22px 0 8px;color:#aeb3be;font-size:13px;line-height:1.5">${template.otpLabel}</p>
                  <div role="status" aria-label="${template.otpLabel}" style="margin:0 0 22px;padding:16px 12px;border:1px solid #f4c95d66;border-radius:14px;background:#08090c;color:#ffe27f;font-family:Consolas,'Courier New',monospace;font-size:30px;font-weight:900;letter-spacing:.22em;line-height:1.2;text-align:center">{{ .Token }}</div>`;
}

function actionBlock(template) {
  if (!template.actionUrl) return '';
  return `
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px;border-collapse:collapse">
                    <tr>
                      <td align="center" style="padding:0">
                        <a href="${template.actionUrl}" style="display:inline-block;padding:14px 20px;border-radius:12px;background:#f4c95d;color:#11131a;font-size:15px;font-weight:900;line-height:1.2;text-decoration:none">${template.actionLabel}</a>
                      </td>
                    </tr>
                  </table>
                  <p style="margin:0 0 22px;color:#8f96a3;font-size:11px;line-height:1.55;overflow-wrap:anywhere">Si el botón no funciona, copia y abre este enlace:<br><a href="${template.actionUrl}" style="color:#f5d879;text-decoration:underline;word-break:break-all">${template.actionUrl}</a></p>`;
}

export function renderAuthEmailTemplate(template) {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="dark">
    <meta name="supported-color-schemes" content="dark">
    <title>${template.subject}</title>
  </head>
  <body style="margin:0;padding:0;background:#08090c;color:#f7f8fb;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;text-size-adjust:100%">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${template.preheader}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;background:#08090c">
      <tr>
        <td align="center" style="padding:24px 12px">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;border-collapse:separate;border-spacing:0;border:1px solid #2a2e38;border-radius:20px;background:#11131a;overflow:hidden">
            <tr>
              <td style="padding:18px 24px;border-bottom:1px solid #262a33;background:#0d0f14">
                <a href="${AUTH_EMAIL_BRAND.siteUrl}" style="color:#f4c95d;font-size:13px;font-weight:900;letter-spacing:.18em;text-decoration:none">MINUTO 106</a>
              </td>
            </tr>
            <tr>
              <td style="padding:0;background:#08090c">
                <img src="${AUTH_EMAIL_BRAND.imageUrl}" width="600" alt="España y Argentina compiten por detener el reloj en 10.600" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none">
              </td>
            </tr>
            <tr>
              <td style="padding:30px 28px 26px">
                <p style="margin:0 0 10px;color:#f4c95d;font-size:11px;font-weight:900;letter-spacing:.15em;line-height:1.3">${template.eyebrow}</p>
                <h1 style="margin:0 0 16px;color:#f7f8fb;font-size:28px;font-weight:900;letter-spacing:-.02em;line-height:1.15">${template.title}</h1>
                <p style="margin:0;color:#c6cad3;font-size:15px;line-height:1.65">${template.introHtml}</p>${otpBlock(template)}${actionBlock(template)}
                <div style="margin:0 0 18px;padding:14px 16px;border:1px solid #ffffff17;border-radius:13px;background:#ffffff08;color:#c6cad3;font-size:13px;line-height:1.6">${template.detailHtml}</div>
                <p style="margin:0;color:#8f96a3;font-size:12px;line-height:1.55">${template.footerHtml}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 24px;border-top:1px solid #262a33;background:#0d0f14;color:#777e8b;font-size:11px;line-height:1.55;text-align:center">
                Mensaje automático de seguridad de <a href="${AUTH_EMAIL_BRAND.siteUrl}" style="color:#b7bbc5;text-decoration:underline">Minuto 106</a>. Nunca respondas con contraseñas, códigos o claves privadas.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
}

const NOTIFICATION_HOSTED_KEYS = Object.freeze({
  password_changed: 'password_changed_notification',
  email_changed: 'email_changed_notification',
  phone_changed: 'phone_changed_notification',
  mfa_factor_enrolled: 'mfa_factor_enrolled_notification',
  mfa_factor_unenrolled: 'mfa_factor_unenrolled_notification',
  identity_linked: 'identity_linked_notification',
  identity_unlinked: 'identity_unlinked_notification',
});

export function buildHostedAuthEmailConfig() {
  const config = {};
  for (const template of AUTH_EMAIL_TEMPLATES) {
    if (template.kind === 'authentication') {
      config[`mailer_subjects_${template.type}`] = template.subject;
      config[`mailer_templates_${template.type}_content`] = renderAuthEmailTemplate(template);
      continue;
    }
    const hostedKey = NOTIFICATION_HOSTED_KEYS[template.type];
    config[`mailer_notifications_${template.type}_enabled`] = true;
    config[`mailer_subjects_${hostedKey}`] = template.subject;
    config[`mailer_templates_${hostedKey}_content`] = renderAuthEmailTemplate(template);
  }
  return config;
}
