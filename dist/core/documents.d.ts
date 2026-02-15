/**
 * Document (PDF/DOCX) parsing utilities.
 *
 * Keeps binary/document parsing separate from the HTML scraping pipeline.
 */
export type DocumentFormat = 'markdown' | 'text' | 'html';
export interface DocumentExtractionResult {
    content: string;
    metadata: {
        title: string;
        contentType: string;
        wordCount: number;
        [key: string]: any;
    };
}
export declare function normalizeContentType(contentTypeHeader: string | undefined | null): string;
export declare function isPdfContentType(contentTypeHeader: string | undefined | null): boolean;
export declare function isDocxContentType(contentTypeHeader: string | undefined | null): boolean;
export declare function extractDocumentToFormat(buffer: Buffer, options?: {
    url?: string;
    contentType?: string;
    format?: DocumentFormat;
}): Promise<DocumentExtractionResult>;
//# sourceMappingURL=documents.d.ts.map