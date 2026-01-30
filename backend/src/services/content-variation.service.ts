// backend/src/services/content-variation.service.ts
/**
 * Content Variation Service
 * 
 * Menangani variasi konten untuk mengurangi risiko ban WhatsApp:
 * 1. Spintext - Random selection dari alternatif teks
 * 2. URL parameter variation - Append unique params ke URL
 * 3. Message fingerprinting - Subtle variations untuk hindari duplicate detection
 */

/**
 * Process spintext dalam pesan
 * Format: {option1|option2|option3}
 * 
 * @example
 * processSpintext("{Halo|Hi|Hai} {{nama}}!")
 * // Returns: "Hi {{nama}}!" (random selection)
 */
export function processSpintext(text: string): string {
    // Pattern: {...|...|...}
    const spintextPattern = /\{([^{}]+)\}/g;

    return text.replace(spintextPattern, (match, options) => {
        // Skip if it looks like a template variable {{xxx}}
        if (match.startsWith('{{')) return match;

        const choices = options.split('|').map((s: string) => s.trim());
        if (choices.length <= 1) return match;

        const randomIndex = Math.floor(Math.random() * choices.length);
        return choices[randomIndex];
    });
}

/**
 * Append unique URL parameters untuk tracking dan variation
 * 
 * @example
 * appendUrlParams("https://example.com/promo", "contact123")
 * // Returns: "https://example.com/promo?ref=abc123&t=1706634984"
 */
export function appendUrlParams(message: string, contactId: string): string {
    // Generate unique ref dari contactId (short hash)
    const refCode = generateShortRef(contactId);
    const timestamp = Math.floor(Date.now() / 1000);

    // Pattern untuk mendeteksi URL
    const urlPattern = /(https?:\/\/[^\s]+)/g;

    return message.replace(urlPattern, (url) => {
        try {
            const urlObj = new URL(url);

            // Jangan modify jika sudah ada ref parameter
            if (urlObj.searchParams.has('ref') || urlObj.searchParams.has('r')) {
                return url;
            }

            // Append unique params
            urlObj.searchParams.set('r', refCode);
            urlObj.searchParams.set('t', String(timestamp));

            return urlObj.toString();
        } catch {
            // Invalid URL, return as-is
            return url;
        }
    });
}

/**
 * Generate short reference code dari contactId
 */
function generateShortRef(contactId: string): string {
    // Simple hash untuk generate 6 char alphanumeric
    let hash = 0;
    for (let i = 0; i < contactId.length; i++) {
        const char = contactId.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }

    // Convert ke base36 dan ambil 6 karakter
    const code = Math.abs(hash).toString(36).substring(0, 6);

    // Tambah random suffix untuk variasi tambahan
    const randomSuffix = Math.random().toString(36).substring(2, 4);

    return code + randomSuffix;
}

/**
 * Add subtle fingerprint variations ke message
 * Untuk menghindari duplicate content detection
 */
export function addMessageFingerprint(message: string): string {
    const variations: Array<() => string> = [
        // Random trailing spaces (invisible)
        () => message + getRandomSpaces(),

        // Random zero-width characters (invisible)
        () => insertZeroWidthChars(message),

        // Slight punctuation variation
        () => varyPunctuation(message),
    ];

    // Pick random variation
    const randomVariation = variations[Math.floor(Math.random() * variations.length)];
    return randomVariation();
}

/**
 * Generate random invisible trailing spaces
 */
function getRandomSpaces(): string {
    const count = Math.floor(Math.random() * 3) + 1;
    return ' '.repeat(count);
}

/**
 * Insert zero-width characters randomly (completely invisible)
 */
function insertZeroWidthChars(text: string): string {
    const zeroWidthChars = [
        '\u200B', // Zero-width space
        '\u200C', // Zero-width non-joiner
        '\u200D', // Zero-width joiner
        '\uFEFF', // Zero-width no-break space
    ];

    // Insert at random positions (1-3 times)
    let result = text;
    const insertCount = Math.floor(Math.random() * 2) + 1;

    for (let i = 0; i < insertCount; i++) {
        const pos = Math.floor(Math.random() * result.length);
        const char = zeroWidthChars[Math.floor(Math.random() * zeroWidthChars.length)];
        result = result.slice(0, pos) + char + result.slice(pos);
    }

    return result;
}

/**
 * Vary punctuation slightly
 */
function varyPunctuation(text: string): string {
    const variations: Record<string, string[]> = {
        '.': ['.', '..', '. '],
        '!': ['!', '!!', '! '],
        '?': ['?', '??', '? '],
    };

    let result = text;

    // Only vary ending punctuation (less intrusive)
    for (const [punct, alts] of Object.entries(variations)) {
        if (result.endsWith(punct)) {
            const alt = alts[Math.floor(Math.random() * alts.length)];
            result = result.slice(0, -punct.length) + alt;
            break;
        }
    }

    return result;
}

/**
 * Process complete message template with all variations
 * 
 * @param template - Message template with spintext and placeholders
 * @param contact - Contact object with name and id
 * @returns Processed message ready to send
 * 
 * Supported placeholders:
 * - {{nama}} - Contact name (Indonesian)
 * - {{name}} - Contact name (English)
 * - {{phone}} - Phone number
 * - {{nomor}} - Phone number (Indonesian)
 */
export function processMessageTemplate(
    template: string,
    contact: { id: string; name?: string | null; phoneNumber: string }
): string {
    let message = template;

    // 1. Process spintext first
    message = processSpintext(message);

    // 2. Prepare contact values
    const contactName = contact.name?.trim() || '';
    const phoneNumber = contact.phoneNumber || '';

    // Use phone as fallback if name is empty
    const displayName = contactName || phoneNumber;

    // Debug log jika nama kosong
    if (!contactName && (message.includes('{{nama}}') || message.includes('{{name}}'))) {
        console.warn(`[CONTENT-VAR] Contact ${contact.id} has no name, using phone: ${phoneNumber}`);
    }

    // 3. Replace ALL name placeholders (case insensitive)
    // Support both {{nama}} (Indonesian) and {{name}} (English)
    message = message.replace(/\{\{nama\}\}/gi, displayName);
    message = message.replace(/\{\{name\}\}/gi, displayName);

    // 4. Replace phone placeholders
    message = message.replace(/\{\{phone\}\}/gi, phoneNumber);
    message = message.replace(/\{\{nomor\}\}/gi, phoneNumber);

    // 5. Append URL params for uniqueness
    message = appendUrlParams(message, contact.id);

    // 6. Add invisible fingerprint
    message = addMessageFingerprint(message);

    return message;
}

/**
 * Validate spintext syntax
 */
export function validateSpintext(text: string): { valid: boolean; error?: string } {
    let braceCount = 0;

    for (let i = 0; i < text.length; i++) {
        if (text[i] === '{' && text[i + 1] !== '{') {
            braceCount++;
        } else if (text[i] === '}' && text[i - 1] !== '}') {
            braceCount--;
        }

        if (braceCount < 0) {
            return { valid: false, error: 'Unmatched closing brace at position ' + i };
        }
    }

    if (braceCount !== 0) {
        return { valid: false, error: 'Unclosed spintext brace' };
    }

    return { valid: true };
}

export default {
    processSpintext,
    appendUrlParams,
    addMessageFingerprint,
    processMessageTemplate,
    validateSpintext,
};
