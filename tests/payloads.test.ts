import { describe, expect, it } from 'vitest';
import {
  buildEmail,
  buildPayload,
  buildPhone,
  buildSms,
  buildVCard,
  buildWifi,
  escapeVCard,
  escapeWifi,
  normalizePhone,
  type VCardFields,
} from '../src/lib/payloads';
import { DEFAULT_STYLE, decodeStyle, encodeStyle, sanitizeStyle, toQrOptions } from '../src/lib/state';
import { contrastRatio } from '../src/lib/contrast';

const emptyCard: VCardFields = {
  firstName: '',
  lastName: '',
  org: '',
  title: '',
  phone: '',
  email: '',
  url: '',
  street: '',
  city: '',
  region: '',
  zip: '',
  country: '',
};

describe('wifi', () => {
  it('builds a WPA network string', () => {
    expect(buildWifi({ ssid: 'Home', password: 'secret', encryption: 'WPA', hidden: false })).toBe(
      'WIFI:T:WPA;S:Home;P:secret;;',
    );
  });

  it('escapes special characters', () => {
    expect(escapeWifi('a;b,c:d"e\\f')).toBe('a\\;b\\,c\\:d\\"e\\\\f');
    expect(buildWifi({ ssid: 'My;Net', password: 'p:w', encryption: 'WPA', hidden: true })).toBe(
      'WIFI:T:WPA;S:My\\;Net;P:p\\:w;H:true;;',
    );
  });

  it('omits the password for open networks', () => {
    expect(buildWifi({ ssid: 'Cafe', password: 'ignored', encryption: 'nopass', hidden: false })).toBe(
      'WIFI:T:nopass;S:Cafe;;',
    );
  });

  it('returns empty without an SSID', () => {
    expect(buildWifi({ ssid: '', password: 'x', encryption: 'WPA', hidden: false })).toBe('');
  });
});

describe('vcard', () => {
  it('builds a minimal card', () => {
    expect(buildVCard({ ...emptyCard, firstName: 'Ada', lastName: 'Lovelace' })).toBe(
      ['BEGIN:VCARD', 'VERSION:3.0', 'N:Lovelace;Ada;;;', 'FN:Ada Lovelace', 'END:VCARD'].join('\r\n'),
    );
  });

  it('includes optional fields and the address', () => {
    const card = buildVCard({
      ...emptyCard,
      firstName: 'Ada',
      org: 'Analytical, Inc.',
      phone: '+44 (20) 1234-5678',
      email: 'ada@example.com',
      city: 'London',
      country: 'UK',
    });
    expect(card).toContain('ORG:Analytical\\, Inc.');
    expect(card).toContain('TEL;TYPE=CELL:+442012345678');
    expect(card).toContain('EMAIL:ada@example.com');
    expect(card).toContain('ADR;TYPE=WORK:;;;London;;;UK');
  });

  it('falls back to the organization for FN', () => {
    expect(buildVCard({ ...emptyCard, org: 'Acme' })).toContain('FN:Acme');
  });

  it('escapes values', () => {
    expect(escapeVCard('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
  });

  it('returns empty when nothing identifying is set', () => {
    expect(buildVCard(emptyCard)).toBe('');
  });
});

describe('email / sms / phone', () => {
  it('builds mailto with encoded params', () => {
    expect(buildEmail({ to: 'a@b.co', subject: 'Hi there', body: 'Line 1\nLine 2 & more' })).toBe(
      'mailto:a@b.co?subject=Hi%20there&body=Line%201%0ALine%202%20%26%20more',
    );
    expect(buildEmail({ to: 'a@b.co', subject: '', body: '' })).toBe('mailto:a@b.co');
  });

  it('builds SMSTO', () => {
    expect(buildSms({ phone: '+1 555-123', message: 'Hello' })).toBe('SMSTO:+1555123:Hello');
    expect(buildSms({ phone: '555', message: '' })).toBe('SMSTO:555');
  });

  it('builds tel', () => {
    expect(buildPhone({ phone: ' +1 (555) 000 ' })).toBe('tel:+1555000');
    expect(buildPhone({ phone: '' })).toBe('');
  });

  it('normalizes phones', () => {
    expect(normalizePhone('+49 30/1234-56')).toBe('+4930123456');
  });

  it('dispatches by type', () => {
    expect(buildPayload('text', { text: 'https://example.com' })).toBe('https://example.com');
    expect(buildPayload('phone', { phone: '123' })).toBe('tel:123');
  });
});

describe('style state', () => {
  it('round-trips through the share encoding', () => {
    const style = sanitizeStyle({ dots: { type: 'dots', fill: { mode: 'linear', color: '#ff0000', color2: '#00ff00', rotation: 90 } } });
    expect(decodeStyle(encodeStyle(style))).toEqual(style);
  });

  it('rejects invalid values from untrusted input', () => {
    const style = sanitizeStyle({ dots: { type: 'evil', fill: { color: 'url(javascript:1)' } }, margin: 9999, extra: 1 });
    expect(style.dots.type).toBe(DEFAULT_STYLE.dots.type);
    expect(style.dots.fill.color).toBe(DEFAULT_STYLE.dots.fill.color);
    expect(style.margin).toBe(60);
    expect(style).not.toHaveProperty('extra');
    expect(decodeStyle('!!!not-base64')).toBeNull();
  });

  it('maps to qr-code-styling options', () => {
    const opts = toQrOptions({ style: DEFAULT_STYLE, data: 'x', logo: 'data:image/png;base64,AA', size: 600 });
    expect(opts.qrOptions?.errorCorrectionLevel).toBe('H');
    expect(opts.margin).toBe(DEFAULT_STYLE.margin * 2);
    expect(opts.cornersSquareOptions?.type).toBeUndefined();
    expect(opts.cornersSquareOptions?.color).toBe(DEFAULT_STYLE.dots.fill.color);
  });
});

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });
});
