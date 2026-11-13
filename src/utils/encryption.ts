import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

   const ALGORITHM = 'aes-256-cbc';
   const IV_LENGTH = 16;

   // Deriva una clave de 32 bytes a partir de la variable de entorno
   function getKey(): Buffer {
     const secret = process.env.ENCRYPTION_KEY || 'default_fallback_key_change_in_production';
     return scryptSync(secret, 'salt', 32);
   }

   export function encrypt(text: string): string {
     if (!text) return '';
     const iv = randomBytes(IV_LENGTH);
     const cipher = createCipheriv(ALGORITHM, getKey(), iv);
     let encrypted = cipher.update(text, 'utf8', 'hex');
     encrypted += cipher.final('hex');
     return `${iv.toString('hex')}:${encrypted}`;
   }

   export function decrypt(encryptedText: string): string {
     if (!encryptedText || !encryptedText.includes(':')) return '';
     const [ivHex, encrypted] = encryptedText.split(':');
     const iv = Buffer.from(ivHex, 'hex');
     const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
     let decrypted = decipher.update(encrypted, 'hex', 'utf8');
     decrypted += decipher.final('utf8');
     return decrypted;
   }
