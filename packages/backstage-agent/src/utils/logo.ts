/**
 * 8-bit ASCII art logo and branding utilities
 */

import chalk from 'chalk';

export const LOGO = `
╔════════════════════════════════════════════════════════════════════╗
║                                                                    ║
║   ██████╗  █████╗  ██████╗██╗  ██╗███████╗████████╗ █████╗  ██████╗ ███████╗
║   ██╔══██╗██╔══██╗██╔════╝██║ ██╔╝██╔════╝╚══██╔══╝██╔══██╗██╔════╝ ██╔════╝
║   ██████╔╝███████║██║     █████╔╝ ███████╗   ██║   ███████║██║  ███╗█████╗
║   ██╔══██╗██╔══██║██║     ██╔═██╗ ╚════██║   ██║   ██╔══██║██║   ██║██╔══╝
║   ██████╔╝██║  ██║╚██████╗██║  ██╗███████║   ██║   ██║  ██║╚██████╔╝███████╗
║   ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚══════╝
║                                  ━━━━━
║                            █████╗  ██████╗ ███████╗███╗   ██╗████████╗
║                           ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝
║                           ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║
║                           ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║
║                           ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║
║                           ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝
║                                                                    ║
║                  🎮 Local Provisioning Agent v0.1.3 🎮            ║
║                                                                    ║
╚════════════════════════════════════════════════════════════════════╝
`;

export const MINI_LOGO = `
  ██████╗  █████╗  ██████╗██╗  ██╗███████╗████████╗ █████╗  ██████╗ ███████╗
  ██╔══██╗██╔══██╗██╔════╝██║ ██╔╝██╔════╝╚══██╔══╝██╔══██╗██╔════╝ ██╔════╝
  ██████╔╝███████║██║     █████╔╝ ███████╗   ██║   ███████║██║  ███╗█████╗
  ██╔══██╗██╔══██║██║     ██╔═██╗ ╚════██║   ██║   ██╔══██║██║   ██║██╔══╝
  ██████╔╝██║  ██║╚██████╗██║  ██╗███████║   ██║   ██║  ██║╚██████╔╝███████╗
  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚══════╝
                             ━━━━━
                    █████╗  ██████╗ ███████╗███╗   ██╗████████╗
                   ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝
                   ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║
                   ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║
                   ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║
                   ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝
`;

export function displayLogo(): void {
  console.log(chalk.cyan(LOGO));
}

export function displayMiniLogo(): void {
  console.log(chalk.cyan(MINI_LOGO));
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
