/**
 * Terminal branding and message helpers.
 */

import chalk from 'chalk';
import { AGENT_VERSION } from './version';

/** "BACKSTAGE AGENT" in a 2-row half-block font. */
const WORDMARK = [
  '█▄▄ ▄▀█ █▀▀ █▄▀ █▀ ▀█▀ ▄▀█ █▀▀ █▀▀   ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀',
  '█▄█ █▀█ █▄▄ █ █ ▄█  █  █▀█ █▄█ ██▄   █▀█ █▄█ ██▄ █ ▀█  █ ',
];
/** Columns the banner needs (2-space margin + the wordmark). */
export const BANNER_WIDTH = 2 + WORDMARK[0].length;

/**
 * The BACKSTAGE AGENT wordmark, left-aligned, with the real version underneath. Narrow terminals
 * (it would wrap) and non-terminal output (logs, pipes) get the one-line header instead.
 */
export function logoText(version: string = AGENT_VERSION, columns: number | undefined = process.stdout.isTTY ? process.stdout.columns : undefined): string {
  if (!columns || columns < BANNER_WIDTH) {
    return ['', `  ${chalk.bold.cyan('Backstage Agent')} ${chalk.dim(`v${version}`)}`, ''].join('\n');
  }
  return ['', ...WORDMARK.map(l => `  ${chalk.cyan(l)}`), `  ${chalk.dim(`Local Provisioner Agent  v${version}`)}`, ''].join('\n');
}

export function displayLogo(): void {
  console.log(logoText());
}

/** Aligned "label  value" rows with dim labels (status blocks, start summary). */
export function displayDetails(rows: Array<[string, string]>): void {
  const width = Math.max(...rows.map(([label]) => label.length));
  for (const [label, value] of rows) console.log(`  ${chalk.dim(label.padEnd(width))}  ${value}`);
}

/** A titled list of commands: "  command  what it does". */
export function displayCommands(title: string, commands: Array<[string, string]>): void {
  const width = Math.max(...commands.map(([cmd]) => cmd.length));
  console.log(`  ${chalk.bold(title)}`);
  for (const [cmd, what] of commands) console.log(`    ${chalk.cyan(cmd.padEnd(width))}  ${chalk.dim(what)}`);
}

export function displayBanner(message: string): void {
  const border = '═'.repeat(message.length + 4);
  console.log(chalk.cyan(`╔${border}╗`));
  console.log(chalk.cyan(`║  ${chalk.bold.white(message)}  ║`));
  console.log(chalk.cyan(`╚${border}╝`));
}

export function displaySuccess(message: string): void {
  console.log(chalk.green(`✓ ${message}`));
}

export function displayError(message: string): void {
  console.log(chalk.red(`✗ ${message}`));
}

export function displayInfo(message: string): void {
  console.log(chalk.blue(`ℹ ${message}`));
}

export function displayWarning(message: string): void {
  console.log(chalk.yellow(`⚠ ${message}`));
}
