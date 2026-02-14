/**
 * URL validation middleware to prevent SSRF attacks
 * Validates URLs BEFORE any network request is made
 */
/**
 * Validate URL to prevent SSRF attacks
 * Blocks localhost, private IPs, link-local addresses, and non-HTTP(S) protocols
 */
export declare function validateUrlForSSRF(urlString: string): void;
/**
 * SSRF Error class
 */
export declare class SSRFError extends Error {
    constructor(message: string);
}
//# sourceMappingURL=url-validator.d.ts.map