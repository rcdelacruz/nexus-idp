/**
 * Machine ID generation for stable agent identification
 *
 * Generates a consistent agent ID based on machine characteristics:
 * - Hostname
 * - Primary network MAC address
 * - Platform (OS)
 *
 * Format: agent-{hostname}-{hash}
 * Example: agent-macbook-pro-a1b2c3d4
 */

import { createHash } from 'crypto';
import { hostname, platform, networkInterfaces } from 'os';

/**
 * Get primary MAC address for stable machine identification
 */
function getPrimaryMacAddress(): string {
  const interfaces = networkInterfaces();

  // Priority order: eth0, en0, wlan0, or first non-internal interface
  const priorityInterfaces = ['eth0', 'en0', 'wlan0'];

  // Try priority interfaces first
  for (const ifaceName of priorityInterfaces) {
    const iface = interfaces[ifaceName];
    if (iface) {
      const mac = iface.find(i => !i.internal && i.mac !== '00:00:00:00:00:00');
      if (mac?.mac) {
        return mac.mac;
      }
    }
  }

  // Fallback: find any non-internal interface with a valid MAC
  for (const [_name, iface] of Object.entries(interfaces)) {
    if (!iface) continue;
    const mac = iface.find(i => !i.internal && i.mac !== '00:00:00:00:00:00');
    if (mac?.mac) {
      return mac.mac;
    }
  }

  // Last resort: use hostname as MAC (shouldn't happen on real machines)
  return hostname();
}

/**
 * Generate a short hash from a string
 */
function shortHash(input: string): string {
  return createHash('sha256')
    .update(input)
    .digest('hex')
    .substring(0, 8);
}

/**
 * Sanitize hostname for use in agent ID
 * - Convert to lowercase
 * - Replace dots and spaces with hyphens
 * - Remove special characters
 * - Limit to 32 characters
 */
function sanitizeHostname(host: string): string {
  return host
    .toLowerCase()
    .replace(/\.(local|lan|home)$/i, '') // Remove common suffixes
    .replace(/[.\s]+/g, '-')              // Replace dots/spaces with hyphens
    .replace(/[^a-z0-9-]/g, '')           // Remove special chars
    .substring(0, 32);                    // Limit length
}

/**
 * Get machine metadata for agent registration
 */
export interface MachineInfo {
  agentId: string;      // agent-macbook-pro-a1b2c3d4
  hostname: string;     // macbook-pro.local
  platform: string;     // darwin, linux, win32
  platformVersion: string; // macOS 14.2, Ubuntu 22.04, Windows 11
}

/**
 * Generate stable machine-based agent ID
 */
export function getMachineInfo(): MachineInfo {
  const host = hostname();
  const mac = getPrimaryMacAddress();
  const os = platform();

  // Create stable ID from hostname + MAC
  const sanitizedHost = sanitizeHostname(host);
  const hash = shortHash(`${host}-${mac}`);
  const agentId = `agent-${sanitizedHost}-${hash}`;

  // Get platform version
  let platformVersion: string = os;
  try {
    const osModule = require('os');
    if (os === 'darwin') {
      platformVersion = `macOS ${osModule.release()}`;
    } else if (os === 'linux') {
      platformVersion = `Linux ${osModule.release()}`;
    } else if (os === 'win32') {
      platformVersion = `Windows ${osModule.release()}`;
    }
  } catch {
    // Use platform name as fallback
  }

  return {
    agentId,
    hostname: host,
    platform: os,
    platformVersion,
  };
}

/**
 * Get just the agent ID (convenience function)
 */
export function getMachineId(): string {
  return getMachineInfo().agentId;
}
