// Builders that turn form fields into the string encoded in the QR code.

export type ContentType = 'text' | 'wifi' | 'vcard' | 'email' | 'sms' | 'phone';

export interface WifiFields {
  ssid: string;
  password: string;
  encryption: 'WPA' | 'WEP' | 'nopass';
  hidden: boolean;
}

export interface VCardFields {
  firstName: string;
  lastName: string;
  org: string;
  title: string;
  phone: string;
  email: string;
  url: string;
  street: string;
  city: string;
  region: string;
  zip: string;
  country: string;
}

export interface EmailFields {
  to: string;
  subject: string;
  body: string;
}

export interface SmsFields {
  phone: string;
  message: string;
}

export interface PhoneFields {
  phone: string;
}

export interface ContentFields {
  text: { text: string };
  wifi: WifiFields;
  vcard: VCardFields;
  email: EmailFields;
  sms: SmsFields;
  phone: PhoneFields;
}

/** Escape special characters for the MECARD-style WIFI: format. */
export function escapeWifi(value: string): string {
  return value.replace(/([\\;,:"])/g, '\\$1');
}

/** Escape a vCard 3.0 property value (RFC 2426 §4). */
export function escapeVCard(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/** Strip formatting characters from a phone number, keeping a leading +. */
export function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  return plus + trimmed.replace(/[^\d]/g, '');
}

export function buildText({ text }: ContentFields['text']): string {
  return text;
}

export function buildWifi(f: WifiFields): string {
  if (!f.ssid) return '';
  let out = `WIFI:T:${f.encryption};S:${escapeWifi(f.ssid)};`;
  if (f.encryption !== 'nopass' && f.password) out += `P:${escapeWifi(f.password)};`;
  if (f.hidden) out += 'H:true;';
  return out + ';';
}

export function buildVCard(f: VCardFields): string {
  const first = f.firstName.trim();
  const last = f.lastName.trim();
  const fullName = [first, last].filter(Boolean).join(' ');
  const hasAddress = [f.street, f.city, f.region, f.zip, f.country].some((v) => v.trim());
  if (!fullName && !f.org && !f.phone && !f.email) return '';

  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  lines.push(`N:${escapeVCard(last)};${escapeVCard(first)};;;`);
  lines.push(`FN:${escapeVCard(fullName || f.org)}`);
  if (f.org) lines.push(`ORG:${escapeVCard(f.org)}`);
  if (f.title) lines.push(`TITLE:${escapeVCard(f.title)}`);
  if (f.phone) lines.push(`TEL;TYPE=CELL:${normalizePhone(f.phone)}`);
  if (f.email) lines.push(`EMAIL:${escapeVCard(f.email.trim())}`);
  if (f.url) lines.push(`URL:${escapeVCard(f.url.trim())}`);
  if (hasAddress) {
    const adr = [f.street, f.city, f.region, f.zip, f.country].map((v) => escapeVCard(v.trim()));
    lines.push(`ADR;TYPE=WORK:;;${adr.join(';')}`);
  }
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

export function buildEmail(f: EmailFields): string {
  if (!f.to) return '';
  const params: string[] = [];
  if (f.subject) params.push(`subject=${encodeURIComponent(f.subject)}`);
  if (f.body) params.push(`body=${encodeURIComponent(f.body)}`);
  return `mailto:${f.to.trim()}${params.length ? '?' + params.join('&') : ''}`;
}

export function buildSms(f: SmsFields): string {
  const phone = normalizePhone(f.phone);
  if (!phone) return '';
  return f.message ? `SMSTO:${phone}:${f.message}` : `SMSTO:${phone}`;
}

export function buildPhone(f: PhoneFields): string {
  const phone = normalizePhone(f.phone);
  return phone ? `tel:${phone}` : '';
}

export function buildPayload<T extends ContentType>(type: T, fields: ContentFields[T]): string {
  switch (type) {
    case 'text':
      return buildText(fields as ContentFields['text']);
    case 'wifi':
      return buildWifi(fields as WifiFields);
    case 'vcard':
      return buildVCard(fields as VCardFields);
    case 'email':
      return buildEmail(fields as EmailFields);
    case 'sms':
      return buildSms(fields as SmsFields);
    case 'phone':
      return buildPhone(fields as PhoneFields);
    default:
      return '';
  }
}

/** Max byte-mode capacity of a version 40 QR code per error-correction level. */
export const BYTE_CAPACITY = { L: 2953, M: 2331, Q: 1663, H: 1273 } as const;

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
