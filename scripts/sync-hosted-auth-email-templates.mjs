import {
  hostedAuthEmailSyncEnvironment,
  synchronizeHostedAuthEmails,
} from './hosted-auth-email-sync.mjs';

const argumentsSet = new Set(process.argv.slice(2));
const supportedArguments = new Set(['--apply']);
const unknownArguments = [...argumentsSet].filter((argument) => !supportedArguments.has(argument));
if (unknownArguments.length > 0) {
  throw new Error(`Unsupported arguments: ${unknownArguments.join(', ')}`);
}

const environment = hostedAuthEmailSyncEnvironment(process.env);
const result = await synchronizeHostedAuthEmails({
  ...environment,
  apply: argumentsSet.has('--apply'),
});

process.stdout.write(result.changed
  ? `Hosted Supabase Auth email configuration synchronized and verified (${result.drift.length} managed keys updated).\n`
  : 'Hosted Supabase Auth email configuration already matches the maintained catalogue.\n');
