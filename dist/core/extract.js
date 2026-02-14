/**
 * Structured data extraction using CSS selectors and heuristics
 */
import { load } from 'cheerio';
export function extractStructured(html, options) {
    const $ = load(html);
    const result = {};
    if (options.selectors) {
        // Direct CSS selector extraction
        for (const [field, selector] of Object.entries(options.selectors)) {
            const elements = $(selector);
            if (elements.length === 0) {
                result[field] = null;
            }
            else if (elements.length === 1) {
                result[field] = elements.first().text().trim();
            }
            else {
                result[field] = elements.map((_, el) => $(el).text().trim()).get();
            }
        }
    }
    if (options.schema) {
        // Schema-based extraction using heuristics
        const properties = options.schema.properties || options.schema;
        for (const [field, spec] of Object.entries(properties)) {
            if (result[field] !== undefined)
                continue; // Already extracted by selector
            // Try common CSS patterns based on field name
            const fieldLower = field.toLowerCase();
            const candidates = [
                `[itemprop="${fieldLower}"]`,
                `[data-${fieldLower}]`,
                `.${fieldLower}`,
                `#${fieldLower}`,
                `[class*="${fieldLower}"]`,
                `meta[name="${fieldLower}"]`,
                `meta[property="og:${fieldLower}"]`,
            ];
            for (const sel of candidates) {
                const el = $(sel).first();
                if (el.length > 0) {
                    let value = el.attr('content') || el.text().trim();
                    if (value) {
                        // Type coercion based on schema
                        if (spec?.type === 'number') {
                            const num = parseFloat(value.replace(/[^0-9.-]/g, ''));
                            if (!isNaN(num)) {
                                result[field] = num;
                                break;
                            }
                        }
                        else if (spec?.type === 'boolean') {
                            result[field] = ['true', 'yes', '1'].includes(value.toLowerCase());
                            break;
                        }
                        else if (spec?.type === 'array') {
                            // For arrays, get all matches
                            const allValues = $(sel).map((_, e) => $(e).text().trim()).get();
                            result[field] = allValues;
                            break;
                        }
                        else {
                            result[field] = value;
                            break;
                        }
                    }
                }
            }
            if (result[field] === undefined) {
                result[field] = null;
            }
        }
    }
    return result;
}
//# sourceMappingURL=extract.js.map