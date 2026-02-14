/**
 * PDF extraction using pdf-parse
 */
export declare function extractPdf(buffer: Buffer): Promise<{
    text: string;
    metadata: Record<string, any>;
    pages: number;
}>;
//# sourceMappingURL=pdf.d.ts.map