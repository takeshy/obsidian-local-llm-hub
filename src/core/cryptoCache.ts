/**
 * Session-based cache for encryption credentials
 *
 * Stores password and decrypted private key in memory only.
 * Cleared when Obsidian is closed or the plugin is unloaded.
 */

class CryptoCache {
  private password: string | null = null;
  private privateKey: string | null = null;

  setPassword(password: string): void {
    this.password = password;
  }

  getPassword(): string | null {
    return this.password;
  }

  hasPassword(): boolean {
    return this.password !== null;
  }

  setPrivateKey(key: string): void {
    this.privateKey = key;
  }

  getPrivateKey(): string | null {
    return this.privateKey;
  }

  clear(): void {
    this.password = null;
    this.privateKey = null;
  }
}

export const cryptoCache = new CryptoCache();
