import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  AUTH_EMAIL_BRAND,
  AUTH_EMAIL_TEMPLATES,
  buildHostedAuthEmailConfig,
  renderAuthEmailTemplate,
} from '../scripts/auth-email-templates.mjs';

const authenticationTypes = ['confirmation', 'recovery', 'magic_link', 'invite', 'email_change', 'reauthentication'];
const notificationTypes = [
  'password_changed',
  'email_changed',
  'phone_changed',
  'mfa_factor_enrolled',
  'mfa_factor_unenrolled',
  'identity_linked',
  'identity_unlinked',
];

function template(type) {
  return AUTH_EMAIL_TEMPLATES.find((candidate) => candidate.type === type);
}

test('defines one complete and unique email catalogue', () => {
  assert.equal(AUTH_EMAIL_TEMPLATES.length, 13);
  assert.deepEqual(
    AUTH_EMAIL_TEMPLATES.filter(({ kind }) => kind === 'authentication').map(({ type }) => type),
    authenticationTypes,
  );
  assert.deepEqual(
    AUTH_EMAIL_TEMPLATES.filter(({ kind }) => kind === 'notification').map(({ type }) => type),
    notificationTypes,
  );
  assert.equal(new Set(AUTH_EMAIL_TEMPLATES.map(({ outputPath }) => outputPath)).size, 13);
  assert.equal(AUTH_EMAIL_BRAND.siteUrl, 'https://juanjogondev.github.io/106/');
});

test('renders every template with the global branded email layout', () => {
  for (const definition of AUTH_EMAIL_TEMPLATES) {
    const html = renderAuthEmailTemplate(definition);
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<html lang="es">/);
    assert.match(html, /role="presentation"/);
    assert.match(html, /MINUTO 106/);
    assert.match(html, /#f4c95d/);
    assert.match(html, /#08090c/);
    assert.match(html, new RegExp(AUTH_EMAIL_BRAND.imageUrl.replaceAll(/[.?]/g, '\\$&')));
    assert.match(html, /alt="España y Argentina compiten por detener el reloj en 10\.600"/);
    assert.match(html, new RegExp(definition.title.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(readFileSync(definition.outputPath, 'utf8'), html);
  }
});

test('uses OTPs and actions only where the product flow can consume them', () => {
  const confirmation = renderAuthEmailTemplate(template('confirmation'));
  assert.match(confirmation, /\{\{ \.Token \}\}/);
  assert.match(confirmation, /\{\{ \.RedirectTo \}\}\?token_hash=\{\{ \.TokenHash \}\}&amp;type=email/);

  const magicLink = renderAuthEmailTemplate(template('magic_link'));
  assert.match(magicLink, /Código de acceso/);
  assert.match(magicLink, /\{\{ \.ConfirmationURL \}\}/);

  const recovery = renderAuthEmailTemplate(template('recovery'));
  assert.doesNotMatch(recovery, /\{\{ \.Token \}\}/);
  assert.match(recovery, /Restablecer contraseña/);

  const reauthentication = renderAuthEmailTemplate(template('reauthentication'));
  assert.match(reauthentication, /Código de seguridad/);
  assert.match(reauthentication, /\{\{ \.Token \}\}/);
  assert.doesNotMatch(reauthentication, /Si el botón no funciona/);
});

test('builds the complete credential-free hosted Auth payload', () => {
  const config = buildHostedAuthEmailConfig();
  assert.equal(Object.keys(config).length, 33);
  for (const type of authenticationTypes) {
    assert.equal(config[`mailer_subjects_${type}`], template(type).subject);
    assert.equal(config[`mailer_templates_${type}_content`], renderAuthEmailTemplate(template(type)));
  }
  for (const type of notificationTypes) {
    assert.equal(config[`mailer_notifications_${type}_enabled`], true);
  }
  assert.equal(config.mailer_subjects_password_changed_notification, template('password_changed').subject);
  assert.equal(config.mailer_subjects_email_changed_notification, template('email_changed').subject);
  assert.equal(config.mailer_subjects_phone_changed_notification, template('phone_changed').subject);
  assert.equal(config.mailer_subjects_mfa_factor_enrolled_notification, template('mfa_factor_enrolled').subject);
  assert.equal(config.mailer_subjects_mfa_factor_unenrolled_notification, template('mfa_factor_unenrolled').subject);
  assert.equal(config.mailer_subjects_identity_linked_notification, template('identity_linked').subject);
  assert.equal(config.mailer_subjects_identity_unlinked_notification, template('identity_unlinked').subject);
  assert.doesNotMatch(JSON.stringify(config), /access[_-]?token|service[_-]?role|sb_secret_/i);
});

test('configures every local Supabase email source', () => {
  const config = readFileSync('supabase/config.toml', 'utf8');
  for (const definition of AUTH_EMAIL_TEMPLATES) {
    const section = definition.kind === 'authentication'
      ? `[auth.email.template.${definition.type}]`
      : `[auth.email.notification.${definition.type}]`;
    assert.match(config, new RegExp(section.replaceAll(/[.[\]]/g, '\\$&')));
    assert.match(config, new RegExp(definition.outputPath.replace('supabase/', './supabase/').replaceAll(/[.-]/g, '\\$&')));
  }
});
